import * as vscode from "vscode";
import git from "isomorphic-git";
import fs from "fs";
import { extractProjectIdFromFolderName } from "./projectCreationUtils/projectCreationUtils";
import { MetadataManager } from "./metadataManager";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectIdValidator]", ...args) : () => {};

/**
 * Extract projectId from a Git remote URL
 * @param url - Git remote URL (e.g., "git.genesisrnd.com/group/project-uuid.git")
 * @returns The projectId if found, undefined otherwise
 */
function extractProjectIdFromGitUrl(url: string): string | undefined {
    try {
        // Remove .git suffix if present
        const cleanUrl = url.replace(/\.git$/, "");
        
        // Get the last part of the path (project name with UUID)
        const parts = cleanUrl.split("/");
        const projectNameWithId = parts[parts.length - 1];
        
        // Extract UUID from the end using same logic as folder name
        return extractProjectIdFromFolderName(projectNameWithId);
    } catch (error) {
        debug("Error extracting projectId from Git URL:", error);
        return undefined;
    }
}

interface ProjectIdInfo {
    folderProjectId?: string;
    gitRemoteProjectId?: string;
    metadataProjectId?: string;
    sourceOfTruth?: string; // Which one should be used
    needsUpdate: boolean;
}

/**
 * Detect projectId from multiple sources without querying GitLab API
 * Priority: Git Remote > Folder Name > Metadata
 */
export async function detectProjectIdMismatch(
    workspaceFolder: vscode.Uri
): Promise<ProjectIdInfo> {
    const folderName = workspaceFolder.fsPath.split(/[\\/]/).pop() || "";
    const folderProjectId = extractProjectIdFromFolderName(folderName);
    
    debug("Folder name:", folderName);
    debug("Folder projectId:", folderProjectId);

    // Try to get Git remote URL (no API call needed - just reads local .git config)
    let gitRemoteProjectId: string | undefined;
    try {
        const remotes = await git.listRemotes({
            fs,
            dir: workspaceFolder.fsPath,
        });
        const origin = remotes.find((r) => r.remote === "origin");
        if (origin?.url) {
            gitRemoteProjectId = extractProjectIdFromGitUrl(origin.url);
            debug("Git remote URL:", origin.url);
            debug("Git remote projectId:", gitRemoteProjectId);
        }
    } catch (error) {
        debug("No git remote found or error reading:", error);
    }

    // Read projectId from metadata.json
    let metadataProjectId: string | undefined;
    try {
        const metadataPath = vscode.Uri.joinPath(workspaceFolder, "metadata.json");
        const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataContent).toString());
        metadataProjectId = metadata.projectId;
        debug("Metadata projectId:", metadataProjectId);
    } catch (error) {
        debug("Error reading metadata.json:", error);
    }

    // Determine source of truth:
    // 1. If published (has git remote), use git remote UUID
    // 2. Otherwise, use folder UUID
    // 3. If neither exist, use metadata UUID
    const sourceOfTruth = gitRemoteProjectId || folderProjectId || metadataProjectId;
    
    // Read current projectName from metadata to check if it's empty
    let currentProjectName: string | undefined;
    try {
        const metadataPath = vscode.Uri.joinPath(workspaceFolder, "metadata.json");
        const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataContent).toString());
        currentProjectName = metadata.projectName;
    } catch (error) {
        debug("Error reading projectName from metadata:", error);
    }
    
    // Check if metadata needs update (either projectId mismatch OR empty projectName)
    const hasProjectIdMismatch = !!(
        sourceOfTruth &&
        metadataProjectId &&
        sourceOfTruth !== metadataProjectId
    );
    const hasEmptyProjectName = !currentProjectName || currentProjectName.trim() === "";
    const needsUpdate = hasProjectIdMismatch || hasEmptyProjectName;

    debug("Source of truth:", sourceOfTruth);
    debug("Has projectId mismatch:", hasProjectIdMismatch);
    debug("Has empty projectName:", hasEmptyProjectName);
    debug("Needs update:", needsUpdate);

    return {
        folderProjectId,
        gitRemoteProjectId,
        metadataProjectId,
        sourceOfTruth,
        needsUpdate,
    };
}

/**
 * Update metadata.json projectId and projectName if there's a mismatch or empty values
 * This checks if the file has been modified locally to avoid conflicts
 */
export async function fixProjectIdMismatch(
    workspaceFolder: vscode.Uri,
    correctProjectId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        debug("Attempting to fix projectId mismatch. Correct projectId:", correctProjectId);

        // Check if metadata.json has uncommitted changes
        try {
            const status = await git.status({
                fs,
                dir: workspaceFolder.fsPath,
                filepath: "metadata.json",
            });
            
            // If file is modified locally, don't auto-update to avoid conflicts
            if (status !== "unmodified" && status !== "*absent") {
                debug("metadata.json has local changes, skipping auto-fix");
                return {
                    success: false,
                    error: "metadata.json has uncommitted changes. Please commit or discard changes first.",
                };
            }
        } catch (error) {
            // If git status fails, it might not be a git repo yet, which is fine
            debug("Could not check git status, proceeding with update:", error);
        }

        // Get the folder name to use for projectName if it's empty
        const folderName = workspaceFolder.fsPath.split(/[\\/]/).pop() || "";

        // Use MetadataManager to safely update the projectId and projectName
        const result = await MetadataManager.safeUpdateMetadata(
            workspaceFolder,
            (metadata: any) => {
                const updates: any = {
                    ...metadata,
                    projectId: correctProjectId,
                };

                // Also fix empty projectName by using folder name
                if (!metadata.projectName || metadata.projectName.trim() === "") {
                    updates.projectName = folderName;
                    debug("Also fixing empty projectName with folder name:", folderName);
                }

                return updates;
            }
        );

        if (!result.success) {
            return {
                success: false,
                error: result.error || "Failed to update metadata.json",
            };
        }

        debug("Successfully updated projectId in metadata.json");
        return { success: true };
    } catch (error) {
        debug("Error fixing projectId mismatch:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Validate and fix projectId if needed
 * Call this when a project is opened
 */
export async function validateAndFixProjectId(
    workspaceFolder: vscode.Uri
): Promise<void> {
    try {
        const info = await detectProjectIdMismatch(workspaceFolder);

        if (info.needsUpdate) {
            // Use metadata projectId if sourceOfTruth is undefined but we need to fix empty projectName
            const projectIdToUse = info.sourceOfTruth || info.metadataProjectId;
            
            if (projectIdToUse) {
                debug("Project information needs update. Attempting to fix...");
                
                const result = await fixProjectIdMismatch(workspaceFolder, projectIdToUse);
                
                if (result.success) {
                    const source = info.gitRemoteProjectId ? "remote repository" : "folder name";
                    vscode.window.showInformationMessage(
                        `Updated project information in metadata.json to match ${source}`
                    );
                } else if (result.error) {
                    vscode.window.showWarningMessage(
                        `Could not auto-fix project information: ${result.error}`
                    );
                }
            } else {
                debug("No valid projectId found to use for update");
            }
        } else {
            debug("No project information updates needed");
        }
    } catch (error) {
        debug("Error in validateAndFixProjectId:", error);
    }
}
