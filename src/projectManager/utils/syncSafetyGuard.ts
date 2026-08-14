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

    for (const relativePath of await deps.listCodexFiles()) {
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
    return findEmptiedCodexFiles(createWorkspaceDeps(workspaceFolder));
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

/**
 * Notifies the user that sync was blocked and offers to restore the flagged
 * files from the last synced version. Fire-and-forget: callers must not block
 * sync flow on the user dismissing the notification.
 */
export async function notifyEmptiedCodexFilesBlockedSync(
    workspaceFolder: string,
    files: EmptiedCodexFile[]
): Promise<void> {
    const fileList = files
        .map((f) => path.posix.basename(f.relativePath))
        .slice(0, 5)
        .join(", ");
    const suffix = files.length > 5 ? ` and ${files.length - 5} more` : "";
    const RESTORE_ACTION = "Restore from last sync";
    const choice = await vscode.window.showErrorMessage(
        `Sync stopped to protect your work: ${files.length} translation file(s) on this computer ` +
        `lost all their content (${fileList}${suffix}). Syncing now would remove the translations ` +
        `for your whole team. Restore the last synced version?`,
        RESTORE_ACTION
    );
    if (choice !== RESTORE_ACTION) {
        return;
    }
    const restored = await restoreEmptiedCodexFiles(workspaceFolder, files);
    if (restored.length === files.length) {
        vscode.window.showInformationMessage(
            `Restored ${restored.length} file(s). You can sync again now.`
        );
    } else {
        vscode.window.showWarningMessage(
            `Restored ${restored.length} of ${files.length} file(s). ` +
            `Please contact support before syncing again.`
        );
    }
}
