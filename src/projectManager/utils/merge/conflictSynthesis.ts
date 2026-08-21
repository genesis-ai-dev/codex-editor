/**
 * Last-resort self-heal for the remote-changed/conflict-list invariant
 * (issue #991, enforced in merge/index.ts): every remote-changed file must
 * appear in the conflict list, or the merge commit would silently drop it.
 *
 * A mismatch is first treated as transient — the sync retries with a fresh
 * fetch. But if it persists on the final attempt (a path-classification bug
 * upstream, version skew), failing forever would cut the user off from pushing
 * AND pulling. Instead, the missing paths get ConflictFile entries built from
 * local git state so they flow through the normal resolvers. That upholds the
 * invariant's actual guarantee — the merged result includes those files —
 * rather than abandoning the sync.
 *
 * The synthesis is deliberately conservative: a path whose remote content
 * cannot be read is reported as unsynthesizable (the caller keeps failing
 * loudly for it) — the fallback never invents deletions or guesses content.
 */
import * as vscode from "vscode";
import * as dugiteGit from "../../../utils/dugiteGit";
import { ConflictFile } from "./types";
import { TransientSyncError } from "./transientSyncError";

/** Git operations the synthesis needs; injectable for tests. */
export interface ConflictSynthesisGitOps {
    resolveRef: (dir: string, ref: string) => Promise<string>;
    readBlobAtRef: (dir: string, ref: string, filepath: string) => Promise<Buffer>;
}

/**
 * Canonical form for comparing paths from different producers (frontier's
 * conflict list vs its remote-changed list): forward slashes, no leading
 * "./" or "/", Unicode NFC.
 */
export function normalizeSyncPath(filepath: string): string {
    let normalized = filepath.replace(/\\/g, "/");
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    normalized = normalized.replace(/^\/+/, "");
    return normalized.normalize("NFC");
}

/**
 * The ref holding the fetched remote state. syncChanges has already fetched by
 * the time the invariant runs, so FETCH_HEAD is the primary candidate; the
 * origin-tracking refs cover setups where FETCH_HEAD is unavailable.
 */
const REMOTE_REF_CANDIDATES = [
    "FETCH_HEAD",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
];

async function findRemoteRef(
    workspaceDir: string,
    gitOps: ConflictSynthesisGitOps
): Promise<string | null> {
    for (const ref of REMOTE_REF_CANDIDATES) {
        try {
            await gitOps.resolveRef(workspaceDir, ref);
            return ref;
        } catch {
            // try the next candidate
        }
    }
    return null;
}

export interface ConflictSynthesisResult {
    synthesized: ConflictFile[];
    /** Paths whose remote content could not be read — the caller must keep failing loudly for these. */
    unsynthesizable: string[];
}

/**
 * Builds ConflictFile entries for remote-changed paths the conflict list
 * missed. Content sources:
 *  - theirs: the fetched remote ref (required — no remote blob, no synthesis);
 *  - ours: the working tree, falling back to HEAD;
 *  - base: HEAD (there is no merge-base helper; for a file only the remote
 *    changed, ours == HEAD makes the 3-way resolve to theirs, and the `.codex`
 *    custom merge is edit-history-driven and ignores base entirely).
 */
export async function synthesizeConflictsForPaths(
    workspaceDir: string,
    filepaths: string[],
    gitOps: ConflictSynthesisGitOps = dugiteGit
): Promise<ConflictSynthesisResult> {
    const synthesized: ConflictFile[] = [];
    const unsynthesizable: string[] = [];

    const remoteRef = await findRemoteRef(workspaceDir, gitOps);
    if (remoteRef === null) {
        return { synthesized, unsynthesizable: [...filepaths] };
    }

    for (const filepath of filepaths) {
        const normalized = normalizeSyncPath(filepath);

        let theirs: string;
        try {
            const blob = await gitOps.readBlobAtRef(workspaceDir, remoteRef, normalized);
            theirs = blob.toString("utf-8");
        } catch (error) {
            console.warn(
                `[Sync] Could not read remote content for ${normalized} at ${remoteRef}:`,
                error
            );
            unsynthesizable.push(filepath);
            continue;
        }

        let headContent: string | null = null;
        try {
            const blob = await gitOps.readBlobAtRef(workspaceDir, "HEAD", normalized);
            headContent = blob.toString("utf-8");
        } catch {
            // not in HEAD — the file is new from the remote's perspective
        }

        let workingContent: string | null = null;
        try {
            const target = vscode.Uri.joinPath(
                vscode.Uri.file(workspaceDir),
                ...normalized.split("/")
            );
            workingContent = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
        } catch {
            // not in the working tree
        }

        synthesized.push({
            filepath: normalized,
            ours: workingContent ?? headContent ?? "",
            theirs,
            base: headContent ?? "",
            isDeleted: false,
            // Keyed off DISK presence, not HEAD: the resolvers' existing-file
            // branch stats the working tree and fails for a missing file, so
            // any file absent locally must take the isNew creation path (which
            // still merges both sides when they differ).
            isNew: workingContent === null,
        });
    }

    return { synthesized, unsynthesizable };
}

export interface ConflictListInvariantOptions {
    /** The conflict list frontier produced. */
    conflicts: Array<{ filepath?: string; }>;
    /** conflictsResponse.remoteChangedFilePaths (or allChangedFilePaths fallback). */
    changedPaths: unknown;
    /** Current sync attempt (the outer retry layer caps at 2 retries). */
    retryCount: number;
    workspaceDir: string;
    /**
     * Sink for the self-heal log entry (defaults to console.warn). Injectable
     * because the extension host defines console methods as non-writable, so
     * tests cannot intercept the global.
     */
    log?: (message: string, ...args: unknown[]) => void;
}

/**
 * Enforces the #991 invariant: every remote-changed file must appear in the
 * conflict list, or the merge commit would silently drop it. Both sides are
 * normalized before comparing so a formatting mismatch (separators, "./",
 * Unicode form) can't fake a violation.
 *
 * Returns the ConflictFile entries to append to the conflict list — empty when
 * the invariant holds. On early attempts a mismatch throws TransientSyncError
 * so the retry layer refetches; on the final attempt the missing paths are
 * synthesized from local git state instead (see synthesizeConflictsForPaths),
 * so a persistent upstream mismatch degrades to a normal merge rather than a
 * permanent sync outage. Paths that cannot be synthesized still throw.
 */
export async function enforceConflictListInvariant(
    options: ConflictListInvariantOptions,
    gitOps: ConflictSynthesisGitOps = dugiteGit
): Promise<ConflictFile[]> {
    const { conflicts, changedPaths, retryCount, workspaceDir } = options;
    const log = options.log ?? console.warn;

    if (!Array.isArray(changedPaths) || changedPaths.length === 0) return [];

    const conflictPaths = new Set(
        conflicts
            .map((c) => c?.filepath)
            .filter((p): p is string => typeof p === "string")
            .map(normalizeSyncPath)
    );
    const missingFromConflicts = changedPaths
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .filter((p) => !conflictPaths.has(normalizeSyncPath(p)));
    if (missingFromConflicts.length === 0) return [];

    const describeMissing = (paths: string[]) => {
        const sample = paths.slice(0, 5).join(", ");
        const extra = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
        return `${sample}${extra}`;
    };

    if (retryCount < 2) {
        throw new TransientSyncError(
            `${missingFromConflicts.length} remote-changed file(s) were not in the conflict list. Missing: ${describeMissing(missingFromConflicts)}`,
            missingFromConflicts
        );
    }

    const { synthesized, unsynthesizable } = await synthesizeConflictsForPaths(
        workspaceDir,
        missingFromConflicts,
        gitOps
    );
    if (unsynthesizable.length > 0) {
        throw new TransientSyncError(
            `${unsynthesizable.length} remote-changed file(s) were not in the conflict list and could not be recovered from the fetched remote. Missing: ${describeMissing(unsynthesizable)}`,
            unsynthesizable
        );
    }
    log(
        `[Sync] Conflict-list invariant self-heal: merging ${synthesized.length} remote-changed file(s) the conflict list missed:`,
        synthesized.map((c) => c.filepath)
    );
    return synthesized;
}
