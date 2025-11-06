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
 * Replace specific files in attachments/files with their pointer versions
 * This is optimized for post-sync cleanup where we know exactly which files were uploaded
 * @param projectPath - Root path of the project
 * @param uploadedFiles - List of file paths that were uploaded (relative to project root)
 * @returns Number of files replaced
 */
export async function replaceSpecificFilesWithPointers(projectPath: string, uploadedFiles: string[]): Promise<number> {
    let replacedCount = 0;

    try {
        // Filter for files that are in the pointers directory
        const pointerFiles = uploadedFiles.filter(filepath =>
            filepath.includes(".project/attachments/pointers/") ||
            filepath.includes(".project\\attachments\\pointers\\")
        );

        if (pointerFiles.length === 0) {
            debug("No pointer files in uploaded files list");
            return 0;
        }

        debug(`Processing ${pointerFiles.length} uploaded pointer file(s) for replacement`);

        // Process each file without showing progress UI (it's fast for a few files)
        for (const filepath of pointerFiles) {
            // Extract the relative path within the pointers directory
            let relPath = filepath;
            if (filepath.includes(".project/attachments/pointers/")) {
                relPath = filepath.split(".project/attachments/pointers/")[1];
            } else if (filepath.includes(".project\\attachments\\pointers\\")) {
                relPath = filepath.split(".project\\attachments\\pointers\\")[1];
            }

            if (relPath) {
                const success = await replaceFileWithPointer(projectPath, relPath);
                if (success) {
                    replacedCount++;
                }
            }
        }

        debug(`Replaced ${replacedCount} file(s) with pointers`);
        return replacedCount;
    } catch (error) {
        console.error("Error replacing specific files with pointers:", error);
        throw error;
    }
}

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
        const filesDir = path.join(projectPath, ".project", "attachments", "files");

        // Find all pointer files
        const pointerFiles = await findAllPointerFiles(pointersDir);
        debug(`Found ${pointerFiles.length} pointer files to process`);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Updating media for streaming...",
                cancellable: false,
            },
            async (progress) => {
                const total = Math.max(pointerFiles.length, 1);
                let processed = 0;

                // Process files in parallel batches - optimized
                const BATCH_SIZE = 100;
                const batches: string[][] = [];
                for (let i = 0; i < pointerFiles.length; i += BATCH_SIZE) {
                    batches.push(pointerFiles.slice(i, i + BATCH_SIZE));
                }

                for (const batch of batches) {
                    const results = await Promise.allSettled(
                        batch.map(async (relPath) => {
                            const pointerPath = path.join(pointersDir, relPath);
                            const filesPath = path.join(filesDir, relPath);

                            try {
                                // CRITICAL: Check if this is a locally recorded, unsynced file
                                // These files exist in files/ but haven't been uploaded yet
                                // We MUST NOT replace them with pointers to avoid data loss
                                const pathParts = relPath.split(path.sep);
                                if (pathParts.length >= 2) {
                                    const book = pathParts[0];
                                    const filename = pathParts.slice(1).join(path.sep);
                                    const { getFileStatus } = await import("./lfsHelpers");
                                    const status = await getFileStatus(projectPath, book, filename);

                                    if (status === "local-unsynced") {
                                        debug(`PROTECTED: Skipping local unsynced recording: ${relPath}`);
                                        return false; // Do NOT replace local recordings!
                                    }
                                }

                                // Quick check: does files/ already exist and is it already a pointer?
                                try {
                                    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
                                    if (stat.size < 200) { // Pointer files are tiny (~130 bytes)
                                        // Likely already a pointer, skip
                                        return false;
                                    }
                                } catch {
                                    // files/ doesn't exist, continue
                                }

                                // Ensure directory exists (batch operation is efficient)
                                const filesParentDir = path.dirname(filesPath);
                                await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesParentDir));

                                // Copy pointer to files/ (simple copy, no validation needed)
                                const pointerContent = await vscode.workspace.fs.readFile(vscode.Uri.file(pointerPath));
                                await vscode.workspace.fs.writeFile(vscode.Uri.file(filesPath), pointerContent);

                                return true;
                            } catch {
                                return false;
                            }
                        })
                    );

                    for (const result of results) {
                        if (result.status === 'fulfilled' && result.value) {
                            replacedCount++;
                        }
                    }

                    processed += batch.length;
                    progress.report({
                        increment: (batch.length / total) * 100,
                        message: `${processed}/${total}`,
                    });
                }

                progress.report({ increment: 100, message: "Complete" });
            }
        );

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
        // Before any downloads, enforce version gates (Frontier installed + project metadata requirements)
        try {
            const { ensureAllVersionGatesForMedia } = await import("./versionGate");
            const allowed = await ensureAllVersionGatesForMedia(true);
            if (!allowed) {
                // Block entire bulk download
                return 0;
            }
        } catch (gateErr) {
            console.warn("Blocking media download due to version requirements:", gateErr);
            return 0;
        }

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
                const total = Math.max(pointerFiles.length, 1);
                let processed = 0;

                // Process downloads in parallel batches (network operations)
                const BATCH_SIZE = 30; // Conservative batch size for network operations
                const batches: string[][] = [];
                for (let i = 0; i < pointerFiles.length; i += BATCH_SIZE) {
                    batches.push(pointerFiles.slice(i, i + BATCH_SIZE));
                }

                for (const batch of batches) {
                    const results = await Promise.allSettled(
                        batch.map(async (relPath) => {
                            const pointerPath = path.join(pointersDir, relPath);
                            const filesPath = path.join(projectPath, ".project", "attachments", "files", relPath);

                            try {
                                // CRITICAL: Check if this is a locally recorded, unsynced file
                                // We MUST NOT overwrite local recordings with downloaded files!
                                const pathParts = relPath.split(path.sep);
                                if (pathParts.length >= 2) {
                                    const book = pathParts[0];
                                    const filename = pathParts.slice(1).join(path.sep);
                                    const { getFileStatus } = await import("./lfsHelpers");
                                    const status = await getFileStatus(projectPath, book, filename);

                                    if (status === "local-unsynced") {
                                        debug(`PROTECTED: Skipping local unsynced recording: ${relPath}`);
                                        return false; // Do NOT overwrite local recordings!
                                    }
                                }

                                // Check if files/ version is already a full file
                                try {
                                    const filesExists = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
                                    const isPointer = await isPointerFile(filesPath);

                                    if (filesExists && !isPointer) {
                                        // Already have the full file
                                        debug(`File already downloaded: ${relPath}`);
                                        return false;
                                    }
                                } catch {
                                    // File doesn't exist, will download
                                }

                                // Parse pointer
                                const { parsePointerFile } = await import("./lfsHelpers");
                                const pointer = await parsePointerFile(pointerPath);

                                if (!pointer) {
                                    console.warn(`Invalid pointer file: ${relPath}`);
                                    return false;
                                }

                                // Download file
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
                                debug(`Downloaded: ${relPath}`);
                                return true;
                            } catch (error) {
                                console.error(`Failed to download ${relPath}:`, error);
                                return false;
                            }
                        })
                    );

                    for (const result of results) {
                        if (result.status === 'fulfilled' && result.value) {
                            downloadedCount++;
                        }
                    }

                    processed += batch.length;
                    progress.report({
                        increment: (batch.length / total) * 100,
                        message: `${processed}/${total}`,
                    });
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

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Cleaning up media placeholders...",
                cancellable: false,
            },
            async (progress) => {
                const total = Math.max(pointerFiles.length, 1);
                let processed = 0;

                // Process files in parallel batches - optimized
                const BATCH_SIZE = 100;
                const batches: string[][] = [];
                for (let i = 0; i < pointerFiles.length; i += BATCH_SIZE) {
                    batches.push(pointerFiles.slice(i, i + BATCH_SIZE));
                }

                for (const batch of batches) {
                    const results = await Promise.allSettled(
                        batch.map(async (relPath) => {
                            const filesPath = path.join(projectPath, ".project", "attachments", "files", relPath);
                            try {
                                // CRITICAL: Check if this is a locally recorded, unsynced file
                                // We MUST NOT delete local recordings!
                                const pathParts = relPath.split(path.sep);
                                if (pathParts.length >= 2) {
                                    const book = pathParts[0];
                                    const filename = pathParts.slice(1).join(path.sep);
                                    const { getFileStatus } = await import("./lfsHelpers");
                                    const status = await getFileStatus(projectPath, book, filename);

                                    if (status === "local-unsynced") {
                                        debug(`PROTECTED: Skipping local unsynced recording: ${relPath}`);
                                        return false; // Do NOT delete local recordings!
                                    }
                                }

                                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
                                // Quick size check: pointer files are tiny (~130 bytes)
                                if (stat && stat.size < 200) {
                                    // Likely a pointer stub, remove it
                                    await vscode.workspace.fs.delete(vscode.Uri.file(filesPath));
                                    return true;
                                }
                            } catch {
                                // files path missing is fine
                            }
                            return false;
                        })
                    );

                    for (const result of results) {
                        if (result.status === 'fulfilled' && result.value) {
                            removedCount++;
                        }
                    }

                    processed += batch.length;
                    progress.report({
                        increment: (batch.length / total) * 100,
                        message: `${processed}/${total}`,
                    });
                }

                progress.report({ increment: 100, message: "Complete" });
            }
        );
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

    // Mark as pending until the strategy application completes successfully
    try {
        // Mark state as applying for better diagnostics and resume behavior
        const settingsMod = await import("./localProjectSettings");
        try {
            const s = await settingsMod.readLocalProjectSettings(projectUri);
            s.mediaFileStrategyApplyState = "applying";
            await settingsMod.writeLocalProjectSettings(s, projectUri);
        } catch (e) {
            // Fallback to boolean mirror if direct write fails
            await settingsMod.setApplyState("applying", projectUri);
        }
    } catch (e) {
        // non-fatal; proceed to apply regardless of ability to persist flag immediately
        debug("Failed to set applying state before apply", e);
    }

    await applyMediaStrategy(projectUri, newStrategy);
    await setLastModeRun(newStrategy, projectUri);
    try {
        const settingsMod = await import("./localProjectSettings");
        await settingsMod.setApplyState("applied", projectUri);
    } catch (e) {
        // best effort already applied
    }
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
 * Replaces newly uploaded files in attachments/files with their pointer versions to save disk space
 * 
 * Note: Initial cleanup already happens when switching to stream-only mode via applyMediaStrategy.
 * This function only handles files that were just uploaded during this sync operation.
 * 
 * @param projectUri - URI of the project
 * @param uploadedFiles - List of files that were uploaded during sync. If empty/undefined, nothing to clean up.
 */
export async function postSyncCleanup(projectUri: vscode.Uri, uploadedFiles?: string[]): Promise<void> {
    try {
        const mediaStrategy = await getMediaFilesStrategy(projectUri);

        if (mediaStrategy !== "stream-only") {
            debug("Not in stream-only mode, skipping post-sync cleanup");
            return;
        }

        // Skip if no files were uploaded - nothing to clean up
        if (!uploadedFiles || uploadedFiles.length === 0) {
            debug("No files uploaded during sync, skipping post-sync cleanup");
            return;
        }

        debug(`Post-sync cleanup: processing ${uploadedFiles.length} uploaded file(s)`);
        const replacedCount = await replaceSpecificFilesWithPointers(projectUri.fsPath, uploadedFiles);

        if (replacedCount > 0) {
            debug(`Post-sync cleanup: replaced ${replacedCount} file(s) with pointers`);
        }
    } catch (error) {
        console.error("Error in post-sync cleanup:", error);
        // Don't throw - this is best-effort cleanup
    }
}

