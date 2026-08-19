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
