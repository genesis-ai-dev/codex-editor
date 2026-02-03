import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import archiver from "archiver";
import { ProjectMetadata, LocalProjectSwap, ProjectSwapInfo, ProjectSwapEntry, ProjectSwapUserEntry } from "../../../types";
import { MetadataManager } from "../../utils/metadataManager";
import { extractProjectNameFromUrl, getGitOriginUrl, normalizeProjectSwapInfo, sanitizeGitUrl } from "../../utils/projectSwapManager";
import { validateAndFixProjectMetadata } from "../../projectManager/utils/projectUtils";
import { readLocalProjectSettings, writeLocalProjectSettings } from "../../utils/localProjectSettings";
import { getCodexProjectsDirectory } from "../../utils/projectLocationUtils";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";

const DEBUG = true;
const debugLog = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

/**
 * Result of swap prerequisites check
 */
export interface SwapPrerequisitesResult {
    /** Whether prerequisites are met and swap can proceed */
    canProceed: boolean;
    /** Files that need to be downloaded before swap (pointers in both files/ and pointers/) */
    filesNeedingDownload: string[];
    /** Total size of files needing download */
    downloadSizeBytes: number;
    /** Error message if check failed */
    error?: string;
}

/**
 * State stored in localProjectSwap.json for multi-step swap flow
 */
export interface SwapPendingDownloads {
    /** Current state of swap process */
    swapState: "pending_downloads" | "ready_to_swap";
    /** Files that need to be downloaded */
    filesNeedingDownload: string[];
    /** New project URL for resuming swap */
    newProjectUrl: string;
    /** Swap UUID for resuming */
    swapUUID: string;
    /** Swap initiated timestamp for resuming */
    swapInitiatedAt: number;
    /** Timestamp when this state was created */
    createdAt: number;
}

/**
 * Check if swap can proceed or if files need to be downloaded first
 * 
 * This compares the old project's attachments with what will be available in the new project.
 * Files are considered "needing download" if:
 * - They exist in the old project's pointers/ as actual pointers (not blobs)
 * - AND they exist in the old project's files/ also as pointers (not blobs)
 * - AND they DON'T already exist in the new project (either locally or in remote LFS)
 * 
 * If files need download, the caller should:
 * 1. Save state to localProjectSwap.json
 * 2. Set old project to "stream-and-save" 
 * 3. Open the old project to trigger downloads
 * 4. Resume swap when downloads complete
 */
export async function checkSwapPrerequisites(
    oldProjectPath: string,
    newProjectUrl: string
): Promise<SwapPrerequisitesResult> {
    const { isPointerFile, parsePointerFile } = await import("../../utils/lfsHelpers");

    const oldFilesDir = path.join(oldProjectPath, ".project", "attachments", "files");
    const oldPointersDir = path.join(oldProjectPath, ".project", "attachments", "pointers");

    const result: SwapPrerequisitesResult = {
        canProceed: true,
        filesNeedingDownload: [],
        downloadSizeBytes: 0
    };

    try {
        // Scan old project's attachments
        const oldAttachments = await scanAttachmentFiles(oldPointersDir);

        if (oldAttachments.length === 0) {
            debugLog("No attachments in old project - swap can proceed");
            return result;
        }

        debugLog(`Checking ${oldAttachments.length} attachments for download requirements...`);

        // Get list of files that already exist in the new project
        // Check BOTH local AND remote to get the complete picture
        const newProjectName = extractProjectNameFromUrl(newProjectUrl);
        const newProjectPath = newProjectName
            ? path.join(path.dirname(oldProjectPath), newProjectName)
            : null;

        const newProjectPointers = new Set<string>();

        // Check local new project if it exists
        if (newProjectPath && fs.existsSync(newProjectPath)) {
            const newPointersDir = path.join(newProjectPath, ".project", "attachments", "pointers");
            if (fs.existsSync(newPointersDir)) {
                const newAttachments = await scanAttachmentFiles(newPointersDir);
                newAttachments.forEach(f => newProjectPointers.add(f));
                debugLog(`Found ${newAttachments.length} existing files in new project (local)`);
            }
        }

        // ALWAYS check remote to get complete file list (remote may have files local doesn't)
        try {
            const { getAuthApi } = await import("../../extension");
            const frontierApi = getAuthApi() as any;
            if (frontierApi?.getRepositoryTree) {
                const treeFiles = await frontierApi.getRepositoryTree(
                    newProjectUrl,
                    ".project/attachments/pointers"
                );
                if (treeFiles && Array.isArray(treeFiles)) {
                    treeFiles.forEach((f: { path?: string; type?: string; name?: string; }) => {
                        if (f.type === "blob") {
                            // The path from GitLab includes the full path, extract relative part
                            const relPath = f.path
                                ? f.path.replace(/^\.project\/attachments\/pointers\/?/, "")
                                : f.name;
                            if (relPath && !relPath.startsWith(".")) {
                                newProjectPointers.add(relPath);
                            }
                        }
                    });
                    debugLog(`Found ${newProjectPointers.size} total files in new project (local + remote)`);
                }
            }
        } catch (err) {
            debugLog("Could not check new project remote files:", err);
            // Continue without the remote check
        }

        // Check each attachment to see if it's available as a blob
        for (const relPath of oldAttachments) {
            // Skip if this file already exists in the new project
            if (newProjectPointers.has(relPath)) {
                continue;
            }

            // File doesn't exist in new project - check if we have a local blob in old project
            const filesPath = path.join(oldFilesDir, relPath);
            const pointersPath = path.join(oldPointersDir, relPath);

            let hasBlob = false;

            // Check files/ directory
            if (fs.existsSync(filesPath)) {
                const isPtrInFiles = await isPointerFile(filesPath);
                if (!isPtrInFiles) {
                    hasBlob = true;
                }
            }

            // Check pointers/ directory (might have blob if recently recorded)
            if (!hasBlob && fs.existsSync(pointersPath)) {
                const isPtrInPointers = await isPointerFile(pointersPath);
                if (!isPtrInPointers) {
                    hasBlob = true;
                }
            }

            // If no blob found anywhere, this file needs to be downloaded before swap
            if (!hasBlob) {
                result.filesNeedingDownload.push(relPath);

                // Try to get file size from pointer
                const pointerPath = fs.existsSync(filesPath) ? filesPath : pointersPath;
                if (fs.existsSync(pointerPath)) {
                    const pointer = await parsePointerFile(pointerPath);
                    if (pointer?.size) {
                        result.downloadSizeBytes += pointer.size;
                    }
                }
            }
        }


        if (result.filesNeedingDownload.length > 0) {
            result.canProceed = false;
            debugLog(`${result.filesNeedingDownload.length} files need download (${formatBytes(result.downloadSizeBytes)})`);
        } else {
            debugLog("All attachments available as blobs - swap can proceed");
        }

        return result;
    } catch (error) {
        debugLog("Error checking swap prerequisites:", error);
        result.error = error instanceof Error ? error.message : String(error);
        // On error, allow proceed but log warning
        return result;
    }
}

/**
 * Save swap state for resuming after downloads complete
 */
export async function saveSwapPendingState(
    oldProjectPath: string,
    pendingState: SwapPendingDownloads
): Promise<void> {
    const localSwapPath = path.join(oldProjectPath, ".project", "localProjectSwap.json");

    let localSwap: any = {};
    if (fs.existsSync(localSwapPath)) {
        try {
            localSwap = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
        } catch {
            localSwap = {};
        }
    }

    localSwap.swapPendingDownloads = pendingState;

    fs.mkdirSync(path.dirname(localSwapPath), { recursive: true });
    fs.writeFileSync(localSwapPath, JSON.stringify(localSwap, null, 2));

    debugLog("Saved swap pending state:", pendingState.swapState);
}

/**
 * Get swap pending state from localProjectSwap.json
 */
export async function getSwapPendingState(
    projectPath: string
): Promise<SwapPendingDownloads | null> {
    const localSwapPath = path.join(projectPath, ".project", "localProjectSwap.json");

    if (!fs.existsSync(localSwapPath)) {
        return null;
    }

    try {
        const localSwap = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
        return localSwap.swapPendingDownloads || null;
    } catch {
        return null;
    }
}

/**
 * Clear swap pending state after swap completes or is cancelled
 */
export async function clearSwapPendingState(projectPath: string): Promise<void> {
    const localSwapPath = path.join(projectPath, ".project", "localProjectSwap.json");

    if (!fs.existsSync(localSwapPath)) {
        return;
    }

    try {
        const localSwap = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
        delete localSwap.swapPendingDownloads;
        fs.writeFileSync(localSwapPath, JSON.stringify(localSwap, null, 2));
        debugLog("Cleared swap pending state");
    } catch (error) {
        debugLog("Error clearing swap pending state:", error);
    }
}

/**
 * Check if pending downloads are complete (all files now have blobs)
 */
export async function checkPendingDownloadsComplete(
    projectPath: string
): Promise<{ complete: boolean; remaining: string[]; }> {
    const pendingState = await getSwapPendingState(projectPath);

    if (!pendingState || pendingState.swapState !== "pending_downloads") {
        return { complete: true, remaining: [] };
    }

    const { isPointerFile } = await import("../../utils/lfsHelpers");
    const filesDir = path.join(projectPath, ".project", "attachments", "files");

    const remaining: string[] = [];

    for (const relPath of pendingState.filesNeedingDownload) {
        const filesPath = path.join(filesDir, relPath);

        if (!fs.existsSync(filesPath)) {
            remaining.push(relPath);
            continue;
        }

        const isPtr = await isPointerFile(filesPath);
        if (isPtr) {
            remaining.push(relPath);
        }
    }

    return {
        complete: remaining.length === 0,
        remaining
    };
}

/**
 * Download pending swap files in bulk
 * This proactively downloads all LFS files needed for swap rather than waiting for user interaction
 * 
 * @param projectPath - Path to the project
 * @param progress - Optional progress reporter for UI
 * @returns Promise resolving to { downloaded: number, failed: string[], total: number }
 */
export async function downloadPendingSwapFiles(
    projectPath: string,
    progress?: vscode.Progress<{ increment?: number; message?: string; }>
): Promise<{ downloaded: number; failed: string[]; total: number; }> {
    const pendingState = await getSwapPendingState(projectPath);

    if (!pendingState || pendingState.swapState !== "pending_downloads") {
        return { downloaded: 0, failed: [], total: 0 };
    }

    const { isPointerFile, parsePointerFile } = await import("../../utils/lfsHelpers");
    const filesDir = path.join(projectPath, ".project", "attachments", "files");
    const pointersDir = path.join(projectPath, ".project", "attachments", "pointers");

    // Get frontier API for LFS downloads
    const { getAuthApi } = await import("../../extension");
    const frontierApi = getAuthApi();

    if (!frontierApi) {
        debugLog("Frontier API not available for LFS downloads");
        return {
            downloaded: 0,
            failed: pendingState.filesNeedingDownload,
            total: pendingState.filesNeedingDownload.length
        };
    }

    const total = pendingState.filesNeedingDownload.length;
    let downloaded = 0;
    const failed: string[] = [];

    debugLog(`Starting bulk download of ${total} LFS files for swap...`);

    for (let i = 0; i < total; i++) {
        const relPath = pendingState.filesNeedingDownload[i];
        const filesPath = path.join(filesDir, relPath);
        const pointersPath = path.join(pointersDir, relPath);

        progress?.report({
            message: `${downloaded}/${total} - Downloading: ${path.basename(relPath)}`
        });

        try {
            // Check if already downloaded (has blob in files/)
            if (fs.existsSync(filesPath)) {
                const isPtr = await isPointerFile(filesPath);
                if (!isPtr) {
                    debugLog(`File already downloaded: ${relPath}`);
                    downloaded++;
                    progress?.report({
                        increment: 100 / total,
                        message: `${downloaded}/${total} files complete`
                    });
                    continue;
                }
            }

            // Get pointer info from either files/ or pointers/
            const pointerPath = fs.existsSync(filesPath) ? filesPath : pointersPath;
            if (!fs.existsSync(pointerPath)) {
                debugLog(`Pointer file not found: ${relPath}`);
                failed.push(relPath);
                continue;
            }

            const pointer = await parsePointerFile(pointerPath);
            if (!pointer) {
                debugLog(`Invalid pointer file: ${relPath}`);
                failed.push(relPath);
                continue;
            }

            // Download from LFS
            debugLog(`Downloading LFS file: ${relPath} (OID=${pointer.oid.substring(0, 8)}...)`);
            const lfsData = await frontierApi.downloadLFSFile(
                projectPath,
                pointer.oid,
                pointer.size
            );

            // Save to files/ directory
            const filesParentDir = path.dirname(filesPath);
            if (!fs.existsSync(filesParentDir)) {
                fs.mkdirSync(filesParentDir, { recursive: true });
            }
            fs.writeFileSync(filesPath, lfsData);

            downloaded++;
            debugLog(`Downloaded: ${relPath}`);
            progress?.report({
                increment: 100 / total,
                message: `${downloaded}/${total} files complete`
            });

        } catch (error) {
            debugLog(`Failed to download ${relPath}:`, error);
            failed.push(relPath);
        }
    }

    debugLog(`Bulk download complete: ${downloaded}/${total} succeeded, ${failed.length} failed`);
    return { downloaded, failed, total };
}

/**
 * Perform a complete project swap
 * Backs up old project, clones new one, merges files, updates remotes
 * 
 * @param progress - VS Code progress reporter
 * @param projectName - Name of the project
 * @param oldProjectPath - Path to the old project
 * @param newProjectUrl - Git URL of the new project
 * @param swapUUID - Chain identifier linking all projects in swap lineage (original -> swapped -> re-swapped)
 * @param swapInitiatedAt - Timestamp from OLD project's active entry (for matching entries in NEW project)
 * @returns Promise resolving to new project path
 */
export async function performProjectSwap(
    progress: vscode.Progress<{ increment?: number; message?: string; }>,
    projectName: string,
    oldProjectPath: string,
    newProjectUrl: string,
    swapUUID: string,
    swapInitiatedAt: number
): Promise<string> {
    debugLog("Starting project swap:", { projectName, oldProjectPath, newProjectUrl, swapUUID, swapInitiatedAt });
    const targetFolderName = extractProjectNameFromUrl(newProjectUrl) || projectName;
    const targetProjectPath = path.join(path.dirname(oldProjectPath), targetFolderName);

    // Track local swap state
    const projectUri = vscode.Uri.file(oldProjectPath);
    const localSwap: LocalProjectSwap = {
        pendingSwap: true,
        swapUUID,
        swapInProgress: true,
        swapAttempts: 1,
    };

    // Read existing settings BEFORE the try block so they're accessible in the catch block
    // IMPORTANT: This preserves the user's media strategy throughout the swap
    const existingOldSettings = await readLocalProjectSettings(projectUri);

    try {
        // Update local state - preserve existing settings (especially media strategy)
        await writeLocalProjectSettings(
            { ...existingOldSettings, projectSwap: localSwap },
            projectUri
        );

        // Step 1: Backup old project
        progress.report({ increment: 5, message: "Backing up current project..." });
        const backupPath = await backupOldProject(oldProjectPath, projectName);
        localSwap.backupPath = backupPath;
        await writeLocalProjectSettings({ ...existingOldSettings, projectSwap: localSwap }, projectUri);

        debugLog("Backup created at:", backupPath);

        // Step 2: Move old project to a temporary path
        progress.report({ increment: 5, message: "Preparing temporary snapshot..." });
        const parentDir = path.dirname(oldProjectPath);
        const tmpPath = path.join(parentDir, `${projectName}_tmp_${Date.now()}`);
        fs.renameSync(oldProjectPath, tmpPath);
        debugLog("Old project moved to tmp:", tmpPath);

        // Step 3: Create temporary workspace for cloning
        progress.report({ increment: 5, message: "Creating temporary workspace..." });
        const tempDir = await createTempWorkspace();
        debugLog("Temp workspace created:", tempDir);

        try {
            // Step 4: Get the new project - either from existing local copy or by cloning
            progress.report({ increment: 15, message: "Preparing new project..." });
            const newProjectPath = await getOrCloneNewProject(
                newProjectUrl,
                tempDir,
                path.dirname(oldProjectPath),
                progress
            );
            debugLog("New project ready at:", newProjectPath);

            // Step 5: Verify structure compatibility
            progress.report({ increment: 5, message: "Verifying project structure..." });
            await verifyStructureCompatibility(tmpPath, newProjectPath);

            // Step 6: Merge tmp snapshot into the newly-cloned project using resolvers
            progress.report({ increment: 20, message: "Merging project files..." });
            await mergeProjectFiles(tmpPath, newProjectPath, progress);

            // Step 7: Update metadata with swap completion
            progress.report({ increment: 5, message: "Updating project metadata..." });
            const oldOriginUrl = await getGitOriginUrl(tmpPath);
            // Sanitize URLs to remove any embedded credentials (tokens/passwords)
            await updateSwapMetadata(newProjectPath, swapUUID, false, {
                newProjectUrl: sanitizeGitUrl(newProjectUrl),
                newProjectName: targetFolderName,
                oldProjectUrl: oldOriginUrl ? sanitizeGitUrl(oldOriginUrl) : undefined,
                oldProjectName: projectName,
                swapInitiatedAt, // Pass the timestamp from OLD project for entry matching
            });

            // Ensure metadata integrity (projectName, scope, etc.)
            await validateAndFixProjectMetadata(vscode.Uri.file(newProjectPath));

            // Ensure LFS source URL is carried over for healing on the new repo
            try {
                const oldSettings = await readLocalProjectSettings(vscode.Uri.file(tmpPath));
                let lfsSourceRemoteUrl = oldSettings.lfsSourceRemoteUrl;
                if (!lfsSourceRemoteUrl) {
                    const rawUrl = await getGitOriginUrl(tmpPath);
                    lfsSourceRemoteUrl = rawUrl ? sanitizeGitUrl(rawUrl) : undefined;
                }
                if (lfsSourceRemoteUrl) {
                    const newSettings = await readLocalProjectSettings(vscode.Uri.file(newProjectPath));
                    // Ensure lfsSourceRemoteUrl is also sanitized (in case old settings had credentials)
                    newSettings.lfsSourceRemoteUrl = sanitizeGitUrl(lfsSourceRemoteUrl);
                    await writeLocalProjectSettings(newSettings, vscode.Uri.file(newProjectPath));
                }
            } catch {
                // best-effort
            }

            // Step 8: Mark old project (_tmp folder) for deletion before attempting cleanup
            // Write a marker file first so if deletion fails, it can be cleaned up later by projects list
            const tmpUri = vscode.Uri.file(tmpPath);
            try {
                const { writeLocalProjectSwapFile, readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");
                const existingSwapFile = await readLocalProjectSwapFile(tmpUri);
                await writeLocalProjectSwapFile({
                    remoteSwapInfo: existingSwapFile?.remoteSwapInfo || { swapEntries: [] },
                    fetchedAt: existingSwapFile?.fetchedAt || Date.now(),
                    sourceOriginUrl: existingSwapFile?.sourceOriginUrl || "",
                    markedForDeletion: true,
                    swapCompletedAt: Date.now(),
                }, tmpUri);
                debugLog("Marked old project folder for deletion:", tmpPath);
            } catch (markerErr) {
                debugLog("Could not write deletion marker (non-fatal):", markerErr);
            }

            // Step 8b: Promote cloned project to canonical location (new name)
            // This will also attempt to delete the old _tmp folder
            progress.report({ increment: 15, message: "Swapping project directories..." });
            await swapDirectories(tmpPath, newProjectPath, targetProjectPath);

            // Step 9: Finalize local settings on the NEW project
            // Clear projectSwap entirely - it tracked the swap execution which is now complete.
            // The NEW project doesn't need the old project's swap execution state (swapUUID, backupPath, etc.)
            // IMPORTANT: Read existing settings first to preserve media strategy that was set by copyLocalProjectSettings
            progress.report({ increment: 5, message: "Finalizing swap..." });
            const finalProjectUri = vscode.Uri.file(targetProjectPath);
            const existingSettings = await readLocalProjectSettings(finalProjectUri);
            await writeLocalProjectSettings({
                ...existingSettings,
                projectSwap: undefined,
            }, finalProjectUri);
            debugLog("Cleared projectSwap from localProjectSettings.json (swap complete, preserved media strategy)");

            // Step 9b: Update projectName in metadata to match the new folder name
            // This is critical after a swap - the old projectName may have been merged from the old project
            try {
                await updateProjectNameToMatchFolder(finalProjectUri, targetFolderName);
            } catch (err) {
                debugLog("Warning: Could not update projectName (non-fatal):", err);
            }

            // Step 9c: Delete localProjectSwap.json from the new project
            // This cached swap info was for the OLD project's origin and has wrong isOldProject value.
            // The new project will fetch fresh swap info from its own remote when needed.
            try {
                const { deleteLocalProjectSwapFile } = await import("../../utils/localProjectSettings");
                await deleteLocalProjectSwapFile(finalProjectUri);
                debugLog("Deleted stale localProjectSwap.json from new project");
            } catch {
                // Non-fatal - file might not exist
            }

            // Step 10: Cleanup temp directory (the system temp used for cloning)
            await cleanupTempDirectory(tempDir);

            progress.report({ increment: 15, message: "Swap complete!" });
            debugLog("Project swap completed successfully");

            return targetProjectPath;

        } catch (error) {
            debugLog("Error during swap, cleaning up temp directory:", error);
            await cleanupTempDirectory(tempDir);
            try {
                if (!fs.existsSync(oldProjectPath) && fs.existsSync(tmpPath)) {
                    fs.renameSync(tmpPath, oldProjectPath);
                }
            } catch {
                // ignore restore failure
            }
            throw error;
        }

    } catch (error) {
        debugLog("Project swap failed:", error);

        // Update local state with error - preserve existing settings (especially media strategy)
        localSwap.swapInProgress = false;
        localSwap.lastAttemptTimestamp = Date.now();
        localSwap.lastAttemptError = error instanceof Error ? error.message : String(error);
        await writeLocalProjectSettings({ ...existingOldSettings, projectSwap: localSwap }, projectUri);
        // Error state is tracked only in localProjectSettings.json, not in metadata

        throw error;
    }
}

/**
 * Backup old project to .zip file
 */
async function backupOldProject(projectPath: string, projectName: string): Promise<string> {
    const codexProjectsRoot = await getCodexProjectsDirectory();
    const backupDir = path.join(codexProjectsRoot.fsPath, "archived_projects");

    return new Promise<string>((resolve, reject) => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupFileName = `${projectName}-swap-backup-${timestamp}.zip`;
            const backupPath = path.join(backupDir, backupFileName);

            // Ensure backup directory exists
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const output = fs.createWriteStream(backupPath);
            const archive = archiver("zip", { zlib: { level: 9 } });

            output.on("close", () => {
                debugLog(`Backup created: ${archive.pointer()} bytes`);
                resolve(backupPath);
            });

            archive.on("error", (err: Error) => {
                reject(err);
            });

            archive.pipe(output);

            // Add entire project directory to archive
            archive.directory(projectPath, projectName);

            // Finalize returns a promise but we handle completion via the 'close' event
            archive.finalize().catch(reject);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Create temporary workspace directory
 */
async function createTempWorkspace(): Promise<string> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-swap-"));
    return tempDir;
}

/**
 * Get the new project - either use existing local copy or clone from remote
 * This preserves local uncommitted changes if the project already exists locally
 */
async function getOrCloneNewProject(
    gitUrl: string,
    tempDir: string,
    projectsParentDir: string,
    progress: vscode.Progress<{ increment?: number; message?: string; }>
): Promise<string> {
    const projectName = extractProjectNameFromUrl(gitUrl);
    const existingLocalPath = path.join(projectsParentDir, projectName);
    const targetPath = path.join(tempDir, projectName);

    // Check if the NEW project already exists locally
    if (fs.existsSync(existingLocalPath) && fs.existsSync(path.join(existingLocalPath, "metadata.json"))) {
        debugLog("Found existing local copy of new project at:", existingLocalPath);
        progress.report({ message: "Using existing local project (preserving local changes)..." });

        // Copy the existing local project to temp (preserving all local changes)
        await copyDirectory(existingLocalPath, targetPath);
        debugLog("Copied existing project to temp:", targetPath);

        return targetPath;
    }

    // No local copy found - clone from remote
    debugLog("No existing local copy found, cloning from remote");
    progress.report({ message: "Cloning new project repository..." });
    return await cloneNewProject(gitUrl, tempDir, progress);
}

/**
 * Clone new project repository
 */
async function cloneNewProject(
    gitUrl: string,
    tempDir: string,
    progress: vscode.Progress<{ increment?: number; message?: string; }>
): Promise<string> {
    // Use Frontier API to clone the repository
    const frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
    if (!frontierExtension) {
        throw new Error("Frontier Authentication extension not found");
    }

    if (!frontierExtension.isActive) {
        await frontierExtension.activate();
    }

    const frontierApi = frontierExtension.exports;
    if (!frontierApi?.cloneRepository) {
        throw new Error("Frontier API not available");
    }

    // Clone to temp directory
    const projectName = extractProjectNameFromUrl(gitUrl);
    const clonePath = path.join(tempDir, projectName);

    debugLog("Cloning to:", clonePath);

    // Clone without opening workspace
    const success = await frontierApi.cloneRepository(
        gitUrl,
        clonePath,
        false, // Don't open workspace
        undefined // Use default media strategy
    );

    if (!success) {
        throw new Error("Failed to clone new project repository");
    }

    return clonePath;
}

/**
 * Verify that old and new projects have compatible structures
 */
async function verifyStructureCompatibility(oldPath: string, newPath: string): Promise<void> {
    debugLog("Verifying structure compatibility");

    // Check that both have metadata.json
    const oldMetadata = path.join(oldPath, "metadata.json");
    const newMetadata = path.join(newPath, "metadata.json");

    if (!fs.existsSync(oldMetadata)) {
        throw new Error("Old project missing metadata.json");
    }

    if (!fs.existsSync(newMetadata)) {
        throw new Error("New project missing metadata.json");
    }

    // Check that both are Codex projects (have .codex directory or will have one)
    // New projects might not have .codex yet, so we just ensure metadata exists

    debugLog("Structure verification passed");
}

/**
 * Merge files from old project into new project
 * Preserves: .codex/, .source/, localProjectSettings.json
 */
async function mergeProjectFiles(
    oldPath: string,
    newPath: string,
    progress: vscode.Progress<{ increment?: number; message?: string; }>
): Promise<void> {
    debugLog("Merging project files using resolvers");

    const newProjectUri = vscode.Uri.file(newPath);
    const oldProjectUri = vscode.Uri.file(oldPath);

    const { textConflicts, binaryCopies } = await buildConflictsFromDirectories({
        oursRoot: oldProjectUri,
        theirsRoot: newProjectUri,
        exclude: (relativePath) => {
            // Exclude database files
            if (
                relativePath.endsWith(".sqlite") ||
                relativePath.endsWith(".sqlite3") ||
                relativePath.endsWith(".db")
            ) {
                return true;
            }
            // Exclude localProjectSwap.json - this is a local cache of remote swap info
            // specific to each project's origin URL. Carrying it over from the old project
            // would cause isOldProject to be wrong (old project has true, new has false)
            if (relativePath === ".project/localProjectSwap.json") {
                return true;
            }

            // Exclude LFS pointers - they reference the OLD project's LFS storage
            // New pointers will be generated when the project syncs
            if (relativePath.includes(".project/attachments/pointers/") ||
                relativePath.includes(".project\\attachments\\pointers\\")) {
                return true;
            }

            return false;
        },
        isBinary: (relativePath) => isBinaryFile(relativePath),
    });

    debugLog("Swap merge inputs prepared:", {
        textConflicts: textConflicts.length,
        binaryCopies: binaryCopies.length,
    });

    if (textConflicts.length > 0) {
        debugLog(`Merging ${textConflicts.length} text files with resolver pipeline...`);
        await resolveConflictFiles(textConflicts, newProjectUri.fsPath, { refreshOursFromDisk: false });
    }

    if (binaryCopies.length > 0) {
        debugLog(`Copying ${binaryCopies.length} binary files from tmp...`);
        const uniqueDirs = new Set<string>();
        for (const file of binaryCopies) {
            const dir = path.posix.dirname(file.filepath);
            if (dir && dir !== ".") {
                uniqueDirs.add(dir);
            }
        }
        const sortedDirs = Array.from(uniqueDirs).sort(
            (a, b) => a.split("/").length - b.split("/").length
        );
        for (const dir of sortedDirs) {
            const dirUri = vscode.Uri.joinPath(newProjectUri, ...dir.split("/"));
            await ensureDirectoryExists(dirUri);
        }

        for (const file of binaryCopies) {
            const targetUri = vscode.Uri.joinPath(newProjectUri, ...file.filepath.split("/"));
            await vscode.workspace.fs.writeFile(targetUri, file.content);
        }
    }

    // After merging:
    // 1. Download any missing files to the OLD project (from its LFS)
    // 2. Copy ALL files and pointers from OLD to NEW project
    // 3. Copy localProjectSettings.json (preserving media settings, adding forceClose flag)
    const reconcileResult = await reconcileAndCopyAttachments(oldPath, newPath, progress);

    // Copy local project settings from old to new (preserving media strategy as-is)
    await copyLocalProjectSettings(oldPath, newPath, reconcileResult.failedDownloads);
}

/**
 * Copy localProjectSettings.json from old project to new project.
 * 
 * This preserves all settings (including media strategy) exactly as they were in the old project.
 * Since we copy ALL files from old to new, the files are already in the correct state for the
 * user's media strategy - no reconciliation needed.
 * 
 * Changes made:
 * - Remove `projectSwap` (old project's swap tracking info, not relevant for new project)
 */
async function copyLocalProjectSettings(
    oldPath: string,
    newPath: string,
    failedDownloads: Array<{ relPath: string; oid: string; size: number; }>
): Promise<void> {
    try {
        const { readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");

        // Read all settings from old project
        const oldProjectUri = vscode.Uri.file(oldPath);
        const oldSettings = await readLocalProjectSettings(oldProjectUri);

        const newProjectUri = vscode.Uri.file(newPath);

        // Copy settings to new project, but:
        // - Remove projectSwap (old project's tracking, not relevant for new)
        const { projectSwap, ...settingsWithoutSwap } = oldSettings;
        const newSettings = {
            ...settingsWithoutSwap,
        };

        debugLog(`Copying localProjectSettings from old to new project (strategy: ${oldSettings.currentMediaFilesStrategy || "auto-download"})`);
        await writeLocalProjectSettings(newSettings, newProjectUri);

        // If there are failed downloads, store them for later retrieval
        if (failedDownloads.length > 0) {
            debugLog(`${failedDownloads.length} files need download from old LFS`);
            const oldProjectRemoteUrl = await getGitOriginUrl(oldPath);
            if (oldProjectRemoteUrl) {
                await storePendingLfsDownloads(newPath, oldProjectRemoteUrl, failedDownloads);
            } else {
                debugLog("Warning: Could not get old project remote URL - pending downloads may not be retrievable");
            }
        }

        // Clear the pending swap state from the old project since swap is complete
        await clearSwapPendingState(oldPath);

    } catch (error) {
        debugLog("Error copying local project settings:", error);
        // Non-fatal - continue with swap
    }
}

/**
 * Store pending LFS downloads in localProjectSwap.json
 * These files couldn't be downloaded during swap and need to be retrieved later
 */
async function storePendingLfsDownloads(
    newProjectPath: string,
    oldProjectRemoteUrl: string,
    pendingFiles: Array<{ relPath: string; oid: string; size: number; }>
): Promise<void> {
    try {
        const localSwapPath = path.join(newProjectPath, ".project", "localProjectSwap.json");

        let localSwap: any = {};
        if (fs.existsSync(localSwapPath)) {
            try {
                localSwap = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            } catch {
                localSwap = {};
            }
        }

        // Add pending downloads with source URL so we know where to fetch from
        localSwap.pendingLfsDownloads = {
            sourceRemoteUrl: oldProjectRemoteUrl,
            files: pendingFiles,
            addedAt: Date.now()
        };

        fs.mkdirSync(path.dirname(localSwapPath), { recursive: true });
        fs.writeFileSync(localSwapPath, JSON.stringify(localSwap, null, 2));

        debugLog(`Stored ${pendingFiles.length} pending LFS downloads in localProjectSwap.json`);
    } catch (error) {
        debugLog("Error storing pending LFS downloads:", error);
    }
}

/**
 * Result of attachment reconciliation
 */
interface ReconcileResult {
    copied: number;
    downloaded: number;
    failed: number;
    failedDownloads: Array<{ relPath: string; oid: string; size: number; }>;
}

/**
 * Cross-reference old and new project attachments, copying only what's missing.
 * 
 * Scenarios handled:
 * Cleaner approach:
 * 1. Download any missing files TO THE OLD PROJECT (from its LFS)
 * 2. Copy ALL files and pointers from OLD to NEW (simple overwrite)
 * 
 * This way the old project becomes the "source of truth" and we just copy everything.
 * Files end up in exactly the same state they were in the old project.
 */
async function reconcileAndCopyAttachments(
    oldPath: string,
    newPath: string,
    progress: vscode.Progress<{ increment?: number; message?: string; }>
): Promise<ReconcileResult> {
    const { isPointerFile, parsePointerFile } = await import("../../utils/lfsHelpers");

    const oldFilesDir = path.join(oldPath, ".project", "attachments", "files");
    const oldPointersDir = path.join(oldPath, ".project", "attachments", "pointers");
    const newFilesDir = path.join(newPath, ".project", "attachments", "files");
    const newPointersDir = path.join(newPath, ".project", "attachments", "pointers");

    const result: ReconcileResult = {
        copied: 0,
        downloaded: 0,
        failed: 0,
        failedDownloads: []
    };

    // Scan old project for all attachment files (union of files/ and pointers/)
    const oldFilesAttachments = await scanAttachmentFiles(oldFilesDir);
    const oldPointersAttachments = await scanAttachmentFiles(oldPointersDir);
    const allOldAttachments = new Set([...oldFilesAttachments, ...oldPointersAttachments]);

    if (allOldAttachments.size === 0) {
        debugLog("No attachments in old project to copy");
        return result;
    }

    debugLog(`Found ${allOldAttachments.size} attachments in old project`);

    // Step 1: Find files that need to be downloaded TO THE OLD PROJECT
    // These are files where we don't have a local blob (only pointers)
    const toDownloadToOld: Array<{ relPath: string; pointer: { oid: string; size: number; }; }> = [];

    for (const relPath of allOldAttachments) {
        const oldFilePath = path.join(oldFilesDir, relPath);
        const oldPointerPath = path.join(oldPointersDir, relPath);

        let hasBlob = false;
        let pointer: { oid: string; size: number; } | null = null;

        // Check if we have a blob anywhere in the old project
        if (fs.existsSync(oldFilePath)) {
            const isPtr = await isPointerFile(oldFilePath);
            if (!isPtr) {
                hasBlob = true;
            } else {
                pointer = await parsePointerFile(oldFilePath);
            }
        }

        if (!hasBlob && fs.existsSync(oldPointerPath)) {
            const isPtr = await isPointerFile(oldPointerPath);
            if (!isPtr) {
                hasBlob = true;
            } else if (!pointer) {
                pointer = await parsePointerFile(oldPointerPath);
            }
        }

        // If no blob found, we need to download to old project first
        if (!hasBlob && pointer) {
            toDownloadToOld.push({ relPath, pointer });
        }
    }

    // Step 2: Download missing files TO THE OLD PROJECT
    if (toDownloadToOld.length > 0) {
        const totalDownloadSize = toDownloadToOld.reduce((sum, item) => sum + item.pointer.size, 0);
        debugLog(`Downloading ${toDownloadToOld.length} missing files to old project (${formatBytes(totalDownloadSize)})`);
        progress.report({ message: `Downloading ${toDownloadToOld.length} missing files...` });

        const { getAuthApi } = await import("../../extension");
        const frontierApi = getAuthApi();
        const oldProjectRemoteUrl = await getGitOriginUrl(oldPath);

        if (!frontierApi?.downloadLFSFile) {
            debugLog("Warning: LFS download API not available");
            for (const { relPath, pointer } of toDownloadToOld) {
                result.failedDownloads.push({ relPath, oid: pointer.oid, size: pointer.size });
            }
            result.failed += toDownloadToOld.length;
        } else if (!oldProjectRemoteUrl) {
            debugLog("Warning: Could not get old project remote URL");
            for (const { relPath, pointer } of toDownloadToOld) {
                result.failedDownloads.push({ relPath, oid: pointer.oid, size: pointer.size });
            }
            result.failed += toDownloadToOld.length;
        } else {
            const { getCachedLfsBytes, setCachedLfsBytes } = await import("../../utils/mediaCache");
            const BATCH_SIZE = 5;

            for (let i = 0; i < toDownloadToOld.length; i += BATCH_SIZE) {
                const batch = toDownloadToOld.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async ({ relPath, pointer }) => {
                    try {
                        // Download TO OLD project's directories (not new)
                        const success = await downloadFromOldLfs(
                            relPath,
                            pointer,
                            oldProjectRemoteUrl,
                            oldFilesDir,  // Download TO old project
                            oldPointersDir,
                            frontierApi,
                            getCachedLfsBytes,
                            setCachedLfsBytes
                        );

                        if (success) {
                            result.downloaded++;
                        } else {
                            result.failed++;
                            result.failedDownloads.push({ relPath, oid: pointer.oid, size: pointer.size });
                        }
                    } catch (error) {
                        result.failed++;
                        result.failedDownloads.push({ relPath, oid: pointer.oid, size: pointer.size });
                        debugLog(`Error downloading attachment ${relPath}:`, error);
                    }
                }));

                progress.report({ message: `Downloaded ${Math.min(i + BATCH_SIZE, toDownloadToOld.length)}/${toDownloadToOld.length} files...` });
            }
        }
    }

    // Step 3: Copy ALL files and pointers from OLD to NEW
    // Strategy-aware: files/ content depends on media strategy
    debugLog(`Copying all attachments from old to new project...`);
    progress.report({ message: `Copying ${allOldAttachments.size} attachments to new project...` });

    // Get media strategy to determine how to handle files/ folder
    const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
    const mediaStrategy = await getMediaFilesStrategy(vscode.Uri.file(oldPath));
    debugLog(`Media strategy for copy: ${mediaStrategy}`);

    // Ensure directories exist
    fs.mkdirSync(newFilesDir, { recursive: true });
    fs.mkdirSync(newPointersDir, { recursive: true });

    let copiedCount = 0;
    for (const relPath of allOldAttachments) {
        const oldFilePath = path.join(oldFilesDir, relPath);
        const oldPointerPath = path.join(oldPointersDir, relPath);
        const newFilePath = path.join(newFilesDir, relPath);
        const newPointerPath = path.join(newPointersDir, relPath);

        try {
            // Ensure subdirectories exist
            fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
            fs.mkdirSync(path.dirname(newPointerPath), { recursive: true });

            // Determine what's in the old project
            const oldFileExists = fs.existsSync(oldFilePath);
            const oldPointerExists = fs.existsSync(oldPointerPath);
            const oldFileIsPointer = oldFileExists ? await isPointerFile(oldFilePath) : true;
            const oldPointerIsPointer = oldPointerExists ? await isPointerFile(oldPointerPath) : true;

            // Find where we have a blob and where we have a pointer
            let blobSource: string | null = null;
            let pointerSource: string | null = null;

            if (oldFileExists && !oldFileIsPointer) {
                blobSource = oldFilePath;
            } else if (oldPointerExists && !oldPointerIsPointer) {
                blobSource = oldPointerPath;
            }

            if (oldFileExists && oldFileIsPointer) {
                pointerSource = oldFilePath;
            } else if (oldPointerExists && oldPointerIsPointer) {
                pointerSource = oldPointerPath;
            }

            // Copy to NEW project based on media strategy
            switch (mediaStrategy) {
                case "auto-download":
                    // files/ should have blobs, pointers/ should have pointers
                    if (blobSource) {
                        fs.copyFileSync(blobSource, newFilePath);
                    } else if (pointerSource) {
                        // We only have a pointer - this file wasn't downloaded yet
                        // Copy pointer to files/ (will be downloaded by media strategy later)
                        // This is not ideal but better than nothing
                        fs.copyFileSync(pointerSource, newFilePath);
                        debugLog(`Warning: No blob for ${relPath} in auto-download mode, copied pointer`);
                    }
                    if (pointerSource) {
                        fs.copyFileSync(pointerSource, newPointerPath);
                    } else if (blobSource) {
                        // We have blob but no pointer - copy blob to pointers/ for sync
                        fs.copyFileSync(blobSource, newPointerPath);
                    }
                    break;

                case "stream-and-save":
                    // Preserve the exact state from old project
                    if (oldFileExists) {
                        fs.copyFileSync(oldFilePath, newFilePath);
                    }
                    if (oldPointerExists) {
                        fs.copyFileSync(oldPointerPath, newPointerPath);
                    }
                    break;

                case "stream-only":
                    // files/ should have pointers (for streaming), pointers/ should have blobs (for sync)
                    if (pointerSource) {
                        fs.copyFileSync(pointerSource, newFilePath);
                    } else if (blobSource) {
                        // We have a blob but stream-only expects pointer in files/
                        // Generate pointer content and write to files/
                        const pointer = await parsePointerFile(oldPointerPath) || await parsePointerFile(oldFilePath);
                        if (pointer) {
                            const pointerContent = `version https://git-lfs.github.com/spec/v1\noid sha256:${pointer.oid}\nsize ${pointer.size}\n`;
                            fs.writeFileSync(newFilePath, pointerContent);
                        } else {
                            // Can't generate pointer, just copy the blob (better than nothing)
                            fs.copyFileSync(blobSource, newFilePath);
                        }
                    }
                    // pointers/ should have the blob for sync
                    if (blobSource) {
                        fs.copyFileSync(blobSource, newPointerPath);
                    } else if (pointerSource) {
                        fs.copyFileSync(pointerSource, newPointerPath);
                    }
                    break;

                default:
                    // Unknown strategy - preserve old state (same as stream-and-save)
                    if (oldFileExists) {
                        fs.copyFileSync(oldFilePath, newFilePath);
                    }
                    if (oldPointerExists) {
                        fs.copyFileSync(oldPointerPath, newPointerPath);
                    }
                    break;
            }

            result.copied++;
            copiedCount++;

            if (copiedCount % 20 === 0 || copiedCount === allOldAttachments.size) {
                progress.report({ message: `Copied ${copiedCount}/${allOldAttachments.size} attachments...` });
            }
        } catch (error) {
            result.failed++;
            debugLog(`Error copying attachment ${relPath}:`, error);
        }
    }

    debugLog(`Attachment copy complete: ${result.copied} copied, ${result.downloaded} downloaded, ${result.failed} failed`);

    if (result.failedDownloads.length > 0) {
        debugLog(`Failed downloads will be tracked for later retrieval:`, result.failedDownloads.map(f => f.relPath));
    }

    return result;
}

/**
 * Download a file from the old project's LFS and save to new project
 */
async function downloadFromOldLfs(
    relPath: string,
    pointer: { oid: string; size: number; },
    oldProjectRemoteUrl: string,
    newFilesDir: string,
    newPointersDir: string,
    frontierApi: any,
    getCachedLfsBytes: (oid: string) => Uint8Array | undefined,
    setCachedLfsBytes: (oid: string, bytes: Uint8Array) => void
): Promise<boolean> {
    const { createHash } = await import("crypto");

    // Check cache first
    const cached = getCachedLfsBytes(pointer.oid);
    if (cached) {
        debugLog(`Using cached LFS content for ${relPath}`);
        const newFilePath = path.join(newFilesDir, relPath);
        const newPointerPath = path.join(newPointersDir, relPath);

        fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
        fs.mkdirSync(path.dirname(newPointerPath), { recursive: true });

        fs.writeFileSync(newFilePath, cached);
        fs.writeFileSync(newPointerPath, cached);
        return true;
    }

    try {
        // Download from old project's LFS
        const content = await frontierApi.downloadLFSFile(oldProjectRemoteUrl, pointer.oid, pointer.size);

        if (!content) {
            debugLog(`Failed to download LFS content for ${relPath} - empty response`);
            return false;
        }

        // Verify checksum
        const hash = createHash("sha256").update(content).digest("hex");
        if (hash !== pointer.oid) {
            debugLog(`Checksum mismatch for ${relPath}: expected ${pointer.oid}, got ${hash}`);
            return false;
        }

        // Cache for future use
        setCachedLfsBytes(pointer.oid, content);

        // Write to both files/ and pointers/
        const newFilePath = path.join(newFilesDir, relPath);
        const newPointerPath = path.join(newPointersDir, relPath);

        fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
        fs.mkdirSync(path.dirname(newPointerPath), { recursive: true });

        fs.writeFileSync(newFilePath, content);
        fs.writeFileSync(newPointerPath, content);

        debugLog(`Downloaded and saved LFS file: ${relPath}`);
        return true;
    } catch (error) {
        debugLog(`Error downloading LFS file ${relPath}:`, error);
        return false;
    }
}

/**
 * Scan a directory recursively for files, returning relative paths
 * Filters out system files like .DS_Store, .gitkeep, etc.
 */
async function scanAttachmentFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    // Files to ignore (system/metadata files)
    const ignoredFiles = new Set([
        ".DS_Store",
        ".gitkeep",
        ".gitignore",
        "Thumbs.db",
        "desktop.ini",
    ]);

    if (!fs.existsSync(dirPath)) {
        return files;
    }

    const scanDir = (currentPath: string, relativeTo: string): void => {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            // Skip ignored files
            if (ignoredFiles.has(entry.name) || entry.name.startsWith(".")) {
                continue;
            }

            const fullPath = path.join(currentPath, entry.name);
            const relPath = path.relative(relativeTo, fullPath);

            if (entry.isDirectory()) {
                scanDir(fullPath, relativeTo);
            } else if (entry.isFile()) {
                files.push(relPath);
            }
        }
    };

    scanDir(dirPath, dirPath);
    return files;
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Update metadata in new project with swap completion info
 * Uses the new array-based swapEntries structure where all info is in each entry
 */
async function updateSwapMetadata(
    projectPath: string,
    swapUUID: string,
    isOldProject: boolean,
    options: {
        newProjectUrl?: string;
        newProjectName?: string;
        oldProjectUrl?: string;
        oldProjectName?: string;
        swapInitiatedBy?: string;
        swapInitiatedAt?: number;
        swapReason?: string;
    } = {},
): Promise<void> {
    const projectUri = vscode.Uri.file(projectPath);

    // Get current user for status tracking
    let currentUser: string | undefined;
    try {
        const authApi = (await import("../../extension")).getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        currentUser = userInfo?.username;
    } catch (e) {
        debugLog("Could not get user info for swap status:", e);
    }

    const now = Date.now();

    await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
        projectUri,
        (meta) => {
            if (!meta.meta) {
                meta.meta = {} as any;
            }

            // Normalize existing swap info or create new one
            const existingSwap = meta.meta.projectSwap
                ? normalizeProjectSwapInfo(meta.meta.projectSwap)
                : { swapEntries: [] };

            // For NEW projects (isOldProject: false), we only keep entries for the CURRENT swap.
            // This prevents old swap history from propagating through chained swaps.
            // OLD projects preserve history so users can see the swap chain.
            let entries = isOldProject
                ? (existingSwap.swapEntries || [])
                : (existingSwap.swapEntries || []).filter(e => e.swapUUID === swapUUID);

            const swapInitiatedAt = options.swapInitiatedAt || now;
            let targetEntry = entries.find(e => e.swapUUID === swapUUID);

            if (!targetEntry) {
                // Create new entry (this happens on NEW project after swap)
                // All info is self-contained in the entry
                targetEntry = {
                    swapUUID,
                    swapInitiatedAt,
                    swapModifiedAt: now,
                    swapStatus: "active",
                    isOldProject,
                    oldProjectUrl: options.oldProjectUrl || "",
                    oldProjectName: options.oldProjectName || "",
                    newProjectUrl: options.newProjectUrl || "",
                    newProjectName: options.newProjectName || "",
                    swapInitiatedBy: options.swapInitiatedBy || "unknown",
                    swapReason: options.swapReason,
                    swappedUsers: [],
                };
                entries = [...entries, targetEntry];
            } else {
                // Entry exists - ensure isOldProject is set correctly for this project's copy
                targetEntry.isOldProject = isOldProject;
            }

            // Add current user to swappedUsers (for NEW project only)
            if (currentUser && !isOldProject) {
                if (!targetEntry.swappedUsers) {
                    targetEntry.swappedUsers = [];
                }

                // Check if already in list (avoid duplicates)
                const existingUserEntry = targetEntry.swappedUsers.find(
                    u => u.userToSwap === currentUser
                );

                if (!existingUserEntry) {
                    targetEntry.swappedUsers.push({
                        userToSwap: currentUser,
                        createdAt: now,
                        updatedAt: now,
                        executed: true,
                        swapCompletedAt: now,
                    });
                } else {
                    // Update existing entry
                    existingUserEntry.updatedAt = now;
                    existingUserEntry.executed = true;
                    existingUserEntry.swapCompletedAt = existingUserEntry.swapCompletedAt || now;
                }

                // Update entry's swapModifiedAt
                targetEntry.swapModifiedAt = now;
            }

            // Update entries array
            meta.meta.projectSwap = { swapEntries: entries };
            return meta;
        }
    );
}

/**
 * Swap directories: old → backup, new → canonical
 */
async function swapDirectories(oldTmpPath: string, newPath: string, targetPath: string): Promise<void> {
    debugLog("Swapping directories");
    if (fs.existsSync(targetPath)) {
        await archiveExistingTarget(targetPath);
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
    fs.renameSync(newPath, targetPath);

    // Clean up the old _tmp folder with retries
    await cleanupOldTmpFolder(oldTmpPath);

    debugLog("Directory swap completed");
}

/**
 * Clean up the old _tmp folder with retries
 * This folder contains the old project after it was renamed during swap
 */
async function cleanupOldTmpFolder(oldTmpPath: string): Promise<void> {
    if (!fs.existsSync(oldTmpPath)) {
        return;
    }

    // Try up to 3 times with increasing delays (handles file lock issues)
    const maxRetries = 3;
    const delays = [100, 500, 1000]; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            fs.rmSync(oldTmpPath, { recursive: true, force: true });
            debugLog(`Successfully cleaned up old tmp folder: ${oldTmpPath}`);
            return;
        } catch (error) {
            debugLog(`Attempt ${attempt + 1}/${maxRetries} to delete tmp folder failed:`, error);
            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            }
        }
    }

    // If all retries failed, log a warning but don't throw
    // The folder can be manually cleaned up later
    console.warn(`[ProjectSwap] Could not delete old tmp folder after ${maxRetries} attempts: ${oldTmpPath}`);
    console.warn("[ProjectSwap] This folder can be safely deleted manually.");
}

/**
 * Archive an existing target project into archived_projects before replacement
 */
async function archiveExistingTarget(targetPath: string): Promise<void> {
    if (!fs.existsSync(targetPath)) {
        return;
    }

    const codexProjectsRoot = await getCodexProjectsDirectory();
    const archiveDir = path.join(codexProjectsRoot.fsPath, "archived_projects");

    return new Promise<void>((resolve, reject) => {
        try {
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }

            const baseName = path.basename(targetPath);
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const archiveName = `${baseName}-swap-existing-${timestamp}.zip`;
            const archivePath = path.join(archiveDir, archiveName);

            const output = fs.createWriteStream(archivePath);
            const zip = archiver("zip", { zlib: { level: 9 } });

            output.on("close", () => resolve());
            zip.on("error", (err: any) => reject(err));

            zip.pipe(output);
            zip.directory(targetPath, false);
            zip.finalize();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Cleanup temporary directory
 */
async function cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            debugLog("Cleaned up temp directory:", tempDir);
        }
    } catch (error) {
        debugLog("Error cleaning up temp directory (non-fatal):", error);
    }
}

function isBinaryFile(filePath: string): boolean {
    const binaryExtensions = [
        ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".wma", ".webm", ".opus", ".amr", ".3gp",
        ".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v", ".mpg", ".mpeg",
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".ico", ".svg", ".webp",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".zip", ".tar", ".gz", ".rar", ".7z", ".bz2",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".dat"
    ];
    const ext = path.extname(filePath).toLowerCase();
    return binaryExtensions.includes(ext);
}

async function ensureDirectoryExists(dirUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.createDirectory(dirUri);
    } catch {
        // ignore
    }
}
/**
 * Recursively copy directory
 */
async function copyDirectory(
    src: string,
    dest: string,
    options: { overwrite?: boolean; } = {}
): Promise<void> {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    const shouldOverwrite = options.overwrite !== false;

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath, options);
        } else {
            if (!shouldOverwrite && fs.existsSync(destPath)) {
                continue;
            }
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Update the projectName in metadata.json to match the new folder name
 * This is critical after a project swap - the old projectName may have been
 * merged from the old project and needs to be updated to match the new identity.
 * 
 * Also cleans up empty projectName edits that may have been merged from the old project
 * and adds a proper edit entry for the new projectName.
 * 
 * @param projectUri - URI of the project folder
 * @param folderName - The folder name to derive the project name from
 */
async function updateProjectNameToMatchFolder(projectUri: vscode.Uri, folderName: string): Promise<void> {
    const metadataPath = vscode.Uri.joinPath(projectUri, "metadata.json");

    try {
        const content = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(content).toString("utf-8"));

        // Extract UUID from folder name and strip it to get the base name
        const { extractProjectIdFromFolderName, sanitizeProjectName } = await import("../../projectManager/utils/projectUtils");
        const projectId = extractProjectIdFromFolderName(folderName);

        let baseName = folderName;
        if (projectId && baseName.includes(projectId)) {
            baseName = baseName.replace(projectId, "").replace(/-+$/, "").replace(/^-+/, "");
        }

        const newProjectName = sanitizeProjectName(baseName) || "Untitled Project";

        // Clean up edits array: remove empty projectName and projectId edits that may have been merged
        if (metadata.edits && Array.isArray(metadata.edits)) {
            metadata.edits = metadata.edits.filter((edit: any) => {
                if (!Array.isArray(edit.editMap) || edit.editMap.length !== 1) return true;
                const field = edit.editMap[0];
                const isIdentityEdit = field === "projectName" || field === "projectId";
                const hasEmptyValue = edit.value === "" || edit.value === null || edit.value === undefined;
                // Keep the edit unless it's an empty identity edit
                return !(isIdentityEdit && hasEmptyValue);
            });
        }

        // Only update projectName if different
        if (metadata.projectName !== newProjectName) {
            debugLog(`Updating projectName: "${metadata.projectName}" -> "${newProjectName}"`);
            metadata.projectName = newProjectName;

            // Check if an edit with this projectName value already exists (from Copy to New Project)
            const hasProjectNameEdit = metadata.edits?.some((edit: any) =>
                Array.isArray(edit.editMap) &&
                edit.editMap.length === 1 &&
                edit.editMap[0] === "projectName" &&
                edit.value === newProjectName
            );

            // Only add edit if not already present with this value
            if (!hasProjectNameEdit) {
                const { getAuthApi } = await import("../../extension");
                const authApi = getAuthApi();
                let author = "system";
                try {
                    if (authApi?.getAuthStatus()?.isAuthenticated) {
                        const userInfo = await authApi.getUserInfo();
                        if (userInfo?.username) author = userInfo.username;
                    }
                } catch {
                    // Use default author
                }

                const { EditMapUtils, addProjectMetadataEdit } = await import("../../utils/editMapUtils");
                addProjectMetadataEdit(metadata, EditMapUtils.projectName(), newProjectName, author);
            }
        }

        await vscode.workspace.fs.writeFile(
            metadataPath,
            Buffer.from(JSON.stringify(metadata, null, 4))
        );
    } catch (error) {
        debugLog("Error updating projectName:", error);
        throw error;
    }
}
