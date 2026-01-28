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
    parsePointerContent,
} from "./lfsHelpers";
import { setCachedLfsBytes } from "./mediaCache";

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

            if (!relPath) continue;

            try {
                const pointerPath = path.join(projectPath, ".project", "attachments", "pointers", relPath);
                const filesPath = path.join(projectPath, ".project", "attachments", "files", relPath);

                // If files/ has real bytes, cache them in-memory before replacement
                const filesIsPointer = await isPointerFile(filesPath).catch(() => false);
                if (!filesIsPointer) {
                    const pointerContent = await vscode.workspace.fs.readFile(vscode.Uri.file(pointerPath));
                    const pointerText = Buffer.from(pointerContent).toString("utf8");
                    const pointerInfo = parsePointerContent(pointerText);
                    if (pointerInfo?.oid) {
                        const fileBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filesPath));
                        setCachedLfsBytes(pointerInfo.oid, fileBytes);
                    }
                }
            } catch {
                // Best-effort cache; continue to pointer replacement
            }

            const success = await replaceFileWithPointer(projectPath, relPath);
            if (success) {
                replacedCount++;
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
        // First, process any pending downloads from a project swap
        // These need to be downloaded from the OLD project's LFS before we download from the current project
        try {
            const projectUri = vscode.Uri.file(projectPath);
            const pendingDownloaded = await processPendingSwapDownloads(projectUri);
            downloadedCount += pendingDownloaded;
        } catch (pendingErr) {
            debug("Error processing pending swap downloads (non-fatal):", pendingErr);
        }

        // Before any downloads, enforce version gates (Frontier installed + project metadata requirements)
        try {
            const { ensureAllVersionGatesForMedia } = await import("./versionGate");
            const allowed = await ensureAllVersionGatesForMedia(true);
            if (!allowed) {
                // Block entire bulk download
                return downloadedCount; // Return any pending downloads we processed
            }
        } catch (gateErr) {
            console.warn("Blocking media download due to version requirements:", gateErr);
            return downloadedCount;
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
 * Perform smart recovery for interrupted strategy switches
 * This optimizes the recovery process by avoiding unnecessary work
 * 
 * @param projectUri - The project URI
 * @param targetStrategy - The strategy we want to switch to
 * @param lastStrategy - The last fully completed strategy
 * @returns true if smart recovery was applied, false if normal apply should proceed
 */
async function trySmartRecovery(
    projectUri: vscode.Uri,
    targetStrategy: MediaFilesStrategy,
    lastStrategy: MediaFilesStrategy | undefined
): Promise<boolean> {
    const projectPath = projectUri.fsPath;

    // Smart recovery scenario 1: auto-download -> (interrupted stream-only) -> auto-download
    // In this case, we likely have some media files still intact and some pointer stubs
    // Solution: Just remove pointer stubs (preserving media files), avoiding re-downloads
    if (lastStrategy === "auto-download" && targetStrategy === "auto-download") {
        debug("Smart recovery: auto-download -> interrupted switch -> auto-download");
        debug("Preserving existing media files and removing only pointer stubs");

        const removed = await removeFilesPointerStubs(projectPath);
        if (removed > 0) {
            vscode.window.showInformationMessage(
                `Recovered from interrupted switch. Preserved existing media files and cleaned up ${removed} placeholder(s).`
            );
        }
        return true;
    }

    // Smart recovery scenario 2: stream-only -> (interrupted auto-download) -> stream-only
    // In this case, we might have partially downloaded files mixed with pointers
    // Solution: Replace everything with pointers to ensure consistent state
    if (lastStrategy === "stream-only" && targetStrategy === "stream-only") {
        debug("Smart recovery: stream-only -> interrupted switch -> stream-only");
        debug("Ensuring all files are replaced with pointers");

        const replacedCount = await replaceFilesWithPointers(projectPath);
        if (replacedCount > 0) {
            vscode.window.showInformationMessage(
                `Recovered from interrupted switch. Ensured ${replacedCount} file(s) are set to stream-only mode.`
            );
        }
        return true;
    }

    // Smart recovery scenario 3: stream-and-save -> (interrupted) -> stream-and-save
    // Similar to stream-only, ensure pointers are in place
    if (lastStrategy === "stream-and-save" && targetStrategy === "stream-and-save") {
        debug("Smart recovery: stream-and-save -> interrupted switch -> stream-and-save");
        debug("Ensuring all files are replaced with pointers for streaming");

        const replacedCount = await replaceFilesWithPointers(projectPath);
        if (replacedCount > 0) {
            vscode.window.showInformationMessage(
                `Recovered from interrupted switch. Ensured ${replacedCount} file(s) are set to stream-and-save mode.`
            );
        }
        return true;
    }

    // For other scenarios (switching to a different strategy than last run),
    // fall through to normal apply logic
    debug(`No smart recovery applicable for ${lastStrategy} -> ${targetStrategy}, using normal apply`);
    return false;
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
        const settingsMod = await import("./localProjectSettings");
        const switchStarted = await settingsMod.getSwitchStarted(projectUri);

        // Only skip if returning to last run strategy AND no interrupted switch
        if (lastModeRun === newStrategy && !switchStarted) {
            await setMediaFilesStrategy(newStrategy, projectUri);
            await setLastModeRun(newStrategy, projectUri);
            await setChangesApplied(true, projectUri);
            await settingsMod.setSwitchStarted(false, projectUri);
            return;
        }

        // If there was an interrupted switch and we're returning to the same strategy,
        // try smart recovery to minimize unnecessary work
        if (lastModeRun === newStrategy && switchStarted) {
            debug("Detected interrupted switch, attempting smart recovery");
            const recovered = await trySmartRecovery(projectUri, newStrategy, lastModeRun);
            if (recovered) {
                // Smart recovery succeeded, just update flags
                await setMediaFilesStrategy(newStrategy, projectUri);
                await setLastModeRun(newStrategy, projectUri);
                await setChangesApplied(true, projectUri);
                await settingsMod.setSwitchStarted(false, projectUri);
                await settingsMod.setApplyState("applied", projectUri);
                return;
            }
            // If smart recovery didn't apply, fall through to normal apply
        }
    } catch {
        // If flags can't be read, fall through to normal apply path
    }

    // Mark as pending until the strategy application completes successfully
    try {
        // Mark state as applying for better diagnostics and resume behavior
        // Also set switchStarted flag to detect interruptions
        const settingsMod = await import("./localProjectSettings");
        try {
            const s = await settingsMod.readLocalProjectSettings(projectUri);
            s.mediaFileStrategyApplyState = "applying";
            // Initialize switchStarted to false if missing (one-time initialization)
            if (s.mediaFileStrategySwitchStarted === undefined) {
                s.mediaFileStrategySwitchStarted = false;
            }
            s.mediaFileStrategySwitchStarted = true; // Mark switch as started
            await settingsMod.writeLocalProjectSettings(s, projectUri);
        } catch (e) {
            // Fallback to setting flags individually if direct write fails
            await settingsMod.setApplyState("applying", projectUri);
            await settingsMod.setSwitchStarted(true, projectUri);
        }
    } catch (e) {
        // non-fatal; proceed to apply regardless of ability to persist flag immediately
        debug("Failed to set applying state before apply", e);
    }

    try {
        await applyMediaStrategy(projectUri, newStrategy);

        // Mark switch as complete: update lastModeRun and clear switchStarted flag
        await setLastModeRun(newStrategy, projectUri);
        try {
            const settingsMod = await import("./localProjectSettings");
            const s = await settingsMod.readLocalProjectSettings(projectUri);
            s.mediaFileStrategyApplyState = "applied";
            s.mediaFileStrategySwitchStarted = false; // Clear the flag on successful completion
            await settingsMod.writeLocalProjectSettings(s, projectUri);
        } catch (e) {
            // best effort already applied
            debug("Failed to clear switchStarted flag after successful apply", e);
        }
    } catch (error) {
        // Ensure switchStarted flag is always cleared on failure
        try {
            const settingsMod = await import("./localProjectSettings");
            const s = await settingsMod.readLocalProjectSettings(projectUri);
            s.mediaFileStrategyApplyState = "failed";
            s.mediaFileStrategySwitchStarted = false;
            await settingsMod.writeLocalProjectSettings(s, projectUri);
        } catch (writeErr) {
            try {
                const settingsMod = await import("./localProjectSettings");
                await settingsMod.setSwitchStarted(false, projectUri);
                await settingsMod.setApplyState("failed", projectUri);
            } catch (fallbackErr) {
                debug("Failed to reset switchStarted flag after failed apply", fallbackErr);
            }
            debug("Failed to write full settings after apply failure", writeErr);
        }
        throw error;
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

                if (removed > 0) {
                    vscode.window.showInformationMessage(
                        `Preparing to download ${removed} media file(s). ` +
                        "Your media will be automatically downloaded and saved on your device."
                    );
                }

                // Process any pending LFS downloads from a previous project swap
                // These files couldn't be downloaded during swap and need to be retrieved from old project's LFS
                try {
                    const pendingDownloaded = await processPendingSwapDownloads(projectUri);
                    if (pendingDownloaded > 0) {
                        debug(`Downloaded ${pendingDownloaded} pending swap files from old project LFS`);
                    }
                } catch (pendingError) {
                    debug("Error processing pending swap downloads (non-fatal):", pendingError);
                }
                break;
            }
            case "stream-only":
            case "stream-and-save": {
                // Replace files with pointers
                const replacedCount = await replaceFilesWithPointers(projectPath);

                if (newStrategy === "stream-only") {
                    if (replacedCount > 0) {
                        vscode.window.showInformationMessage(
                            `Freed up disk space by removing ${replacedCount} media file(s). ` +
                            "Your media will be streamed from the cloud when you need it."
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            "Your media will be streamed from the cloud when you need it."
                        );
                    }
                } else {
                    if (replacedCount > 0) {
                        vscode.window.showInformationMessage(
                            `Prepared ${replacedCount} media file(s) for streaming. ` +
                            "Media will be streamed and saved in the background for offline use when you need it."
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            "Media will be streamed and saved in the background for offline use when you need it."
                        );
                    }
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

        // If no files were reported as uploaded, fall back to a pointer scan
        if (!uploadedFiles || uploadedFiles.length === 0) {
            debug("No files uploaded during sync, scanning pointers for cleanup");
            const pointersDir = path.join(projectUri.fsPath, ".project", "attachments", "pointers");
            const pointerRelPaths = await findAllPointerFiles(pointersDir);
            if (pointerRelPaths.length === 0) {
                return;
            }
            const pointerPaths = pointerRelPaths.map((relPath) =>
                path.join(".project", "attachments", "pointers", relPath)
            );
            await replaceSpecificFilesWithPointers(projectUri.fsPath, pointerPaths);
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

/**
 * Process pending LFS downloads from a project swap
 * These are files that couldn't be downloaded during the swap and were stored for later retrieval
 * 
 * @param projectUri - URI of the project
 * @returns Number of files downloaded
 */
export async function processPendingSwapDownloads(projectUri: vscode.Uri): Promise<number> {
    const fs = await import("fs");
    const projectPath = projectUri.fsPath;
    const localSwapPath = path.join(projectPath, ".project", "localProjectSwap.json");
    
    // Check if there are pending downloads
    if (!fs.existsSync(localSwapPath)) {
        debug("No localProjectSwap.json found - no pending downloads");
        return 0;
    }

    let localSwap: any;
    try {
        localSwap = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
    } catch (error) {
        debug("Error reading localProjectSwap.json:", error);
        return 0;
    }

    const pendingDownloads = localSwap.pendingLfsDownloads;
    if (!pendingDownloads || !pendingDownloads.files || pendingDownloads.files.length === 0) {
        debug("No pending LFS downloads to process");
        return 0;
    }

    const { sourceRemoteUrl, files } = pendingDownloads;
    if (!sourceRemoteUrl) {
        debug("No source remote URL in pending downloads - cannot retrieve files");
        return 0;
    }

    debug(`Processing ${files.length} pending LFS downloads from swap`);

    // Get frontier API
    const { getAuthApi } = await import("../extension");
    const frontierApi = getAuthApi();
    if (!frontierApi?.downloadLFSFile) {
        debug("Frontier API not available - will retry pending downloads later");
        return 0;
    }

    const filesDir = path.join(projectPath, ".project", "attachments", "files");
    const pointersDir = path.join(projectPath, ".project", "attachments", "pointers");
    
    fs.mkdirSync(filesDir, { recursive: true });
    fs.mkdirSync(pointersDir, { recursive: true });

    let downloadedCount = 0;
    const failedFiles: Array<{ relPath: string; oid: string; size: number }> = [];
    const { createHash } = await import("crypto");

    // Show progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Downloading Media from Previous Project",
            cancellable: false,
        },
        async (progress) => {
            const total = files.length;
            let processed = 0;

            // Process in batches
            const BATCH_SIZE = 5;
            for (let i = 0; i < files.length; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (file: { relPath: string; oid: string; size: number }) => {
                    try {
                        const { relPath, oid, size } = file;
                        
                        // Check if file already exists (maybe downloaded through normal sync)
                        const filesPath = path.join(filesDir, relPath);
                        if (fs.existsSync(filesPath)) {
                            const existingIsPointer = await isPointerFile(filesPath);
                            if (!existingIsPointer) {
                                debug(`File already exists (not pointer): ${relPath}`);
                                downloadedCount++; // Count as success since file exists
                                return;
                            }
                        }

                        // Try to download from the old project's LFS
                        debug(`Downloading from old project LFS: ${relPath}`);
                        const content = await frontierApi.downloadLFSFile(sourceRemoteUrl, oid, size);
                        
                        if (!content) {
                            debug(`Download failed (empty response): ${relPath}`);
                            failedFiles.push(file);
                            return;
                        }

                        // Verify checksum
                        const hash = createHash("sha256").update(content).digest("hex");
                        if (hash !== oid) {
                            debug(`Checksum mismatch for ${relPath}: expected ${oid}, got ${hash}`);
                            failedFiles.push(file);
                            return;
                        }

                        // Write to files/ and pointers/
                        const pointersPath = path.join(pointersDir, relPath);
                        fs.mkdirSync(path.dirname(filesPath), { recursive: true });
                        fs.mkdirSync(path.dirname(pointersPath), { recursive: true });
                        
                        fs.writeFileSync(filesPath, content);
                        fs.writeFileSync(pointersPath, content);

                        // Cache for future use
                        setCachedLfsBytes(oid, content);

                        downloadedCount++;
                        debug(`Downloaded: ${relPath}`);
                    } catch (error) {
                        debug(`Error downloading ${file.relPath}:`, error);
                        failedFiles.push(file);
                    }

                    processed++;
                    progress.report({
                        increment: (1 / total) * 100,
                        message: `${processed}/${total} files`
                    });
                }));
            }
        }
    );

    // Update localProjectSwap.json
    if (failedFiles.length === 0) {
        // All downloads succeeded - remove pending downloads
        delete localSwap.pendingLfsDownloads;
        debug("All pending downloads completed - clearing from localProjectSwap.json");
    } else {
        // Some downloads failed - keep them for retry
        localSwap.pendingLfsDownloads.files = failedFiles;
        localSwap.pendingLfsDownloads.lastAttempt = Date.now();
        debug(`${failedFiles.length} downloads failed - keeping for retry`);
    }

    try {
        fs.writeFileSync(localSwapPath, JSON.stringify(localSwap, null, 2));
    } catch (error) {
        debug("Error updating localProjectSwap.json:", error);
    }

    if (downloadedCount > 0) {
        vscode.window.showInformationMessage(
            `Downloaded ${downloadedCount} media file(s) from previous project.` +
            (failedFiles.length > 0 ? ` ${failedFiles.length} file(s) could not be downloaded.` : "")
        );
    }

    return downloadedCount;
}

