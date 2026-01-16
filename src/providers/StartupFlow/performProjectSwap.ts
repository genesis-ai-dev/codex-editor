import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
// @ts-expect-error - archiver types may not be available
import * as archiver from "archiver";
import { ProjectMetadata, LocalProjectSwap } from "../../../types";
import { MetadataManager } from "../../utils/metadataManager";
import { updateGitOriginUrl, extractProjectNameFromUrl } from "../../utils/projectSwapManager";
import { readLocalProjectSettings, writeLocalProjectSettings } from "../../utils/localProjectSettings";

const DEBUG = true;
const debugLog = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

/**
 * Perform a complete project swap migration
 * Backs up old project, clones new one, merges files, updates remotes
 * 
 * @param progress - VS Code progress reporter
 * @param projectName - Name of the project
 * @param oldProjectPath - Path to the old project
 * @param newProjectUrl - Git URL of the new project
 * @param swapUUID - UUID tracking this swap
 * @returns Promise resolving to new project path
 */
export async function performProjectSwap(
    progress: vscode.Progress<{ increment?: number; message?: string }>,
    projectName: string,
    oldProjectPath: string,
    newProjectUrl: string,
    swapUUID: string
): Promise<string> {
    debugLog("Starting project swap:", { projectName, oldProjectPath, newProjectUrl, swapUUID });

    // Track local swap state
    const projectUri = vscode.Uri.file(oldProjectPath);
    const localSwap: LocalProjectSwap = {
        pendingSwap: true,
        swapUUID,
        migrationInProgress: true,
        migrationAttempts: 1,
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

        // Step 2: Create temporary workspace
        progress.report({ increment: 5, message: "Creating temporary workspace..." });
        const tempDir = await createTempWorkspace();
        debugLog("Temp workspace created:", tempDir);

        try {
            // Step 3: Clone new project
            progress.report({ increment: 15, message: "Cloning new project repository..." });
            const newProjectPath = await cloneNewProject(newProjectUrl, tempDir, progress);
            debugLog("New project cloned to:", newProjectPath);

            // Step 4: Verify structure compatibility
            progress.report({ increment: 5, message: "Verifying project structure..." });
            await verifyStructureCompatibility(oldProjectPath, newProjectPath);

            // Step 5: Merge files from old to new
            progress.report({ increment: 20, message: "Merging project files..." });
            await mergeProjectFiles(oldProjectPath, newProjectPath, progress);

            // Step 6: Handle uncommitted changes
            progress.report({ increment: 10, message: "Preserving uncommitted changes..." });
            await preserveUncommittedChanges(oldProjectPath, newProjectPath);

            // Step 7: Update metadata with swap completion
            progress.report({ increment: 5, message: "Updating project metadata..." });
            await updateSwapMetadata(newProjectPath, swapUUID, false);

            // Step 8: Swap directories (old → backup, new → canonical)
            progress.report({ increment: 15, message: "Swapping project directories..." });
            await swapDirectories(oldProjectPath, newProjectPath);

            // Step 9: Update local settings
            progress.report({ increment: 5, message: "Finalizing migration..." });
            const finalProjectUri = vscode.Uri.file(oldProjectPath); // Back to canonical name
            await writeLocalProjectSettings({
                projectSwap: {
                    ...localSwap,
                    migrationInProgress: false,
                    pendingSwap: false,
                },
            }, finalProjectUri);

            // Step 10: Cleanup temp directory
            await cleanupTempDirectory(tempDir);

            progress.report({ increment: 15, message: "Migration complete!" });
            debugLog("Project swap completed successfully");

            return oldProjectPath; // Returns canonical path (now contains new project)

        } catch (error) {
            debugLog("Error during swap, cleaning up temp directory:", error);
            await cleanupTempDirectory(tempDir);
            throw error;
        }

    } catch (error) {
        debugLog("Project swap failed:", error);
        
        // Update local state with error
        localSwap.migrationInProgress = false;
        localSwap.lastAttemptTimestamp = Date.now();
        localSwap.lastAttemptError = error instanceof Error ? error.message : String(error);
        await writeLocalProjectSettings({ projectSwap: localSwap }, projectUri);

        // Update metadata swap status to failed
        try {
            await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
                projectUri,
                (meta) => {
                    if (meta.meta?.projectSwap) {
                        meta.meta.projectSwap.swapStatus = "failed";
                        meta.meta.projectSwap.swapError = error instanceof Error ? error.message : String(error);
                    }
                    return meta;
                }
            );
        } catch (metaError) {
            debugLog("Failed to update metadata with error status:", metaError);
        }

        throw error;
    }
}

/**
 * Backup old project to .zip file
 */
async function backupOldProject(projectPath: string, projectName: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupFileName = `${projectName}-swap-backup-${timestamp}.zip`;
            const backupPath = path.join(os.homedir(), ".codex-backups", backupFileName);

            // Ensure backup directory exists
            const backupDir = path.dirname(backupPath);
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
 * Clone new project repository
 */
async function cloneNewProject(
    gitUrl: string,
    tempDir: string,
    progress: vscode.Progress<{ increment?: number; message?: string }>
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
    progress: vscode.Progress<{ increment?: number; message?: string }>
): Promise<void> {
    debugLog("Merging project files");

    // Copy .codex directory (Scripture data, audio state, etc.)
    const oldCodexDir = path.join(oldPath, ".codex");
    const newCodexDir = path.join(newPath, ".codex");

    if (fs.existsSync(oldCodexDir)) {
        progress.report({ message: "Copying .codex directory..." });
        await copyDirectory(oldCodexDir, newCodexDir);
        debugLog("Copied .codex directory");
    }

    // Copy .source directory (source audio/video files)
    const oldSourceDir = path.join(oldPath, ".source");
    const newSourceDir = path.join(newPath, ".source");

    if (fs.existsSync(oldSourceDir)) {
        progress.report({ message: "Copying .source directory..." });
        await copyDirectory(oldSourceDir, newSourceDir);
        debugLog("Copied .source directory");
    }

    // Copy local project settings
    const oldSettings = path.join(oldPath, ".project", "localProjectSettings.json");
    const newSettingsDir = path.join(newPath, ".project");
    const newSettings = path.join(newSettingsDir, "localProjectSettings.json");

    if (fs.existsSync(oldSettings)) {
        if (!fs.existsSync(newSettingsDir)) {
            fs.mkdirSync(newSettingsDir, { recursive: true });
        }
        fs.copyFileSync(oldSettings, newSettings);
        debugLog("Copied localProjectSettings.json");
    }

    // Copy .gitattributes (LFS configuration)
    const oldGitAttributes = path.join(oldPath, ".gitattributes");
    const newGitAttributes = path.join(newPath, ".gitattributes");

    if (fs.existsSync(oldGitAttributes)) {
        fs.copyFileSync(oldGitAttributes, newGitAttributes);
        debugLog("Copied .gitattributes");
    }

    debugLog("File merging completed");
}

/**
 * Preserve uncommitted changes from old project
 */
async function preserveUncommittedChanges(oldPath: string, newPath: string): Promise<void> {
    debugLog("Preserving uncommitted changes");

    const git = await import("isomorphic-git");
    const fs = await import("fs");

    try {
        // Get status of old project
        const statusMatrix = await git.statusMatrix({ fs, dir: oldPath });

        const uncommittedFiles = statusMatrix.filter(([filepath, head, workdir, stage]) => {
            // File has uncommitted changes if workdir or stage differs from head
            return workdir !== head || stage !== head;
        });

        if (uncommittedFiles.length === 0) {
            debugLog("No uncommitted changes to preserve");
            return;
        }

        debugLog(`Found ${uncommittedFiles.length} uncommitted files`);

        // Copy uncommitted files to new project
        for (const [filepath] of uncommittedFiles) {
            const oldFilePath = path.join(oldPath, filepath);
            const newFilePath = path.join(newPath, filepath);

            if (fs.existsSync(oldFilePath)) {
                // Ensure directory exists
                const newFileDir = path.dirname(newFilePath);
                if (!fs.existsSync(newFileDir)) {
                    fs.mkdirSync(newFileDir, { recursive: true });
                }

                fs.copyFileSync(oldFilePath, newFilePath);
                debugLog(`Copied uncommitted file: ${filepath}`);
            }
        }

        debugLog("Uncommitted changes preserved");
    } catch (error) {
        debugLog("Error preserving uncommitted changes (non-fatal):", error);
        // Don't throw - this is best-effort
    }
}

/**
 * Update metadata in new project with swap completion info
 */
async function updateSwapMetadata(projectPath: string, swapUUID: string, isOldProject: boolean): Promise<void> {
    const projectUri = vscode.Uri.file(projectPath);
    
    await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
        projectUri,
        (meta) => {
            if (!meta.meta) {
                meta.meta = {} as any;
            }

            if (meta.meta.projectSwap) {
                // Update existing swap info
                meta.meta.projectSwap.swapStatus = "completed";
                meta.meta.projectSwap.swapCompletedAt = Date.now();
                meta.meta.projectSwap.isOldProject = isOldProject;
            }

            return meta;
        }
    );
}

/**
 * Swap directories: old → backup, new → canonical
 */
async function swapDirectories(oldPath: string, newPath: string): Promise<void> {
    debugLog("Swapping directories");

    const parentDir = path.dirname(oldPath);
    const projectName = path.basename(oldPath);
    const backupName = `${projectName}.old-${Date.now()}`;
    const backupPath = path.join(parentDir, backupName);

    // Move old project to backup location
    fs.renameSync(oldPath, backupPath);
    debugLog(`Moved old project to: ${backupPath}`);

    // Move new project to canonical location
    fs.renameSync(newPath, oldPath);
    debugLog(`Moved new project to: ${oldPath}`);

    debugLog("Directory swap completed");
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

/**
 * Recursively copy directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
