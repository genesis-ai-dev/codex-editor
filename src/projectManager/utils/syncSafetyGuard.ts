import * as vscode from "vscode";
import * as path from "path";
import * as dugiteGit from "../../utils/dugiteGit";
import { atomicWriteUriText } from "../../utils/notebookSafeSaveUtils";

/**
 * Pre-sync safety guard (issue #1119).
 *
 * A sync commits and pushes whatever is in the working tree. If a `.codex`
 * file has been corrupted or emptied on disk (e.g. by a race that replaced it
 * with a zero-cell skeleton), committing it broadcasts the data loss to the
 * whole team. This guard runs before `syncChanges` and blocks the sync when a
 * tracked `.codex` file that had cells at HEAD now has zero cells (or can no
 * longer be parsed) in the working tree.
 *
 * Genuinely new files (no HEAD version) and files that were already empty at
 * HEAD are never flagged, so creating a new empty notebook still syncs fine.
 */

export interface EmptiedCodexFile {
    /** Repo-relative path with forward slashes (git-style). */
    relativePath: string;
    /** Cell count of the HEAD version of the file. */
    headCellCount: number;
    /** Why the working-tree version was flagged. */
    reason: "emptied" | "unparseable";
}

/** Injectable dependencies so the guard logic is unit-testable. */
export interface SyncSafetyGuardDeps {
    /** List repo-relative paths (git-style) of tracked-directory .codex files. */
    listCodexFiles(): Promise<string[]>;
    /** Read the working-tree content of a file, or throw if unreadable. */
    readWorkingText(relativePath: string): Promise<string>;
    /** Read the HEAD content of a file, or undefined if not present at HEAD. */
    readHeadText(relativePath: string): Promise<string | undefined>;
    /**
     * Repo-relative paths (git-style) that differ from HEAD in any way.
     *
     * Optional. When provided, files absent from this set are skipped without
     * being read: a working-tree file identical to HEAD cannot have been
     * emptied *relative to* HEAD, so reading it can only ever confirm what git
     * already told us. Omit it (or let it throw) to scan every file — the
     * guard must fail safe by over-checking, never by silently skipping.
     */
    listPathsChangedFromHead?(): Promise<Set<string>>;
}

/**
 * Returns the number of cells in serialized notebook text, or null when the
 * text is not parseable as a notebook (invalid JSON or no cells array).
 */
export function countNotebookCells(text: string): number | null {
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed?.cells) ? parsed.cells.length : null;
    } catch {
        return null;
    }
}

export async function findEmptiedCodexFiles(deps: SyncSafetyGuardDeps): Promise<EmptiedCodexFile[]> {
    const violations: EmptiedCodexFile[] = [];

    // Read + JSON.parse of every notebook runs on every sync (and again on each
    // sync retry), so narrow the set to files git already reports as changed.
    // `undefined` means "couldn't determine" — scan everything in that case.
    let changedPaths: Set<string> | undefined;
    if (deps.listPathsChangedFromHead) {
        try {
            changedPaths = await deps.listPathsChangedFromHead();
        } catch (error) {
            console.warn(
                "[SyncSafetyGuard] Could not list changed paths; scanning all files:",
                error
            );
        }
    }

    for (const relativePath of await deps.listCodexFiles()) {
        if (changedPaths && !changedPaths.has(relativePath)) {
            continue;
        }

        let workingCellCount: number | null;
        try {
            workingCellCount = countNotebookCells(await deps.readWorkingText(relativePath));
        } catch {
            // Unreadable working file: treat like unparseable content.
            workingCellCount = null;
        }
        if (workingCellCount !== null && workingCellCount > 0) {
            continue;
        }

        // Working tree looks emptied or corrupt — only a problem if HEAD had cells.
        let headText: string | undefined;
        try {
            headText = await deps.readHeadText(relativePath);
        } catch {
            // No HEAD version (new file, or repo without commits): nothing to lose.
            continue;
        }
        if (headText === undefined) {
            continue;
        }

        const headCellCount = countNotebookCells(headText);
        if (headCellCount !== null && headCellCount > 0) {
            violations.push({
                relativePath,
                headCellCount,
                reason: workingCellCount === null ? "unparseable" : "emptied",
            });
        }
    }

    return violations;
}

/**
 * Delays (ms) between re-reads when confirming a file is really emptied.
 * Mirrors the retry ladder in `CodexCellDocument.create`.
 */
const RECHECK_DELAYS_MS = [50, 250];

/**
 * Re-reads flagged files after a short delay and drops any that have since
 * come back with cells.
 *
 * A file can be flagged simply because the scan caught it mid-write: the real
 * content lands milliseconds later. Restoring HEAD over that would clobber
 * genuinely newer work, so a file must look emptied on every re-read before we
 * act on it. Only runs when something was flagged, so healthy syncs pay nothing.
 */
export async function confirmEmptiedCodexFiles(
    deps: SyncSafetyGuardDeps,
    candidates: EmptiedCodexFile[],
    options: {
        delaysMs?: number[];
        wait?: (ms: number) => Promise<void>;
    } = {}
): Promise<EmptiedCodexFile[]> {
    if (candidates.length === 0) {
        return [];
    }
    const delaysMs = options.delaysMs ?? RECHECK_DELAYS_MS;
    const wait = options.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    let remaining = candidates;
    for (const delayMs of delaysMs) {
        await wait(delayMs);

        const stillEmpty: EmptiedCodexFile[] = [];
        for (const file of remaining) {
            let cellCount: number | null;
            try {
                cellCount = countNotebookCells(await deps.readWorkingText(file.relativePath));
            } catch {
                cellCount = null;
            }
            if (cellCount === null || cellCount === 0) {
                stillEmpty.push(file);
            }
        }

        remaining = stillEmpty;
        if (remaining.length === 0) {
            return [];
        }
    }
    return remaining;
}

function createWorkspaceDeps(workspaceFolder: string): SyncSafetyGuardDeps {
    const toUri = (relativePath: string) =>
        vscode.Uri.file(path.join(workspaceFolder, ...relativePath.split("/")));

    return {
        async listCodexFiles() {
            const codexDir = vscode.Uri.file(path.join(workspaceFolder, "files", "target"));
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(codexDir, "**/*.codex")
            );
            return files.map((uri) =>
                path.relative(workspaceFolder, uri.fsPath).split(path.sep).join("/")
            );
        },
        async readWorkingText(relativePath) {
            const data = await vscode.workspace.fs.readFile(toUri(relativePath));
            return new TextDecoder("utf-8").decode(data);
        },
        async readHeadText(relativePath) {
            try {
                const blob = await dugiteGit.readBlobAtRef(workspaceFolder, "HEAD", relativePath);
                return blob.toString("utf-8");
            } catch {
                return undefined;
            }
        },
        async listPathsChangedFromHead() {
            const matrix = await dugiteGit.statusMatrix(workspaceFolder);
            const changed = new Set<string>();
            for (const [filepath, head, workdir, stage] of matrix) {
                // [1, 1, 1] is "present at HEAD, worktree and index both match".
                // Every other combination differs from HEAD somehow, including
                // staged-only edits ([1, 1, 2]) where the worktree matches the
                // index but not HEAD.
                //
                // Tested against both git adapters: the native porcelain=v2
                // backend omits unchanged files entirely, while the
                // isomorphic-git fallback emits them as [1, 1, 1]. Filtering on
                // the tuple rather than on mere presence covers both.
                if (head === 1 && workdir === 1 && stage === 1) {
                    continue;
                }
                changed.add(filepath.replace(/\\/g, "/").replace(/^\/+/, ""));
            }
            return changed;
        },
    };
}

/**
 * Scans the workspace for tracked `.codex` files whose cells collapsed to zero
 * (or became unparseable) relative to HEAD. Intended to run right before a
 * sync commits the working tree.
 */
export async function checkForEmptiedCodexFiles(
    workspaceFolder: string
): Promise<EmptiedCodexFile[]> {
    const deps = createWorkspaceDeps(workspaceFolder);
    return confirmEmptiedCodexFiles(deps, await findEmptiedCodexFiles(deps));
}

/**
 * Restores the HEAD version of each flagged file into the working tree.
 * Returns the relative paths that were successfully restored.
 */
export async function restoreEmptiedCodexFiles(
    workspaceFolder: string,
    files: EmptiedCodexFile[]
): Promise<string[]> {
    const deps = createWorkspaceDeps(workspaceFolder);
    const restored: string[] = [];
    for (const file of files) {
        try {
            const headText = await deps.readHeadText(file.relativePath);
            if (headText === undefined) {
                continue;
            }
            const uri = vscode.Uri.file(
                path.join(workspaceFolder, ...file.relativePath.split("/"))
            );
            await atomicWriteUriText(uri, headText);
            restored.push(file.relativePath);
        } catch (error) {
            console.error(
                `[SyncSafetyGuard] Failed to restore ${file.relativePath} from HEAD:`,
                error
            );
        }
    }
    return restored;
}

/** Human-readable file list for notifications, capped at 5 names. */
function summarizeFiles(relativePaths: string[]): string {
    const names = relativePaths.map((p) => path.posix.basename(p));
    const shown = names.slice(0, 5).join(", ");
    return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

export interface EmptiedCodexRepairResult {
    /** Paths successfully restored from HEAD; safe to sync. */
    restored: string[];
    /** Paths still emptied after the restore attempt; must NOT be synced. */
    unrepaired: string[];
}

/**
 * Repairs emptied `.codex` files in place so the sync can proceed (issue #1119).
 *
 * Restoring from HEAD is the same operation the old "Restore from last sync"
 * button performed, applied automatically: HEAD is the last version the whole
 * team already has, and a zero-cell working file has no local work to lose.
 * Doing it inline rather than blocking means a user with a damaged file keeps
 * *receiving* their team's work — `syncChanges` pulls as well as pushes, so
 * refusing to sync cut them off entirely.
 *
 * Any file that could not be restored is reported as `unrepaired`: the caller
 * must still block the sync in that case, since committing it would push the
 * data loss to everyone.
 */
export async function repairEmptiedCodexFiles(
    workspaceFolder: string,
    files: EmptiedCodexFile[]
): Promise<EmptiedCodexRepairResult> {
    const restored = await restoreEmptiedCodexFiles(workspaceFolder, files);
    const restoredSet = new Set(restored);
    const unrepaired = files
        .map((f) => f.relativePath)
        .filter((relativePath) => !restoredSet.has(relativePath));
    return { restored, unrepaired };
}

/**
 * Tells the user their files were repaired automatically. Informational, not an
 * error: nothing is required of them and the sync carried on.
 */
export function notifyEmptiedCodexFilesRestored(restored: string[]): void {
    if (restored.length === 0) {
        return;
    }
    vscode.window.showInformationMessage(
        `${restored.length} translation file(s) on this computer had lost their content ` +
        `and were restored from your last sync before syncing: ${summarizeFiles(restored)}.`
    );
}

/**
 * Tells the user sync stopped because files could not be repaired. This is the
 * residual case only — the automatic restore above already failed, so there is
 * no self-service action left to offer.
 */
export function notifyEmptiedCodexFilesBlockedSync(unrepaired: string[]): void {
    if (unrepaired.length === 0) {
        return;
    }
    vscode.window.showErrorMessage(
        `Sync stopped to protect your work: ${unrepaired.length} translation file(s) ` +
        `lost their content and could not be restored automatically ` +
        `(${summarizeFiles(unrepaired)}). Syncing would remove these translations for ` +
        `your whole team. Please contact support.`
    );
}
