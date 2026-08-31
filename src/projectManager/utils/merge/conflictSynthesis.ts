/**
 * Recover remote changes missing from Frontier's conflict list (issue #991).
 * A history change is not necessarily a content conflict: paths already
 * present with identical committed AND working bytes need no resolution.
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
import type { ConflictFile } from "./types";
import { TransientSyncError } from "./transientSyncError";

/** Git operations the synthesis needs; injectable for tests. */
export interface ConflictSynthesisGitOps {
    resolveRef: (dir: string, ref: string) => Promise<string>;
    readBlobAtRef: (dir: string, ref: string, filepath: string) => Promise<Buffer>;
    currentBranch?: (dir: string) => Promise<string | undefined>;
}

export interface MergeSnapshot {
    localHead: string;
    remoteHead: string;
    baseHead?: string;
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
    // Prefer the checked-out branch, not origin/HEAD (which can name another branch).
    if (gitOps.currentBranch) {
        const branch = await gitOps.currentBranch(workspaceDir);
        if (branch) {
            try {
                return await gitOps.resolveRef(workspaceDir, `refs/remotes/origin/${branch}`);
            } catch { /* Older checkouts may only have FETCH_HEAD. */ }
        }
    }
    for (const ref of REMOTE_REF_CANDIDATES) {
        try {
            return await gitOps.resolveRef(workspaceDir, ref);
        } catch {
            // try the next candidate
        }
    }
    return null;
}

export interface ConflictSynthesisResult {
    synthesized: ConflictFile[];
    unchanged: string[];
    /** Paths whose remote content could not be read — the caller must keep failing loudly for these. */
    unsynthesizable: string[];
}

/**
 * Builds ConflictFile entries for remote-changed paths the conflict list
 * missed. Content sources:
 *  - theirs: the fetched remote ref (required — no remote blob, no synthesis);
 *  - ours: the working tree, falling back to HEAD;
 *  - base: the analysed common ancestor when supplied by Frontier. Older
 *    versions fall back to HEAD for text, but never guess ancestry for media
 *    pointers. Matching HEAD and working bytes are excluded before synthesis.
 */
export async function synthesizeConflictsForPaths(
    workspaceDir: string,
    filepaths: string[],
    gitOps: ConflictSynthesisGitOps = dugiteGit,
    snapshot?: MergeSnapshot
): Promise<ConflictSynthesisResult> {
    const synthesized: ConflictFile[] = [];
    const unchanged: string[] = [];
    const unsynthesizable: string[] = [];

    const remoteRef = snapshot?.remoteHead ?? await findRemoteRef(workspaceDir, gitOps);
    if (remoteRef === null) {
        return { synthesized, unchanged, unsynthesizable: [...filepaths] };
    }

    for (const filepath of filepaths) {
        const normalized = normalizeSyncPath(filepath);

        let remoteBytes: Buffer;
        try {
            remoteBytes = await gitOps.readBlobAtRef(workspaceDir, remoteRef, normalized);
        } catch (error) {
            console.warn(
                `[Sync] Could not read remote content for ${normalized} at ${remoteRef}:`,
                error
            );
            unsynthesizable.push(filepath);
            continue;
        }

        let headBytes: Buffer | null = null;
        try {
            headBytes = await gitOps.readBlobAtRef(workspaceDir, snapshot?.localHead ?? "HEAD", normalized);
        } catch {
            // not in HEAD — the file is new from the remote's perspective
        }

        let workingBytes: Buffer | null = null;
        try {
            const target = vscode.Uri.joinPath(
                vscode.Uri.file(workspaceDir),
                ...normalized.split("/")
            );
            workingBytes = Buffer.from(await vscode.workspace.fs.readFile(target));
        } catch {
            // not in the working tree
        }

        // Check bytes, not UTF-8 strings: distinct binary blobs can decode to
        // the same replacement characters. HEAD must match too, otherwise the
        // working file still needs staging before creating the merge commit.
        if (headBytes?.equals(remoteBytes) && workingBytes?.equals(remoteBytes)) {
            unchanged.push(normalized);
            continue;
        }

        if ([remoteBytes, headBytes, workingBytes].some(
            (bytes) => bytes !== null && !Buffer.from(bytes.toString("utf8")).equals(bytes)
        )) {
            // The text resolver cannot safely round-trip arbitrary binary data.
            unsynthesizable.push(normalized);
            continue;
        }

        const theirs = remoteBytes.toString("utf-8");
        const headContent = headBytes?.toString("utf-8") ?? null;
        const workingContent = workingBytes?.toString("utf-8") ?? null;
        let base = headContent ?? "";
        if (snapshot?.baseHead) {
            try {
                base = (await gitOps.readBlobAtRef(workspaceDir, snapshot.baseHead, normalized)).toString("utf-8");
            } catch {
                // Unknown ancestry must not turn two different pointers into a
                // one-sided change. An empty base makes that conflict explicit.
                base = "";
            }
        } else if (normalized.startsWith(".project/attachments/pointers/")) {
            base = "";
        }
        synthesized.push({
            filepath: normalized,
            ours: workingContent ?? headContent ?? "",
            theirs,
            base,
            isDeleted: false,
            // Keyed off DISK presence, not HEAD: the resolvers' existing-file
            // branch stats the working tree and fails for a missing file, so
            // any file absent locally must take the isNew creation path (which
            // still merges both sides when they differ).
            isNew: workingContent === null,
        });
    }

    return { synthesized, unchanged, unsynthesizable };
}

export interface ConflictListInvariantOptions {
    /** The conflict list frontier produced. */
    conflicts: Array<{ filepath?: string; }>;
    /** conflictsResponse.remoteChangedFilePaths (or allChangedFilePaths fallback). */
    changedPaths: unknown;
    /** Current sync attempt (the outer retry layer caps at 2 retries). */
    retryCount: number;
    workspaceDir: string;
    snapshot?: MergeSnapshot;
    /**
     * Sink for the self-heal log entry (defaults to console.warn). Injectable
     * because the extension host defines console methods as non-writable, so
     * tests cannot intercept the global.
     */
    log?: (message: string, ...args: unknown[]) => void;
}

/**
 * Every remote-changed file must be resolved OR already present unchanged.
 * Missing/different content still follows the recovery/retry path. Both sides are
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
    const missingFromConflicts = [...new Set(changedPaths
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map(normalizeSyncPath)
        .filter((p) => !conflictPaths.has(p)))];
    if (missingFromConflicts.length === 0) return [];

    const { synthesized, unsynthesizable } = await synthesizeConflictsForPaths(
        workspaceDir, missingFromConflicts, gitOps, options.snapshot
    );
    if (synthesized.length === 0 && unsynthesizable.length === 0) return [];
    const unresolvedPaths = [...synthesized.map((file) => file.filepath), ...unsynthesizable];

    const describeMissing = (paths: string[]) => {
        const sample = paths.slice(0, 5).join(", ");
        const extra = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
        return `${sample}${extra}`;
    };

    if (retryCount < 2) {
        throw new TransientSyncError(
            `${unresolvedPaths.length} remote-changed file(s) were not in the conflict list. Missing: ${describeMissing(unresolvedPaths)}`,
            unresolvedPaths
        );
    }

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

/** Older Frontier versions also report matching files as actual conflicts. */
export async function excludeUnchangedConflicts(
    conflicts: ConflictFile[],
    workspaceDir: string,
    snapshot?: MergeSnapshot,
    gitOps: ConflictSynthesisGitOps = dugiteGit
): Promise<ConflictFile[]> {
    const candidates = conflicts.filter((c) => !c.isDeleted && c.ours === c.theirs);
    if (candidates.length === 0) return conflicts;
    const { unchanged } = await synthesizeConflictsForPaths(
        workspaceDir, candidates.map((c) => c.filepath), gitOps, snapshot
    );
    const paths = new Set(unchanged);
    return conflicts.filter((c) => !paths.has(normalizeSyncPath(c.filepath)));
}
