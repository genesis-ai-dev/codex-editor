import * as vscode from "vscode";
import * as path from "path";
import { ProjectMetadata, ProjectSwapInfo } from "../../types";
import { MetadataManager } from "../utils/metadataManager";
import {
    validateGitUrl,
    generateProjectUUID,
    getGitOriginUrl,
    extractProjectNameFromUrl,
} from "../utils/projectSwapManager";
import { checkProjectAdminPermissions } from "../utils/projectAdminPermissionChecker";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectSwapCommands]", ...args) : () => { };

/**
 * Command to initiate a project swap (migrate to new Git repository)
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

        // Check if swap already initiated
        const projectUri = vscode.Uri.file(workspacePath);
        const metadataPath = vscode.Uri.file(path.join(workspacePath, "metadata.json"));
        const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;

        if (metadata?.meta?.projectSwap) {
            const existing = metadata.meta.projectSwap;
            const statusMsg = existing.swapStatus === "completed"
                ? "This project has already completed a swap."
                : existing.swapStatus === "pending"
                    ? "A swap is already pending for this project."
                    : existing.swapStatus === "migrating"
                        ? "A swap is currently in progress."
                        : "This project already has swap configuration.";

            const action = await vscode.window.showWarningMessage(
                `${statusMsg}\n\nDo you want to reconfigure the swap?`,
                { modal: true },
                "Yes, Reconfigure",
                "No, Cancel"
            );

            if (action !== "Yes, Reconfigure") {
                return;
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
            `This will require ALL users to migrate to:\n${newProjectName}\n\n` +
            `Current: ${currentGitUrl}\n` +
            `New: ${newProjectUrl}\n\n` +
            `Users will be prompted to migrate when they next sync or open the project.\n\n` +
            `This cannot be easily undone. Continue?`,
            { modal: true },
            "Yes, Initiate Swap",
            "No, Cancel"
        );

        if (confirmed !== "Yes, Initiate Swap") {
            return;
        }

        // Generate UUID (or reuse if reconfiguring)
        const projectUUID = metadata?.meta?.projectSwap?.projectUUID || generateProjectUUID();

        // Create swap info
        const swapInfo: ProjectSwapInfo = {
            projectUUID,
            isOldProject: true,
            newProjectUrl,
            newProjectName,
            oldProjectUrl: currentGitUrl,
            swapInitiatedBy: currentUserInfo.username,
            swapInitiatedAt: Date.now(),
            swapReason,
            swapStatus: "pending",
        };

        // Update metadata.json
        const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta) {
                    meta.meta = {} as any;
                }

                meta.meta.projectSwap = swapInfo;
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
            commitMessage
        );

        // Show success message
        vscode.window.showInformationMessage(
            `✅ Project Swap Initiated\n\n` +
            `All users will be prompted to migrate to "${newProjectName}" when they next open or sync this project.`
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

        const swap = metadata.meta.projectSwap;

        // Build status message
        const statusIcon = swap.swapStatus === "completed" ? "✅" :
            swap.swapStatus === "pending" ? "⏳" :
                swap.swapStatus === "migrating" ? "🔄" :
                    swap.swapStatus === "failed" ? "❌" : "⚠️";

        let statusMessage = `${statusIcon} Project Swap Status\n\n`;
        statusMessage += `Status: ${swap.swapStatus.toUpperCase()}\n`;
        statusMessage += `UUID: ${swap.projectUUID}\n\n`;

        if (swap.isOldProject) {
            statusMessage += `This is the OLD project.\n`;
            statusMessage += `Migrating to: ${swap.newProjectName}\n\n`;
        } else {
            statusMessage += `This is the NEW project.\n`;
            statusMessage += `Migrated from: ${swap.oldProjectUrl}\n\n`;
        }

        statusMessage += `Initiated by: ${swap.swapInitiatedBy}\n`;
        statusMessage += `Initiated at: ${new Date(swap.swapInitiatedAt).toLocaleString()}\n`;

        if (swap.swapReason) {
            statusMessage += `Reason: ${swap.swapReason}\n`;
        }

        if (swap.swapCompletedAt) {
            statusMessage += `Completed at: ${new Date(swap.swapCompletedAt).toLocaleString()}\n`;
        }

        if (swap.swapError) {
            statusMessage += `\nError: ${swap.swapError}\n`;
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

        const swap = metadata.meta.projectSwap;

        if (swap.swapStatus === "completed") {
            vscode.window.showWarningMessage(
                "Cannot cancel a completed swap."
            );
            return;
        }

        // Confirm cancellation
        const confirmed = await vscode.window.showWarningMessage(
            `Cancel Project Swap?\n\nThis will cancel the swap to "${swap.newProjectName}". Users will no longer be prompted to migrate.\n\nContinue?`,
            { modal: true },
            "Yes, Cancel Swap",
            "No"
        );

        if (confirmed !== "Yes, Cancel Swap") {
            return;
        }

        // Update metadata to mark as cancelled
        const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (meta.meta?.projectSwap) {
                    meta.meta.projectSwap.swapStatus = "cancelled";
                }
                return meta;
            }
        );

        if (!updateResult.success) {
            throw new Error(updateResult.error || "Failed to update metadata.json");
        }

        // Commit and push the changes
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            "Cancelled project swap"
        );

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

    debug("Project swap commands registered");
}
