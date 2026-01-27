import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
// @ts-expect-error - archiver types may not be available
import archiver from "archiver";
import { ProjectMetadata, LocalProjectSwap, ProjectSwapInfo, ProjectSwapEntry, ProjectSwapUserEntry } from "../../../types";
import { MetadataManager } from "../../utils/metadataManager";
import { extractProjectNameFromUrl, getGitOriginUrl, normalizeProjectSwapInfo, findSwapEntryByTimestamp } from "../../utils/projectSwapManager";
import { validateAndFixProjectMetadata } from "../../projectManager/utils/projectUtils";
import { readLocalProjectSettings, writeLocalProjectSettings } from "../../utils/localProjectSettings";
import { getCodexProjectsDirectory } from "../../utils/projectLocationUtils";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";

const DEBUG = true;
const debugLog = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

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

    try {
        // Update local state
        await writeLocalProjectSettings(
            { projectSwap: localSwap },
            projectUri
        );

        // Step 1: Backup old project
        progress.report({ increment: 5, message: "Backing up current project..." });
        const backupPath = await backupOldProject(oldProjectPath, projectName);
        localSwap.backupPath = backupPath;
        await writeLocalProjectSettings({ projectSwap: localSwap }, projectUri);

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
            await updateSwapMetadata(newProjectPath, swapUUID, false, {
                newProjectUrl,
                newProjectName: targetFolderName,
                oldProjectUrl: oldOriginUrl ?? undefined,
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
                    lfsSourceRemoteUrl = await getGitOriginUrl(tmpPath) ?? undefined;
                }
                if (lfsSourceRemoteUrl) {
                    const newSettings = await readLocalProjectSettings(vscode.Uri.file(newProjectPath));
                    newSettings.lfsSourceRemoteUrl = lfsSourceRemoteUrl;
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

            // Step 9: Update local settings
            progress.report({ increment: 5, message: "Finalizing swap..." });
            const finalProjectUri = vscode.Uri.file(targetProjectPath);
            await writeLocalProjectSettings({
                projectSwap: {
                    ...localSwap,
                    swapInProgress: false,
                    pendingSwap: false,
                },
            }, finalProjectUri);

            // Step 9b: Update projectName in metadata to match the new folder name
            // This is critical after a swap - the old projectName may have been merged from the old project
            try {
                await updateProjectNameToMatchFolder(finalProjectUri, targetFolderName);
            } catch (err) {
                debugLog("Warning: Could not update projectName (non-fatal):", err);
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

        // Update local state with error
        localSwap.swapInProgress = false;
        localSwap.lastAttemptTimestamp = Date.now();
        localSwap.lastAttemptError = error instanceof Error ? error.message : String(error);
        await writeLocalProjectSettings({ projectSwap: localSwap }, projectUri);
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
            return (
                relativePath.endsWith(".sqlite") ||
                relativePath.endsWith(".sqlite3") ||
                relativePath.endsWith(".db")
            );
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

            // Find or create the matching swap entry by swapInitiatedAt
            let entries = existingSwap.swapEntries || [];
            const swapInitiatedAt = options.swapInitiatedAt || now;
            let targetEntry = entries.find(e => e.swapInitiatedAt === swapInitiatedAt);

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

        // Only update if different
        if (metadata.projectName !== newProjectName) {
            debugLog(`Updating projectName: "${metadata.projectName}" -> "${newProjectName}"`);
            metadata.projectName = newProjectName;
            await vscode.workspace.fs.writeFile(
                metadataPath,
                Buffer.from(JSON.stringify(metadata, null, 4))
            );
        }
    } catch (error) {
        debugLog("Error updating projectName:", error);
        throw error;
    }
}
