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
    ensureGitDisabledInSettings
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
        // Commit and push the changes
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            "Cancelled project swap"
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
            vscode.window.showErrorMessage("No workspace folder open. Please open a project first.");
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        debug("Workspace path:", workspacePath);

        // Check if this is a Codex project (has metadata.json)
        const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
        try {
            await vscode.workspace.fs.stat(metadataUri);
        } catch {
            vscode.window.showErrorMessage(
                "This is not a Codex project. No metadata.json found."
            );
            return;
        }

        // Check if user has permission (Project Maintainer or Owner)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            const errorMsg = permission.error || "Insufficient permissions";
            // Don't show reason if it's just the expected permission error (redundant with main message)
            const reasonPart = errorMsg === "Insufficient permissions" ? "" : `\n\nReason: ${errorMsg}`;

            await vscode.window.showWarningMessage(
                `⛔ Permission Denied\n\nOnly Project Maintainers or Owners can initiate project swaps.${reasonPart}`,
                { modal: true }
            );
            return;
        }

        debug("Permission check passed - user has sufficient privileges");

        // Get current git origin URL
        const currentGitUrl = await getGitOriginUrl(workspacePath);
        if (!currentGitUrl) {
            vscode.window.showErrorMessage(
                "Could not determine current git origin URL. Make sure this is a valid git repository."
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
                    vscode.window.showInformationMessage("Previous swap cancelled. You can now initiate a new swap.");
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
            vscode.window.showErrorMessage(
                `Invalid repository URL: ${validation.error}`
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
            vscode.window.showErrorMessage("Authentication not available");
            return;
        }

        const currentUserInfo = await authApi.getUserInfo();
        if (!currentUserInfo || !currentUserInfo.username) {
            vscode.window.showErrorMessage("Could not determine current user");
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

        // Generate UUID (or reuse if exists)
        const projectUUID = metadata?.meta?.projectSwap?.projectUUID || generateProjectId();
        const now = Date.now();

        // Create new swap entry
        const newEntry: ProjectSwapEntry = {
            swapInitiatedAt: now,
            swapModifiedAt: now,
            swapStatus: "active",
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
                    : { swapEntries: [], isOldProject: true };

                // Add new entry to the array (preserving history)
                const updatedEntries = [...(existingSwap.swapEntries || []), newEntry];

                meta.meta.projectSwap = {
                    swapEntries: updatedEntries,
                    isOldProject: true,
                    projectUUID,
                    oldProjectUrl: currentGitUrl,
                    oldProjectName: extractProjectNameFromUrl(currentGitUrl),
                };
                return meta;
            }
        );

        if (!updateResult.success) {
            throw new Error(updateResult.error || "Failed to update metadata.json");
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
        vscode.window.showInformationMessage(
            `✅ Project Swap Initiated\n\n` +
            `All users will be prompted to swap to "${newProjectName}" when they next open or sync this project.`
        );

    } catch (error) {
        if (error instanceof Error && error.message === "Invalid URL") {
            // Already showed error message
            return;
        }
        console.error("Error in initiateProjectSwap:", error);
        vscode.window.showErrorMessage(
            `Failed to initiate project swap: ${error instanceof Error ? error.message : String(error)}`
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
            vscode.window.showErrorMessage("No workspace folder open. Please open a project first.");
            return;
        }

        const metadataPath = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "metadata.json"));
        const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;

        if (!metadata?.meta?.projectSwap) {
            vscode.window.showInformationMessage(
                "No project swap is configured for this project."
            );
            return;
        }

        // Normalize to new format
        const swap = normalizeProjectSwapInfo(metadata.meta.projectSwap);
        const allEntries = getAllSwapEntries(swap);
        const activeEntry = getActiveSwapEntry(swap);

        // Build status message
        let statusMessage = `📋 Project Swap Status\n\n`;
        statusMessage += `Project UUID: ${swap.projectUUID || "N/A"}\n`;
        statusMessage += `Project Type: ${swap.isOldProject ? "OLD (source)" : "NEW (destination)"}\n\n`;

        if (swap.isOldProject && swap.oldProjectUrl) {
            statusMessage += `This project URL: ${swap.oldProjectUrl}\n`;
        } else if (!swap.isOldProject && swap.oldProjectUrl) {
            statusMessage += `Swapped from: ${swap.oldProjectUrl}\n`;
        }

        statusMessage += `\n--- Swap History (${allEntries.length} entries) ---\n\n`;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            const isActive = activeEntry && entry.swapInitiatedAt === activeEntry.swapInitiatedAt;
            const statusIcon = entry.swapStatus === "active" ? "⏳" : "❌";

            statusMessage += `${isActive ? "► " : "  "}${statusIcon} ${entry.newProjectName}\n`;
            statusMessage += `    Status: ${entry.swapStatus.toUpperCase()}\n`;
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

        vscode.window.showInformationMessage(statusMessage, { modal: true });

    } catch (error) {
        console.error("Error in viewProjectSwapStatus:", error);
        vscode.window.showErrorMessage(
            `Failed to view swap status: ${error instanceof Error ? error.message : String(error)}`
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
            vscode.window.showErrorMessage("No workspace folder open. Please open a project first.");
            return;
        }

        // Check if user has permission (Project Maintainer or Owner)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            const errorMsg = permission.error || "Insufficient permissions";
            // Don't show reason if it's just the expected permission error (redundant with main message)
            const reasonPart = errorMsg === "Insufficient permissions" ? "" : `\n\nReason: ${errorMsg}`;

            await vscode.window.showWarningMessage(
                `⛔ Permission Denied\n\nOnly Project Maintainers or Owners can cancel project swaps.${reasonPart}`,
                { modal: true }
            );
            return;
        }

        const projectUri = vscode.Uri.file(workspaceFolder.uri.fsPath);
        const metadataPath = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "metadata.json"));
        const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;

        if (!metadata?.meta?.projectSwap) {
            vscode.window.showInformationMessage(
                "No project swap is configured for this project."
            );
            return;
        }

        // Normalize to new format and find active swap entry
        const normalizedSwap = normalizeProjectSwapInfo(metadata.meta.projectSwap);
        const activeEntry = getActiveSwapEntry(normalizedSwap);

        if (!activeEntry) {
            vscode.window.showInformationMessage(
                "No pending swap to cancel. All previous swaps have been cancelled or completed."
            );
            return;
        }

        // Confirm cancellation
        const confirmed = await vscode.window.showWarningMessage(
            `Cancel Project Swap?\n\nThis will cancel the swap to "${activeEntry.newProjectName}". Users will no longer be prompted to swap.\n\nContinue?`,
            { modal: true },
            "Yes, Cancel Swap",
            "No"
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

        vscode.window.showInformationMessage(
            "Project swap cancelled successfully."
        );

    } catch (error) {
        console.error("Error in cancelProjectSwap:", error);
        vscode.window.showErrorMessage(
            `Failed to cancel project swap: ${error instanceof Error ? error.message : String(error)}`
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
            vscode.window.showErrorMessage("No workspace folder open. Please open a project first.");
            return;
        }

        // Check if user has permission (Project Maintainer or Owner)
        const permission = await checkProjectAdminPermissions();
        if (!permission.hasPermission) {
            const errorMsg = permission.error || "Insufficient permissions";
            const reasonPart = errorMsg === "Insufficient permissions" ? "" : `\n\nReason: ${errorMsg}`;
            await vscode.window.showWarningMessage(
                `⛔ Permission Denied\n\nOnly Project Maintainers or Owners can copy projects to a new swap target.${reasonPart}`,
                { modal: true }
            );
            return;
        }

        const currentPath = workspaceFolder.uri.fsPath;
        const currentName = workspaceFolder.name;

        // Get metadata to get clean project name
        let cleanName = currentName;
        try {
            const metadataPath = vscode.Uri.file(path.join(currentPath, "metadata.json"));
            const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
            const metadata = JSON.parse(Buffer.from(metadataContent).toString("utf-8")) as ProjectMetadata;
            if (metadata.projectName) cleanName = metadata.projectName;
        } catch (e) {
            // Ignore
        }

        // Prompt for new name
        const newName = await vscode.window.showInputBox({
            prompt: "Enter name for the new swapped project",
            value: cleanName,
            validateInput: (value) => value ? null : "Name is required"
        });

        if (!newName) return;

        const sourceRemoteUrl = await getGitOriginUrl(currentPath);

        // Generate new UUID
        const newUUID = generateProjectId();

        // Construct new folder name
        const sanitizedName = sanitizeProjectName(newName);
        const newFolderName = `${sanitizedName}-${newUUID}`;
        const parentDir = path.dirname(currentPath);
        const newProjectPath = path.join(parentDir, newFolderName);

        // Check if exists
        if (fs.existsSync(newProjectPath)) {
            vscode.window.showErrorMessage(`Target directory already exists: ${newProjectPath}`);
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
            vscode.window.showErrorMessage(
                "Copy aborted because sync could not complete. Please resolve sync issues and try again."
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
                vscode.window.showErrorMessage(`Git initialization failed: ${error}`);
            }

            progress.report({ message: "Opening new project..." });
            await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(newProjectPath));
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Swap copy failed: ${error instanceof Error ? error.message : String(error)}`);
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
