import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import git from "isomorphic-git";
import { ProjectMetadata, ProjectSwapInfo, ProjectSwapEntry } from "../../types";
import { MetadataManager } from "../utils/metadataManager";
import {
    validateGitUrl,
    getGitOriginUrl,
    extractProjectNameFromUrl,
    checkProjectSwapRequired,
    normalizeProjectSwapInfo,
    getActiveSwapEntry,
    hasPendingSwap,
    getAllSwapEntries,
} from "../utils/projectSwapManager";
import { checkProjectAdminPermissions } from "../utils/projectAdminPermissionChecker";
import {
    sanitizeProjectName,
    generateProjectId,
    generateProjectScope,
    validateAndFixProjectMetadata,
    ensureGitConfigsAreUpToDate,
    ensureGitDisabledInSettings,
    extractProjectIdFromFolderName
} from "../projectManager/utils/projectUtils";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectSwapCommands]", ...args) : () => { };

/**
 * Helper function to cancel a specific swap entry by its swapInitiatedAt timestamp
 * Updates the entry's status to "cancelled" and records who cancelled it
 */
async function cancelSwapEntry(
    projectUri: vscode.Uri,
    swapInitiatedAt: number,
    cancelledBy: string
): Promise<boolean> {
    const now = Date.now();
    const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
        projectUri,
        (meta) => {
            if (!meta.meta?.projectSwap) {
                return meta;
            }

            const normalized = normalizeProjectSwapInfo(meta.meta.projectSwap);
            const entries = normalized.swapEntries || [];

            // Find and update the specific entry
            const entryIndex = entries.findIndex(e => e.swapInitiatedAt === swapInitiatedAt);
            if (entryIndex >= 0) {
                entries[entryIndex] = {
                    ...entries[entryIndex],
                    swapStatus: "cancelled",
                    swapModifiedAt: now,
                    cancelledBy,
                    cancelledAt: now,
                };
            }

            meta.meta.projectSwap = {
                ...normalized,
                swapEntries: entries,
            };
            return meta;
        }
    );

    if (updateResult.success) {
        // Also update or delete localProjectSwap.json to keep it in sync
        try {
            const { readLocalProjectSwapFile, writeLocalProjectSwapFile, deleteLocalProjectSwapFile } = await import("../utils/localProjectSettings");
            const localSwapFile = await readLocalProjectSwapFile(projectUri);
            if (localSwapFile?.remoteSwapInfo) {
                const normalized = normalizeProjectSwapInfo(localSwapFile.remoteSwapInfo);
                const entries = normalized.swapEntries || [];
                const entryIndex = entries.findIndex(e => e.swapInitiatedAt === swapInitiatedAt);
                if (entryIndex >= 0) {
                    entries[entryIndex] = {
                        ...entries[entryIndex],
                        swapStatus: "cancelled",
                        swapModifiedAt: now,
                        cancelledBy,
                        cancelledAt: now,
                    };
                }
                
                // Check if there are any remaining active entries
                const hasActiveEntries = entries.some(e => e.swapStatus === "active");
                if (hasActiveEntries) {
                    // Update the file with the cancelled entry
                    await writeLocalProjectSwapFile({
                        remoteSwapInfo: { swapEntries: entries },
                        fetchedAt: now,
                        sourceOriginUrl: localSwapFile.sourceOriginUrl,
                    }, projectUri);
                } else {
                    // No more active swaps, delete the file
                    await deleteLocalProjectSwapFile(projectUri);
                }
            }
        } catch {
            // Non-fatal - localProjectSwap.json might not exist
        }
        
        // Commit and push the changes - bypass swap check since we just cancelled it locally
        // This ensures the cancellation can be pushed to remote without being blocked
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            "Cancelled project swap",
            { bypassUpdatingCheck: true }
        );
    }

    return updateResult.success;
}

/**
 * Command to initiate a project swap (swap to new Git repository)
 * Instance administrators only
 */
export async function initiateProjectSwap(): Promise<void> {
    try {
        debug("Starting project swap initiation");

        // Check if we're in a workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.window.showErrorMessage("No workspace folder open. Please open a project first.", { modal: true });
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        debug("Workspace path:", workspacePath);

        // Check if this is a Codex project (has metadata.json)
        const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
        try {
            await vscode.workspace.fs.stat(metadataUri);
        } catch {
            await vscode.window.showErrorMessage(
                "This is not a Codex project. No metadata.json found.",
                { modal: true }
            );
            return;
        }

        // Check if user has permission (Project Maintainer or Owner)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            // Provide a clear, user-friendly message based on the actual reason
            let message: string;
            
            if (permission.error === "No git remote origin found") {
                message = "This project has not been published yet.\n\nPublish your project first, then you can initiate a swap.";
            } else if (permission.error === "Insufficient permissions") {
                message = "You don't have permission to initiate project swaps.\n\nOnly Project Maintainers or Owners can initiate swaps.";
            } else if (permission.error === "Authentication not available") {
                message = "Please log in to initiate project swaps.";
            } else if (permission.error === "Could not determine current user") {
                message = "Could not determine your user account.\n\nPlease log in and try again.";
            } else {
                message = permission.error || "Unable to verify permissions.";
            }

            await vscode.window.showWarningMessage(message, { modal: true });
            return;
        }

        debug("Permission check passed - user has sufficient privileges");

        // Get current git origin URL
        const currentGitUrl = await getGitOriginUrl(workspacePath);
        if (!currentGitUrl) {
            await vscode.window.showErrorMessage(
                "Could not determine current git origin URL. Make sure this is a valid git repository.",
                { modal: true }
            );
            return;
        }
        // Sanitize current URL for display (strip credentials, keep host/path)
        const displayCurrentGitUrl = (() => {
            try {
                const urlObj = new URL(currentGitUrl);
                urlObj.username = "";
                urlObj.password = "";
                return urlObj.toString().replace(/\/$/, "");
            } catch {
                return currentGitUrl;
            }
        })();

        // Check if swap already initiated
        const projectUri = vscode.Uri.file(workspacePath);
        const metadataPath = vscode.Uri.file(path.join(workspacePath, "metadata.json"));
        const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;

        // Check for existing pending swap - must cancel before initiating new one
        if (metadata?.meta?.projectSwap) {
            const normalizedSwap = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(normalizedSwap);

            if (activeEntry) {
                // There's a pending swap - user must cancel it first
                const action = await vscode.window.showWarningMessage(
                    `A swap is already pending to "${activeEntry.newProjectName}".\n\n` +
                    `You must cancel the existing swap before initiating a new one.\n\n` +
                    `Would you like to cancel the pending swap?`,
                    { modal: true },
                    "Cancel Pending Swap",
                    "Keep Existing"
                );

                if (action === "Cancel Pending Swap") {
                    // Cancel the pending swap first
                    await cancelSwapEntry(projectUri, activeEntry.swapInitiatedAt, permission.currentUser || "unknown");
                    await vscode.window.showInformationMessage("Previous swap cancelled. You can now initiate a new swap.", { modal: true });
                }
                return;
            }

            // Check for completed/cancelled swaps (history exists but no pending)
            const allEntries = getAllSwapEntries(normalizedSwap);
            if (allEntries.length > 0) {
                const lastEntry = allEntries[0]; // Most recent
                const statusMsg = lastEntry.swapStatus === "cancelled"
                    ? `Previous swap to "${lastEntry.newProjectName}" was cancelled.`
                    : `Previous swap history exists.`;

                const action = await vscode.window.showInformationMessage(
                    `${statusMsg}\n\nWould you like to initiate a new swap?`,
                    { modal: true },
                    "Yes, Initiate New Swap",
                    "Cancel"
                );

                if (action !== "Yes, Initiate New Swap") {
                    return;
                }
            }
        }

        // Prompt for new project URL
        const newProjectUrl = await vscode.window.showInputBox({
            prompt: "Enter the Git URL for the new project (must end with .git)",
            placeHolder: "https://gitlab.com/group/new-project.git",
            validateInput: (value) => {
                if (!value) {
                    return "Git URL is required";
                }
                if (!value.endsWith(".git")) {
                    return "Git URL must end with .git";
                }
                if (value === currentGitUrl) {
                    return "New project URL cannot be the same as current project";
                }
                return null;
            },
        });

        if (!newProjectUrl) {
            return; // User cancelled
        }

        // Validate the new URL (format check only, clone will verify access)
        const validation = await validateGitUrl(newProjectUrl);
        if (!validation.valid) {
            await vscode.window.showErrorMessage(
                `Invalid repository URL: ${validation.error}`,
                { modal: true }
            );
            return;
        }

        // Prompt for reason
        const swapReason = await vscode.window.showInputBox({
            prompt: "Reason for swap (optional but recommended)",
            placeHolder: "e.g., Repository size reduction, restructuring, etc.",
        });

        // Get current user info
        const authApi = (await import("../extension")).getAuthApi();
        if (!authApi) {
            await vscode.window.showErrorMessage("Authentication not available", { modal: true });
            return;
        }

        const currentUserInfo = await authApi.getUserInfo();
        if (!currentUserInfo || !currentUserInfo.username) {
            await vscode.window.showErrorMessage("Could not determine current user", { modal: true });
            return;
        }

        // Extract project name from new URL
        const newProjectName = extractProjectNameFromUrl(newProjectUrl);

        // Show confirmation dialog
        const confirmed = await vscode.window.showWarningMessage(
            `⚠️  Initiate Project Swap?\n\n` +
            `This will require ALL users to swap to:\n${newProjectName}\n\n` +
            `Current:\n${displayCurrentGitUrl}\n\n` +
            `New:\n${newProjectUrl}\n\n` +
            `Users will be prompted to swap when they next sync or open the project.\n\n` +
            `This cannot be easily undone. Continue?`,
            { modal: true },
            "Yes, Initiate Swap"
        );

        if (confirmed !== "Yes, Initiate Swap") {
            return;
        }

        // Generate swapUUID - this ID links all projects in the swap chain.
        // It propagates to each new project, creating a traceable lineage:
        // ProjectA -> ProjectB -> ProjectC all share the same swapUUID.
        const swapUUID = generateProjectId();
        const now = Date.now();
        const oldProjectName = extractProjectNameFromUrl(currentGitUrl);

        // Create new swap entry with all info self-contained
        const newEntry: ProjectSwapEntry = {
            swapUUID,
            swapInitiatedAt: now,
            swapModifiedAt: now,
            swapStatus: "active",
            isOldProject: true,
            oldProjectUrl: currentGitUrl,
            oldProjectName,
            newProjectUrl,
            newProjectName,
            swapInitiatedBy: currentUserInfo.username,
            swapReason,
            swappedUsers: [],
        };

        // Update metadata.json - preserve history by adding to swapEntries array
        const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta) {
                    meta.meta = {} as any;
                }

                // Get existing swap info or create new one
                const existingSwap = meta.meta.projectSwap
                    ? normalizeProjectSwapInfo(meta.meta.projectSwap)
                    : { swapEntries: [] };

                // Add new entry to the array (preserving history)
                const updatedEntries = [...(existingSwap.swapEntries || []), newEntry];

                meta.meta.projectSwap = {
                    swapEntries: updatedEntries,
                };
                return meta;
            }
        );

        if (!updateResult.success) {
            throw new Error(updateResult.error || "Failed to update metadata.json");
        }

        // Also write to localProjectSwap.json as a local backup
        // This ensures the swap info is available even if remote fetch fails
        try {
            const { writeLocalProjectSwapFile } = await import("../utils/localProjectSettings");
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [newEntry],
            };
            await writeLocalProjectSwapFile({
                remoteSwapInfo: swapInfo,
                fetchedAt: Date.now(),
                sourceOriginUrl: currentGitUrl,
            }, projectUri);
            debug("Also wrote swap info to localProjectSwap.json");
        } catch (localWriteError) {
            debug("Failed to write localProjectSwap.json (non-fatal):", localWriteError);
        }

        debug("Metadata updated successfully, committing and pushing changes...");

        // Commit and push the changes
        const commitMessage = `Initiated project swap to ${newProjectName}`;
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            commitMessage,
            { bypassUpdatingCheck: true } // allow sync even though swap requirement is now set
        );

        // Show success message
        await vscode.window.showInformationMessage(
            `✅ Project Swap Initiated\n\n` +
            `All users will be prompted to swap to "${newProjectName}" when they next open or sync this project.`,
            { modal: true }
        );

    } catch (error) {
        if (error instanceof Error && error.message === "Invalid URL") {
            // Already showed error message
            return;
        }
        console.error("Error in initiateProjectSwap:", error);
        await vscode.window.showErrorMessage(
            `Failed to initiate project swap: ${error instanceof Error ? error.message : String(error)}`,
            { modal: true }
        );
    }
}

/**
 * Command to view the current project swap status
 */
export async function viewProjectSwapStatus(): Promise<void> {
    try {
        // Check if we're in a workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.window.showErrorMessage("No workspace folder open. Please open a project first.", { modal: true });
            return;
        }

        const projectUri = workspaceFolder.uri;
        
        // Check BOTH metadata.json AND localProjectSwap.json for swap info
        let effectiveSwapInfo: ProjectSwapInfo | undefined;
        
        try {
            const metadataPath = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "metadata.json"));
            const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
            const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;
            effectiveSwapInfo = metadata?.meta?.projectSwap;
        } catch {
            // metadata.json might not exist or have issues
        }
        
        if (!effectiveSwapInfo) {
            try {
                const { readLocalProjectSwapFile } = await import("../utils/localProjectSettings");
                const localSwapFile = await readLocalProjectSwapFile(projectUri);
                if (localSwapFile?.remoteSwapInfo) {
                    effectiveSwapInfo = localSwapFile.remoteSwapInfo;
                    debug("Using swap info from localProjectSwap.json for status view");
                }
            } catch {
                // Non-fatal
            }
        }

        if (!effectiveSwapInfo) {
            await vscode.window.showInformationMessage(
                "No project swap is configured for this project.",
                { modal: true }
            );
            return;
        }

        // Normalize to new format
        const swap = normalizeProjectSwapInfo(effectiveSwapInfo);
        const allEntries = getAllSwapEntries(swap);
        const activeEntry = getActiveSwapEntry(swap);

        // Build status message
        let statusMessage = `📋 Project Swap Status\n\n`;
        statusMessage += `--- Swap History (${allEntries.length} entries) ---\n\n`;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            const isActive = activeEntry && entry.swapInitiatedAt === activeEntry.swapInitiatedAt;
            const statusIcon = entry.swapStatus === "active" ? "⏳" : "❌";

            statusMessage += `${isActive ? "► " : "  "}${statusIcon} Swap UUID: ${entry.swapUUID}\n`;
            statusMessage += `    Project Type: ${entry.isOldProject ? "OLD (source)" : "NEW (destination)"}\n`;
            statusMessage += `    Status: ${entry.swapStatus.toUpperCase()}\n`;
            statusMessage += `    Old Project: ${entry.oldProjectName}\n`;
            statusMessage += `    New Project: ${entry.newProjectName}\n`;
            statusMessage += `    Initiated: ${new Date(entry.swapInitiatedAt).toLocaleString()} by ${entry.swapInitiatedBy}\n`;

            if (entry.swapReason) {
                statusMessage += `    Reason: ${entry.swapReason}\n`;
            }

            if (entry.swapStatus === "cancelled" && entry.cancelledBy) {
                statusMessage += `    Cancelled: ${new Date(entry.cancelledAt || 0).toLocaleString()} by ${entry.cancelledBy}\n`;
            }

            if (entry.swappedUsers && entry.swappedUsers.length > 0) {
                statusMessage += `    Swapped Users (${entry.swappedUsers.length}):\n`;
                entry.swappedUsers.forEach(u => {
                    const completedAt = u.swapCompletedAt ? new Date(u.swapCompletedAt).toLocaleDateString() : new Date(u.updatedAt).toLocaleDateString();
                    statusMessage += `      - ${u.userToSwap} (${completedAt})\n`;
                });
            }

            statusMessage += `\n`;
        }

        if (allEntries.length === 0) {
            statusMessage += `No swap entries found.\n`;
        }

        await vscode.window.showInformationMessage(statusMessage, { modal: true });

    } catch (error) {
        console.error("Error in viewProjectSwapStatus:", error);
        await vscode.window.showErrorMessage(
            `Failed to view swap status: ${error instanceof Error ? error.message : String(error)}`,
            { modal: true }
        );
    }
}

/**
 * Command to cancel a pending project swap
 * Instance administrators only
 */
export async function cancelProjectSwap(): Promise<void> {
    try {
        // Check if we're in a workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.window.showErrorMessage("No workspace folder open. Please open a project first.", { modal: true });
            return;
        }

        const projectUri = vscode.Uri.file(workspaceFolder.uri.fsPath);
        
        // FIRST: Check if there's actually a swap to cancel (before checking permissions)
        // Check BOTH metadata.json AND localProjectSwap.json for swap info
        let metadata: ProjectMetadata | undefined;
        let effectiveSwapInfo: ProjectSwapInfo | undefined;
        let swapSourceIsLocal = false;
        
        try {
            const metadataPath = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "metadata.json"));
            const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
            metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;
            effectiveSwapInfo = metadata?.meta?.projectSwap;
        } catch {
            // metadata.json might not exist or have issues
        }
        
        if (!effectiveSwapInfo) {
            try {
                const { readLocalProjectSwapFile } = await import("../utils/localProjectSettings");
                const localSwapFile = await readLocalProjectSwapFile(projectUri);
                if (localSwapFile?.remoteSwapInfo) {
                    effectiveSwapInfo = localSwapFile.remoteSwapInfo;
                    swapSourceIsLocal = true;
                    debug("Using swap info from localProjectSwap.json for cancel");
                }
            } catch {
                // Non-fatal
            }
        }

        // If no swap info exists at all, tell the user
        if (!effectiveSwapInfo) {
            await vscode.window.showInformationMessage(
                "No project swap is configured for this project.",
                { modal: true }
            );
            return;
        }

        // Normalize to new format and find active swap entry
        const normalizedSwap = normalizeProjectSwapInfo(effectiveSwapInfo);
        const activeEntry = getActiveSwapEntry(normalizedSwap);

        // If no active entry to cancel, tell the user
        if (!activeEntry) {
            await vscode.window.showInformationMessage(
                "No pending swap to cancel. All previous swaps have been cancelled or completed.",
                { modal: true }
            );
            return;
        }

        // NOW check permissions (only if there's actually something to cancel)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            // Provide a clear, user-friendly message based on the actual reason
            let message: string;
            
            if (permission.error === "No git remote origin found") {
                message = "This project has not been published yet.\n\nYou can only cancel swaps for published projects.";
            } else if (permission.error === "Insufficient permissions") {
                message = "You don't have permission to cancel project swaps.\n\nOnly Project Maintainers or Owners can cancel swaps.";
            } else if (permission.error === "Authentication not available") {
                message = "Please log in to cancel project swaps.";
            } else if (permission.error === "Could not determine current user") {
                message = "Could not determine your user account.\n\nPlease log in and try again.";
            } else {
                message = permission.error || "Unable to verify permissions.";
            }

            await vscode.window.showWarningMessage(message, { modal: true });
            return;
        }

        // Confirm cancellation - only "Yes, Cancel Swap" button, modal Cancel is the default way to decline
        const confirmed = await vscode.window.showWarningMessage(
            `Cancel Project Swap?\n\nThis will cancel the swap to "${activeEntry.newProjectName}". Users will no longer be prompted to swap.\n\nContinue?`,
            { modal: true },
            "Yes, Cancel Swap"
        );

        if (confirmed !== "Yes, Cancel Swap") {
            return;
        }

        // Cancel the active swap entry
        const success = await cancelSwapEntry(
            projectUri,
            activeEntry.swapInitiatedAt,
            permission.currentUser || "unknown"
        );

        if (!success) {
            throw new Error("Failed to update metadata.json");
        }

        await vscode.window.showInformationMessage(
            "Project swap cancelled successfully.",
            { modal: true }
        );

    } catch (error) {
        console.error("Error in cancelProjectSwap:", error);
        await vscode.window.showErrorMessage(
            `Failed to cancel project swap: ${error instanceof Error ? error.message : String(error)}`,
            { modal: true }
        );
    }
}

async function promptSwapIfRequired(projectPath: string): Promise<void> {
    try {
        const result = await checkProjectSwapRequired(projectPath);
        if (!result.required || !result.activeEntry) return;

        const activeEntry = result.activeEntry;
        const newProjectName = activeEntry.newProjectName;

        const selection = await vscode.window.showWarningMessage(
            `📦 Project Swap Required\n\n` +
            `This project has been swapped to a new repository:\n${newProjectName}\n\n` +
            `Reason: ${activeEntry.swapReason || "Repository swap"}\n` +
            `Initiated by: ${activeEntry.swapInitiatedBy}\n\n` +
            `Syncing has been disabled until you swap.\n\n` +
            `Your local changes will be preserved and backed up.`,
            { modal: true },
            "Swap Now"
        );

        if (selection === "Swap Now") {
            await vscode.commands.executeCommand("workbench.action.closeFolder");
        }
    } catch (error) {
        console.error("Error prompting swap after swap initiation:", error);
    }
}

/**
 * Command to copy a project for swap (new UUID, clean git)
 * "Copy to New Project" - Step 1 of Project Swap
 */
export async function initiateSwapCopy(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.window.showErrorMessage("No workspace folder open. Please open a project first.", { modal: true });
            return;
        }

        // Check if user has permission (Project Maintainer or Owner)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            // Provide a clear, user-friendly message based on the actual reason
            let message: string;
            
            if (permission.error === "No git remote origin found") {
                message = "This project has not been published yet.\n\nPublish your project first, then you can copy it to a new swap target.";
            } else if (permission.error === "Insufficient permissions") {
                message = "You don't have permission to copy projects.\n\nOnly Project Maintainers or Owners can create swap copies.";
            } else if (permission.error === "Authentication not available") {
                message = "Please log in to copy projects.";
            } else if (permission.error === "Could not determine current user") {
                message = "Could not determine your user account.\n\nPlease log in and try again.";
            } else {
                message = permission.error || "Unable to verify permissions.";
            }

            await vscode.window.showWarningMessage(message, { modal: true });
            return;
        }

        const currentPath = workspaceFolder.uri.fsPath;
        const currentName = workspaceFolder.name;

        // Get project name from metadata, falling back to folder name
        let sourceName = currentName;
        try {
            const metadataPath = vscode.Uri.file(path.join(currentPath, "metadata.json"));
            const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
            const metadata = JSON.parse(Buffer.from(metadataContent).toString("utf-8")) as ProjectMetadata;
            if (metadata.projectName) sourceName = metadata.projectName;
        } catch (e) {
            // Ignore - use folder name
        }

        // Get base name without UUID (for swap copy, we always want a fresh UUID)
        const sourceUuid = extractProjectIdFromFolderName(sourceName);
        const baseName = sourceUuid 
            ? sourceName.substring(0, sourceName.length - sourceUuid.length - 1)
            : sourceName;

        // Prompt for new name (user can change the base name, UUID will be added)
        const newName = await vscode.window.showInputBox({
            prompt: "Enter name for the new swapped project (UUID will be added automatically)",
            value: baseName,
            validateInput: (value) => value ? null : "Name is required"
        });

        if (!newName) return;

        const sourceRemoteUrl = await getGitOriginUrl(currentPath);

        // Generate NEW UUID for the swapped project
        const newUUID = generateProjectId();

        // Sanitize user input and construct folder name
        // If user entered a name with a UUID, we still use our new UUID (swap = fresh identity)
        const sanitizedBaseName = sanitizeProjectName(newName);
        const existingUuidInInput = extractProjectIdFromFolderName(sanitizedBaseName);
        const finalBaseName = existingUuidInInput
            ? sanitizedBaseName.substring(0, sanitizedBaseName.length - existingUuidInInput.length - 1)
            : sanitizedBaseName;
        const newFolderName = `${finalBaseName}-${newUUID}`;
        const parentDir = path.dirname(currentPath);
        const newProjectPath = path.join(parentDir, newFolderName);

        // Check if exists
        if (fs.existsSync(newProjectPath)) {
            await vscode.window.showErrorMessage(`Target directory already exists: ${newProjectPath}`, { modal: true });
            return;
        }

        // Confirm
        const confirm = await vscode.window.showWarningMessage(
            `Copy project to "${newName}"?\n\nThis will create a fresh local copy with a new ID and NO git history.\n\nNew location: ${newProjectPath}`,
            { modal: true },
            "Yes, Copy"
        );
        if (confirm !== "Yes, Copy") return;

        // Ensure we sync before swapping (mirrors remote updating flow)
        try {
            await vscode.commands.executeCommand(
                "codex-editor-extension.triggerSync",
                "Prepare swap (sync before copy)"
            );
        } catch (err) {
            console.error("Pre-swap sync failed:", err);
            await vscode.window.showErrorMessage(
                "Copy aborted because sync could not complete. Please resolve sync issues and try again.",
                { modal: true }
            );
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Copying project for swap...",
            cancellable: false
        }, async (progress) => {
            // Copy folder
            progress.report({ message: "Copying files..." });

            // Exclude .git and indexes.sqlite during copy
            fs.cpSync(currentPath, newProjectPath, {
                recursive: true,
                filter: (src) => {
                    const basename = path.basename(src);
                    return basename !== ".git" && basename !== "indexes.sqlite";
                }
            });

            // Update metadata
            progress.report({ message: "Updating project identity..." });
            const newMetadataPath = path.join(newProjectPath, "metadata.json");

            if (fs.existsSync(newMetadataPath)) {
                const metaContent = fs.readFileSync(newMetadataPath, 'utf-8');
                const meta = JSON.parse(metaContent);
                meta.projectName = newName;
                meta.projectId = newUUID;

                // Ensure meta structure
                if (!meta.type) meta.type = {};
                if (!meta.type.flavorType) meta.type.flavorType = {};
                if (!meta.type.flavorType.currentScope) {
                    meta.type.flavorType.currentScope = generateProjectScope();
                }

                // Defaults for flavor
                if (!meta.type.flavorType.name) meta.type.flavorType.name = "default";
                if (!meta.type.flavorType.flavor) {
                    meta.type.flavorType.flavor = {
                        name: "default",
                        usfmVersion: "3.0",
                        translationType: "unknown",
                        audience: "general",
                        projectType: "unknown",
                    };
                }

                if (meta.meta) {
                    meta.meta.dateCreated = new Date().toISOString();
                    // Clear projectSwap info if present
                    if (meta.meta.projectSwap) {
                        delete meta.meta.projectSwap;
                    }
                }

                fs.writeFileSync(newMetadataPath, JSON.stringify(meta, null, 4));
            }

            await validateAndFixProjectMetadata(vscode.Uri.file(newProjectPath));

            // Clear local settings sync state
            const localSettingsPath = path.join(newProjectPath, ".project", "localProjectSettings.json");
            if (fs.existsSync(localSettingsPath)) {
                try {
                    const settingsContent = fs.readFileSync(localSettingsPath, 'utf-8');
                    const settings = JSON.parse(settingsContent);
                    if (settings.projectSwap) delete settings.projectSwap;
                    if (settings.updateState) delete settings.updateState;
                    if (settings.pendingUpdate) delete settings.pendingUpdate;
                    if (sourceRemoteUrl) settings.lfsSourceRemoteUrl = sourceRemoteUrl;
                    fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 4));
                } catch (e) {
                    // ignore
                }
            }

            // Initialize Git
            progress.report({ message: "Initializing git repository..." });
            try {
                await git.init({
                    fs,
                    dir: newProjectPath,
                    defaultBranch: "main",
                });

                await ensureGitConfigsAreUpToDate();
                await ensureGitDisabledInSettings();

                await git.add({
                    fs,
                    dir: newProjectPath,
                    filepath: "metadata.json",
                });

                if (fs.existsSync(path.join(newProjectPath, ".gitignore"))) {
                    await git.add({ fs, dir: newProjectPath, filepath: ".gitignore" });
                }
                if (fs.existsSync(path.join(newProjectPath, ".gitattributes"))) {
                    await git.add({ fs, dir: newProjectPath, filepath: ".gitattributes" });
                }

                const { getAuthApi } = await import("../extension");
                const authApi = getAuthApi();
                let userInfo;
                if (authApi?.getAuthStatus()?.isAuthenticated) {
                    userInfo = await authApi.getUserInfo();
                }

                await git.commit({
                    fs,
                    dir: newProjectPath,
                    message: `Initial commit (swapped from ${currentName})`,
                    author: {
                        name: userInfo?.username || "Codex User",
                        email: userInfo?.email || "user@example.com"
                    }
                });
            } catch (error) {
                console.error("Git initialization failed during swap copy:", error);
                await vscode.window.showErrorMessage(`Git initialization failed: ${error}`, { modal: true });
            }

            progress.report({ message: "Opening new project..." });
            
            // Use safe folder switch that ensures metadata integrity
            const { MetadataManager } = await import("../utils/metadataManager");
            await MetadataManager.safeOpenFolder(
                vscode.Uri.file(newProjectPath),
                workspaceFolder.uri
            );
        });

    } catch (error) {
        await vscode.window.showErrorMessage(`Swap copy failed: ${error instanceof Error ? error.message : String(error)}`, { modal: true });
    }
}

/**
 * Register all project swap commands
 */
export function registerProjectSwapCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.initiateProjectSwap",
            initiateProjectSwap
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.viewProjectSwapStatus",
            viewProjectSwapStatus
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.cancelProjectSwap",
            cancelProjectSwap
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.initiateSwapCopy",
            initiateSwapCopy
        )
    );

    debug("Project swap commands registered");
}
