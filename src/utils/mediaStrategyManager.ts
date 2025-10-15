import * as vscode from "vscode";
import * as path from "path";
import {
    MediaFilesStrategy,
    getMediaFilesStrategy,
    setMediaFilesStrategy,
    setLastModeRun,
    setChangesApplied,
    getFlags,
} from "./localProjectSettings";
import {
    findAllPointerFiles,
    replaceFileWithPointer,
    isPointerFile,
} from "./lfsHelpers";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[MediaStrategyManager]", ...args) : () => { };

/**
 * Replace all downloaded files in attachments/files with their pointer versions
 * This is used when switching to stream-only or stream-and-save modes
 * @param projectPath - Root path of the project
 * @returns Number of files replaced
 */
export async function replaceFilesWithPointers(projectPath: string): Promise<number> {
    let replacedCount = 0;

    try {
        const pointersDir = path.join(projectPath, ".project", "attachments", "pointers");

        // Find all pointer files
        const pointerFiles = await findAllPointerFiles(pointersDir);
        debug(`Found ${pointerFiles.length} pointer files to process`);

        // Replace each file in files/ with its pointer
        for (const relPath of pointerFiles) {
            const success = await replaceFileWithPointer(projectPath, relPath);
            if (success) {
                replacedCount++;
            }
        }

        debug(`Replaced ${replacedCount} files with pointers`);
        return replacedCount;
    } catch (error) {
        console.error("Error replacing files with pointers:", error);
        throw error;
    }
}

/**
 * Download all LFS files from pointers (uses frontier API)
 * This is used when switching to auto-download mode
 * @param projectPath - Root path of the project
 * @returns Number of files downloaded
 */
export async function downloadAllLFSFiles(projectPath: string): Promise<number> {
    let downloadedCount = 0;

    try {
        // Get frontier API
        const { getAuthApi } = await import("../extension");
        const frontierApi = getAuthApi();
        if (!frontierApi) {
            throw new Error("Frontier authentication extension not available");
        }

        const pointersDir = path.join(projectPath, ".project", "attachments", "pointers");
        const pointerFiles = await findAllPointerFiles(pointersDir);

        debug(`Downloading ${pointerFiles.length} LFS files...`);

        // Download with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Downloading Media Files",
                cancellable: false,
            },
            async (progress) => {
                for (let i = 0; i < pointerFiles.length; i++) {
                    const relPath = pointerFiles[i];
                    const pointerPath = path.join(pointersDir, relPath);
                    const filesPath = path.join(projectPath, ".project", "attachments", "files", relPath);

                    try {
                        // Check if files/ version is already a full file
                        try {
                            const filesExists = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
                            const isPointer = await isPointerFile(filesPath);

                            if (filesExists && !isPointer) {
                                // Already have the full file
                                debug(`File already downloaded: ${relPath}`);
                                continue;
                            }
                        } catch {
                            // File doesn't exist, will download
                        }

                        // Parse pointer
                        const { parsePointerFile } = await import("./lfsHelpers");
                        const pointer = await parsePointerFile(pointerPath);

                        if (!pointer) {
                            console.warn(`Invalid pointer file: ${relPath}`);
                            continue;
                        }

                        // Download file
                        progress.report({
                            increment: (100 / pointerFiles.length),
                            message: `${i + 1}/${pointerFiles.length}: ${path.basename(relPath)}`,
                        });

                        const fileData = await frontierApi.downloadLFSFile(
                            projectPath,
                            pointer.oid,
                            pointer.size
                        );

                        // Ensure directory exists
                        const filesDir = path.dirname(filesPath);
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

                        // Write file
                        await vscode.workspace.fs.writeFile(vscode.Uri.file(filesPath), fileData);
                        downloadedCount++;
                        debug(`Downloaded: ${relPath}`);
                    } catch (error) {
                        console.error(`Failed to download ${relPath}:`, error);
                        // Continue with other files even if one fails
                    }
                }

                progress.report({ increment: 100, message: "Complete" });
            }
        );

        debug(`Downloaded ${downloadedCount} files`);
        return downloadedCount;
    } catch (error) {
        console.error("Error downloading LFS files:", error);
        throw error;
    }
}

/**
 * Remove files/ entries that are LFS pointer stubs so that a subsequent
 * reconcile (or sync) will download real bytes. Keeps real media files intact.
 */
export async function removeFilesPointerStubs(projectPath: string): Promise<number> {
    let removedCount = 0;
    try {
        const pointersDir = path.join(projectPath, ".project", "attachments", "pointers");
        const pointerFiles = await findAllPointerFiles(pointersDir);

        for (const relPath of pointerFiles) {
            const filesPath = path.join(projectPath, ".project", "attachments", "files", relPath);
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
                // Only remove if files/ contains a pointer (do not touch real media bytes)
                const isPtr = await isPointerFile(filesPath);
                if (stat && isPtr) {
                    await vscode.workspace.fs.delete(vscode.Uri.file(filesPath));
                    removedCount++;
                }
            } catch {
                // files path missing is fine
            }
        }
    } catch (e) {
        console.error("Error removing pointer stubs from files dir:", e);
    }
    return removedCount;
}

/**
 * Apply a media strategy to a project and record flags when used in a
 * Switch & Open scenario. This is a thin wrapper to apply and then set
 * lastModeRun and changesApplied=true.
 */
export async function applyMediaStrategyAndRecord(
    projectUri: vscode.Uri,
    newStrategy: MediaFilesStrategy
): Promise<void> {
    // If we're switching back to the strategy that last ran, there are no
    // on-disk changes required. Only update flags and the stored strategy.
    try {
        const { lastModeRun } = await getFlags(projectUri);
        if (lastModeRun === newStrategy) {
            await setMediaFilesStrategy(newStrategy, projectUri);
            await setLastModeRun(newStrategy, projectUri);
            await setChangesApplied(true, projectUri);
            return;
        }
    } catch {
        // If flags can't be read, fall through to normal apply path
    }

    await applyMediaStrategy(projectUri, newStrategy);
    await setLastModeRun(newStrategy, projectUri);
    await setChangesApplied(true, projectUri);
}

/**
 * Apply a media strategy to a project
 * This handles the transition between strategies
 */
export async function applyMediaStrategy(
    projectUri: vscode.Uri,
    newStrategy: MediaFilesStrategy,
    forceApply: boolean = false
): Promise<void> {
    const projectPath = projectUri.fsPath;
    const currentStrategy = await getMediaFilesStrategy(projectUri);

    debug(`Applying strategy change: ${currentStrategy} -> ${newStrategy}`);

    if (!forceApply && currentStrategy === newStrategy) {
        debug("Strategy unchanged, nothing to do");
        return;
    }

    // Save new strategy first (idempotent if unchanged)
    await setMediaFilesStrategy(newStrategy, projectUri);

    // Apply strategy-specific actions
    try {
        switch (newStrategy) {
            case "auto-download": {
                // Quick path: remove pointer stubs from files/ so reconcile/download kicks in after open
                const removed = await removeFilesPointerStubs(projectPath);
                debug(`Removed ${removed} pointer stub(s) from files directory.`);
                break;
            }
            case "stream-only":
            case "stream-and-save": {
                // Replace files with pointers
                const replacedCount = await replaceFilesWithPointers(projectPath);

                if (newStrategy === "stream-only") {
                    vscode.window.showInformationMessage(
                        `Freed disk space by replacing ${replacedCount} file(s) with pointers. ` +
                        "Media files will be streamed when needed."
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `Replaced ${replacedCount} file(s) with pointers. ` +
                        "Media files will be downloaded when you play them."
                    );
                }
                break;
            }
        }
    } catch (error) {
        console.error("Error applying media strategy:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to apply media strategy: ${errorMsg}`);

        // Revert strategy on error
        if (currentStrategy) {
            await setMediaFilesStrategy(currentStrategy, projectUri);
        }
        throw error;
    }
}

/**
 * Clean up media files after sync for stream-only mode
 */
export async function postSyncCleanup(projectUri: vscode.Uri): Promise<void> {
    try {
        const mediaStrategy = await getMediaFilesStrategy(projectUri);

        if (mediaStrategy !== "stream-only") {
            debug("Not in stream-only mode, skipping post-sync cleanup");
            return;
        }

        debug("Running post-sync cleanup for stream-only mode");

        // After sync, some files in pointers/ are now pointers (were uploaded)
        // Replace their counterparts in files/ with pointers
        const replacedCount = await replaceFilesWithPointers(projectUri.fsPath);

        if (replacedCount > 0) {
            debug(`Post-sync cleanup: replaced ${replacedCount} files with pointers`);
        }
    } catch (error) {
        console.error("Error in post-sync cleanup:", error);
        // Don't throw - this is best-effort cleanup
    }
}

