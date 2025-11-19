import * as vscode from "vscode";
import { MetadataManager } from "../utils/metadataManager";
import {
    extractProjectIdFromUrl,
    fetchProjectMembers,
    fetchProjectContributors,
    clearRemoteMetadataCache,
} from "../utils/remoteHealingManager";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[RemoteHealingCommands]", ...args) : () => { };

interface MemberQuickPickItem extends vscode.QuickPickItem {
    username: string;
    email: string;
    accessLevel?: number;
    roleName?: string;
    commits?: number;
    isContributor: boolean;
}

/**
 * Command to initiate remote healing for selected users
 * This allows project administrators to mark users for forced project healing
 */
export async function initiateRemoteHealing(): Promise<void> {
    try {
        debug("Starting remote healing setup");

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

        // Get git origin URL
        let gitOriginUrl: string;
        try {
            const git = await import("isomorphic-git");
            const fs = await import("fs");
            const remotes = await git.listRemotes({ fs, dir: workspacePath });
            const origin = remotes.find((r) => r.remote === "origin");

            if (!origin) {
                vscode.window.showErrorMessage(
                    "No git remote origin found. This project is not connected to a remote repository."
                );
                return;
            }

            gitOriginUrl = origin.url;
            debug("Git origin URL:", gitOriginUrl);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to get git remote: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }

        // Extract project ID from URL
        const projectId = extractProjectIdFromUrl(gitOriginUrl);
        if (!projectId) {
            vscode.window.showErrorMessage(
                "Could not extract project ID from git URL. Make sure the project is hosted on GitLab."
            );
            return;
        }

        debug("Project ID:", projectId);

        // Fetch both contributors and all members
        const [contributors, members] = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Fetching project members...",
                cancellable: false,
            },
            async () => {
                return await Promise.all([
                    fetchProjectContributors(projectId),
                    fetchProjectMembers(projectId),
                ]);
            }
        );

        if (!members || members.length === 0) {
            vscode.window.showErrorMessage(
                "Could not fetch project members. Make sure you're authenticated with Frontier."
            );
            return;
        }

        debug("Fetched contributors:", contributors);
        debug("Fetched members:", members);

        // Read current metadata to see who's already in the healing list
        const metadataResult = await MetadataManager.safeReadMetadata(workspaceFolder.uri);
        if (!metadataResult.success) {
            vscode.window.showErrorMessage(
                `Failed to read metadata: ${metadataResult.error}`
            );
            return;
        }

        const currentHealingList: string[] =
            (metadataResult.metadata?.meta?.initiateRemoteHealingFor as string[] | undefined) || [];
        debug("Current healing list:", currentHealingList);

        // Create a map of contributors by username for quick lookup
        const contributorMap = new Map(
            (contributors || []).map((c) => [c.username, c])
        );

        // Create Quick Pick items, separating contributors from non-contributors
        const contributorItems: MemberQuickPickItem[] = [];
        const nonContributorItems: MemberQuickPickItem[] = [];

        for (const member of members) {
            const contributor = contributorMap.get(member.username);
            const isContributor = !!contributor;

            // Only show name if it's different from username
            const showName = member.name && member.name !== member.username;

            const item: MemberQuickPickItem = {
                label: member.username,
                description: isContributor
                    ? showName
                        ? `${member.name} — ${contributor!.commits} commit${contributor!.commits !== 1 ? "s" : ""} — ${member.roleName}`
                        : `${contributor!.commits} commit${contributor!.commits !== 1 ? "s" : ""} — ${member.roleName}`
                    : showName
                        ? `${member.name} — ${member.roleName}`
                        : member.roleName,
                picked: currentHealingList.includes(member.username) ||
                    (!!member.email && currentHealingList.includes(member.email)),
                username: member.username,
                email: member.email,
                accessLevel: member.accessLevel,
                roleName: member.roleName,
                commits: contributor?.commits,
                isContributor,
            };

            if (isContributor) {
                contributorItems.push(item);
            } else {
                nonContributorItems.push(item);
            }
        }

        // Sort contributors by commit count (descending) then by username
        contributorItems.sort((a, b) => {
            if (b.commits !== a.commits) {
                return (b.commits || 0) - (a.commits || 0);
            }
            return a.username.localeCompare(b.username);
        });

        // Sort non-contributors by access level (descending) then by username
        nonContributorItems.sort((a, b) => {
            if ((b.accessLevel || 0) !== (a.accessLevel || 0)) {
                return (b.accessLevel || 0) - (a.accessLevel || 0);
            }
            return a.username.localeCompare(b.username);
        });

        // Combine with separator
        const quickPickItems: (MemberQuickPickItem | vscode.QuickPickItem)[] = [
            ...contributorItems,
        ];

        if (contributorItems.length > 0 && nonContributorItems.length > 0) {
            quickPickItems.push({
                label: "No Commits",
                kind: vscode.QuickPickItemKind.Separator,
            } as any);
        }

        quickPickItems.push(...nonContributorItems);

        // Show multi-select Quick Pick
        const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: true,
            placeHolder: "Select users who should be forced to heal their project",
            title: "Remote Project Healing",
            ignoreFocusOut: true,
        });

        if (!selectedItems) {
            debug("User cancelled selection");
            return;
        }

        // Filter out separator items and extract usernames
        const selectedUsernames = selectedItems
            .filter((item): item is MemberQuickPickItem => 'username' in item)
            .map((item) => item.username);
        debug("Selected usernames:", selectedUsernames);

        // Calculate what's changing
        const addedUsers = selectedUsernames.filter(u => !currentHealingList.includes(u));
        const removedUsers = currentHealingList.filter(u => !selectedUsernames.includes(u));
        const unchangedUsers = selectedUsernames.filter(u => currentHealingList.includes(u));

        // Check if there are any changes
        if (addedUsers.length === 0 && removedUsers.length === 0) {
            vscode.window.showInformationMessage("No changes made to healing list.");
            return;
        }

        // Check for other uncommitted changes
        const git = await import("isomorphic-git");
        const fs = await import("fs");
        const statusMatrix = await git.statusMatrix({ fs, dir: workspacePath });

        // Filter out metadata.json and count other changes
        // statusMatrix format: [filepath, HEADStatus, WorkdirStatus, StageStatus]
        // We're looking for files that are modified (not 1,1,1) and not metadata.json
        const otherChanges = statusMatrix.filter(([filepath, HEAD, workdir, stage]) => {
            if (filepath === "metadata.json") {
                return false;
            }
            // Has changes if not (1,1,1) - where 1 means "same as HEAD/workdir/stage"
            return !(HEAD === 1 && workdir === 1 && stage === 1);
        });

        const hasOtherChanges = otherChanges.length > 0;

        // Build detailed confirmation message
        let confirmMessage: string;
        if (selectedUsernames.length === 0) {
            confirmMessage = "Clear the healing list? No users will be forced to heal.";
        } else {
            const parts: string[] = ["PROJECT HEALING"];

            if (addedUsers.length > 0) {
                parts.push(`— Required from —\n${addedUsers.join('\n')}`);
            }

            if (removedUsers.length > 0) {
                parts.push(`— No longer required from —\n${removedUsers.join('\n')}`);
            }

            if (unchangedUsers.length > 0) {
                parts.push(`— Already required from —\n${unchangedUsers.join('\n')}`);
            }

            confirmMessage = parts.join('\n\n');

            // Append warning about other changes if they exist
            if (hasOtherChanges) {
                confirmMessage += `\n\n⚠️  This will also sync ${otherChanges.length} other file change${otherChanges.length !== 1 ? 's' : ''} in your project.`;
            }
        }

        const confirmed = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            "Yes, Update"
        );

        if (confirmed !== "Yes, Update") {
            debug("User cancelled confirmation");
            return;
        }

        // Update metadata.json with the new healing list
        try {
            // Update metadata using MetadataManager
            const updateResult = await MetadataManager.safeUpdateMetadata(
                workspaceFolder.uri,
                (metadata: any) => {
                    if (!metadata.meta) {
                        metadata.meta = {};
                    }

                    // Update the healing list
                    if (selectedUsernames.length === 0) {
                        // Remove the field if empty
                        delete metadata.meta.initiateRemoteHealingFor;
                    } else {
                        metadata.meta.initiateRemoteHealingFor = selectedUsernames;
                    }

                    return metadata;
                }
            );

            if (!updateResult.success) {
                throw new Error(updateResult.error || "Failed to update metadata");
            }

            debug("Metadata updated successfully");

            // Determine what changed for a precise commit message
            const addedUsers = selectedUsernames.filter(u => !currentHealingList.includes(u));
            const removedUsers = currentHealingList.filter(u => !selectedUsernames.includes(u));

            let commitMessage: string;
            if (selectedUsernames.length === 0) {
                commitMessage = "Cleared remote healing list";
            } else if (addedUsers.length > 0 && removedUsers.length > 0) {
                commitMessage = `Updated remote healing list (added: ${addedUsers.join(", ")}; removed: ${removedUsers.join(", ")})`;
            } else if (addedUsers.length > 0) {
                commitMessage = `Added remote healing for: ${addedUsers.join(", ")}`;
            } else if (removedUsers.length > 0) {
                commitMessage = `Removed remote healing for: ${removedUsers.join(", ")}`;
            } else {
                commitMessage = "Updated remote healing list";
            }

            // Trigger sync and wait for completion
            const authApi = (await import("../extension")).getAuthApi();

            // Set up a promise to wait for sync completion
            const syncCompletionPromise = new Promise<void>((resolve, reject) => {
                if (!authApi || !('onSyncStatusChange' in authApi)) {
                    debug("Auth API not available or doesn't support sync events");
                    resolve(); // Just resolve immediately if events not available
                    return;
                }

                const subscription = (authApi as any).onSyncStatusChange((status: any) => {
                    if (status.status === 'completed') {
                        subscription?.dispose();
                        resolve();
                    } else if (status.status === 'error') {
                        subscription?.dispose();
                        reject(new Error(status.message || 'Sync failed'));
                    }
                });

                // Set a timeout in case something goes wrong
                setTimeout(() => {
                    subscription?.dispose();
                    reject(new Error('Sync timeout'));
                }, 120000); // 2 minute timeout
            });

            // Trigger the sync
            vscode.commands.executeCommand(
                "codex-editor-extension.triggerSync",
                commitMessage
            );

            // Wait for sync to complete
            try {
                await syncCompletionPromise;
                debug("Sync completed successfully");
            } catch (error) {
                debug("Sync failed or timed out:", error);
                throw error;
            }

            // Clear the remote metadata cache so next checks get fresh data
            clearRemoteMetadataCache(projectId);

            // Show success message after sync completes
            const successMessage =
                selectedUsernames.length === 0
                    ? "Healing list cleared successfully."
                    : `Remote healing active for ${selectedUsernames.length} user${selectedUsernames.length !== 1 ? "s" : ""}. They will be forced to heal when they open this project.`;

            vscode.window.showInformationMessage(successMessage);
        } catch (error) {
            console.error("Error updating remote healing list:", error);
            vscode.window.showErrorMessage(
                `Failed to update remote healing list: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    } catch (error) {
        console.error("Error in initiateRemoteHealing:", error);
        vscode.window.showErrorMessage(
            `Failed to set up remote healing: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Command to view the current remote healing list
 */
export async function viewRemoteHealingList(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder open.");
            return;
        }

        const metadataResult = await MetadataManager.safeReadMetadata(workspaceFolder.uri);
        if (!metadataResult.success) {
            vscode.window.showErrorMessage(
                `Failed to read metadata: ${metadataResult.error}`
            );
            return;
        }

        const healingList: string[] =
            (metadataResult.metadata?.meta?.initiateRemoteHealingFor as string[] | undefined) || [];

        if (healingList.length === 0) {
            vscode.window.showInformationMessage("No users are currently marked for remote healing.");
        } else {
            const message = `Users marked for remote healing:\n${healingList.join("\n")}`;
            vscode.window.showInformationMessage(message, { modal: true });
        }
    } catch (error) {
        console.error("Error viewing remote healing list:", error);
        vscode.window.showErrorMessage(
            `Failed to view healing list: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Register all remote healing commands
 */
export function registerRemoteHealingCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.initiateRemoteHealing",
            initiateRemoteHealing
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.viewRemoteHealingList",
            viewRemoteHealingList
        )
    );

    debug("Remote healing commands registered");
}

