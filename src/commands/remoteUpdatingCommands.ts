import * as vscode from "vscode";
import { MetadataManager } from "../utils/metadataManager";
import {
    extractProjectIdFromUrl,
    fetchProjectMembers,
    fetchProjectContributors,
    clearRemoteMetadataCache,
    fetchRemoteMetadata,
    normalizeUpdateEntry,
    isCancelled,
    getCancelledBy,
    RemoteUpdatingEntry,
} from "../utils/remoteUpdatingManager";
import { checkProjectAdminPermissions } from "../utils/projectAdminPermissionChecker";
import { isFeatureEnabled } from "../utils/remoteUpdatingManager";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[RemoteUpdatingCommands]", ...args) : () => { };

interface MemberQuickPickItem extends vscode.QuickPickItem {
    username: string;
    email: string;
    accessLevel?: number;
    roleName?: string;
    commits?: number;
    isContributor: boolean;
    isAdmin?: boolean;  // Instance administrator
}

/**
 * Command to initiate remote updating for selected users
 * This allows project administrators to mark users for forced project updating
 */
export async function initiateRemoteUpdating(): Promise<void> {
    try {
        debug("Starting remote updating setup");

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

        // Check user permissions - only Owners and Maintainers can manage updates
        const authApi = (await import("../extension")).getAuthApi();
        if (!authApi) {
            vscode.window.showErrorMessage(
                "Authentication not available. Please make sure you're logged in."
            );
            return;
        }

        const currentUserInfo = await authApi.getUserInfo();
        if (!currentUserInfo || !currentUserInfo.username) {
            vscode.window.showErrorMessage(
                "Could not determine current user. Please make sure you're authenticated."
            );
            return;
        }

        // Fetch project members to check current user's role
        const memberList = await fetchProjectMembers(projectId);
        if (!memberList) {
            vscode.window.showErrorMessage(
                "Could not fetch project members. Please make sure you're authenticated with Frontier."
            );
            return;
        }

        // Find current user's role
        const currentUserMember = memberList.find(
            m => m.username === currentUserInfo.username || m.email === currentUserInfo.email
        );

        if (!currentUserMember) {
            await vscode.window.showWarningMessage(
                "Your role does not allow updating update requirements.",
                { modal: true }
            );
            return;
        }

        // Check if user has sufficient permissions (Maintainer = 40, Owner = 50)
        if (currentUserMember.accessLevel < 40) {
            await vscode.window.showWarningMessage(
                "Your role does not allow updating update requirements.",
                { modal: true }
            );
            return;
        }

        debug("Permission check passed - user has sufficient role:", currentUserMember.roleName);

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

        // Read current metadata to see who's already in the update list
        const metadataResult = await MetadataManager.safeReadMetadata(workspaceFolder.uri);
        if (!metadataResult.success) {
            vscode.window.showErrorMessage(
                `Failed to read metadata: ${metadataResult.error}`
            );
            return;
        }

        let rawList = (metadataResult.metadata?.meta?.initiateRemoteUpdatingFor as (string | any)[] | undefined) || [];

        // Prefer remote list (fresh from remote head) when available
        try {
            const remoteMeta = await fetchRemoteMetadata(projectId, false); // bypass cache
            const remoteList = remoteMeta?.meta?.initiateRemoteUpdatingFor;
            if (remoteList && Array.isArray(remoteList)) {
                rawList = remoteList;
                debug("Using remote update list from remote head");
            } else {
                debug("Remote update list not available or invalid; using local");
            }
        } catch (e) {
            debug("Could not fetch remote update list; using local", e);
        }

        // Normalize entries to ensure defaults/validation
        const updatingList: RemoteUpdatingEntry[] = rawList.map(entry => normalizeUpdateEntry(entry));

        // Get list of currently active (pending) update requests
        const activeUpdateingUsernames: string[] = [];

        for (const entry of updatingList) {
            if (typeof entry === 'object' && entry !== null) {
                if (!entry.executed && !isCancelled(entry)) {
                    activeUpdateingUsernames.push(entry.userToUpdate);
                }
            }
        }

        debug("Active update usernames:", activeUpdateingUsernames);

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

            // Add instance admin badge if applicable
            // Hide badge for 'root' user unless the current user IS root
            const shouldShowAdminBadge = member.isAdmin &&
                (member.username !== "root" || currentUserInfo.username === "root");
            const adminBadge = shouldShowAdminBadge ? " 🔑 Instance Admin" : "";

            const item: MemberQuickPickItem = {
                label: member.username,
                description: isContributor
                    ? showName
                        ? `${member.name} — ${contributor!.commits} commit${contributor!.commits !== 1 ? "s" : ""} — ${member.roleName}${adminBadge}`
                        : `${contributor!.commits} commit${contributor!.commits !== 1 ? "s" : ""} — ${member.roleName}${adminBadge}`
                    : showName
                        ? `${member.name} — ${member.roleName}${adminBadge}`
                        : `${member.roleName}${adminBadge}`,
                picked: activeUpdateingUsernames.includes(member.username),
                username: member.username,
                email: member.email,
                accessLevel: member.accessLevel,
                roleName: member.roleName,
                commits: contributor?.commits,
                isContributor,
                isAdmin: member.isAdmin,
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
            placeHolder: "Select users who should be forced to update their project",
            title: "Remote Project Updating",
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

        // Calculate what's changing (based on active list)
        const addedUsers = selectedUsernames.filter(u => !activeUpdateingUsernames.includes(u));
        const removedUsers = activeUpdateingUsernames.filter(u => !selectedUsernames.includes(u));
        const unchangedUsers = selectedUsernames.filter(u => activeUpdateingUsernames.includes(u));

        // Check if there are any changes
        if (addedUsers.length === 0 && removedUsers.length === 0) {
            vscode.window.showInformationMessage("No changes made to update list.");
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
            confirmMessage = "Clear the update list? No users will be forced to update.";
        } else {
            const parts: string[] = ["PROJECT UPDATING"];

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

        // Update metadata.json with the new updating list
        try {
            // Update metadata using MetadataManager
            const updateResult = await MetadataManager.safeUpdateMetadata(
                workspaceFolder.uri,
                (metadata: any) => {
                    if (!metadata.meta) {
                        metadata.meta = {};
                    }

                    const currentList = (metadata.meta.initiateRemoteUpdatingFor || []) as (string | any)[];
                    const now = Date.now();
                    const currentUser = currentUserInfo.username;

                    const newList: any[] = [];
                    const usersWithActiveEntry = new Set<string>();

                    // 1. Process all existing entries
                    // We iterate the list directly instead of using a Map to preserve ALL history
                    for (const entry of currentList) {
                        if (typeof entry !== 'object' || entry === null) continue;

                        const username = entry.userToUpdate;

                        if (entry.executed || isCancelled(entry)) {
                            // Always keep executed or cancelled entries (History)
                            newList.push(entry);
                        } else {
                            // This is a PENDING (Active) entry
                            if (selectedUsernames.includes(username)) {
                                // User is still selected -> Keep active
                                newList.push(entry);
                                usersWithActiveEntry.add(username);
                            } else {
                                // User is NOT selected -> Cancel this pending entry
                                newList.push({
                                    ...entry,
                                    cancelled: true,
                                    cancelledBy: currentUser,
                                    updatedAt: now
                                });
                            }
                        }
                    }

                    // 2. Add new entries for selected users who didn't have an active entry
                    for (const username of selectedUsernames) {
                        if (!usersWithActiveEntry.has(username)) {
                            newList.push({
                                userToUpdate: username,
                                addedBy: currentUser,
                                createdAt: now,
                                updatedAt: now,
                                cancelled: false,
                                cancelledBy: "",
                                executed: false
                            });
                        }
                    }

                    metadata.meta.initiateRemoteUpdatingFor = newList;
                    return metadata;
                }
            );

            if (!updateResult.success) {
                throw new Error(updateResult.error || "Failed to update metadata");
            }

            debug("Metadata updated successfully");

            // Determine what changed for a precise commit message
            const addedUsers = selectedUsernames.filter(u => !activeUpdateingUsernames.includes(u));
            const removedUsers = activeUpdateingUsernames.filter(u => !selectedUsernames.includes(u));

            let commitMessage: string;
            if (selectedUsernames.length === 0 && activeUpdateingUsernames.length > 0) {
                commitMessage = "Cleared remote update list";
            } else if (addedUsers.length > 0 && removedUsers.length > 0) {
                commitMessage = `Updated remote update list (added: ${addedUsers.join(", ")}; removed: ${removedUsers.join(", ")})`;
            } else if (addedUsers.length > 0) {
                commitMessage = `Added remote update for: ${addedUsers.join(", ")}`;
            } else if (removedUsers.length > 0) {
                commitMessage = `Removed remote update for: ${removedUsers.join(", ")}`;
            } else {
                commitMessage = "Updated remote update list";
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
                    ? "Update list cleared successfully."
                    : `Remote update active for ${selectedUsernames.length} user${selectedUsernames.length !== 1 ? "s" : ""}. They will be forced to update when they open this project.`;

            vscode.window.showInformationMessage(successMessage);
        } catch (error) {
            console.error("Error updating remote update list:", error);
            vscode.window.showErrorMessage(
                `Failed to update remote update list: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    } catch (error) {
        console.error("Error in initiateRemoteUpdating:", error);
        vscode.window.showErrorMessage(
            `Failed to set up remote update: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Command to view the current remote update list
 */
export async function viewRemoteUpdatingList(): Promise<void> {
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

        let rawList = (metadataResult.metadata?.meta?.initiateRemoteUpdatingFor as (string | any)[] | undefined) || [];

        // Try to fetch the remote list from remote head; fallback to local on failure/offline
        try {
            const git = await import("isomorphic-git");
            const fs = await import("fs");
            const remotes = await git.listRemotes({ fs, dir: workspaceFolder.uri.fsPath });
            const origin = remotes.find((r) => r.remote === "origin");
            if (origin?.url) {
                const projectId = extractProjectIdFromUrl(origin.url);
                if (projectId) {
                    const remoteMeta = await fetchRemoteMetadata(projectId, false); // bypass cache
                    const remoteList = remoteMeta?.meta?.initiateRemoteUpdatingFor;
                    if (remoteList && Array.isArray(remoteList)) {
                        rawList = remoteList;
                        debug("Using remote update list for viewRemoteUpdatingList");
                    }
                }
            }
        } catch (e) {
            debug("Could not fetch remote update list for viewRemoteUpdatingList; using local", e);
        }

        // Normalize entries to ensure defaults/validation
        const updatingList: RemoteUpdatingEntry[] = rawList.map(entry => normalizeUpdateEntry(entry));

        if (updatingList.length === 0) {
            vscode.window.showInformationMessage("No users are currently marked for remote update.");
            return;
        }

        // Helper to generate items based on filter
        const generateItems = (filterType: 'all' | 'pending' | 'executed' | 'cancelled'): vscode.QuickPickItem[] => {
            const now = Date.now();
            const ONE_DAY = 24 * 60 * 60 * 1000;
            const SEVEN_DAYS = 7 * ONE_DAY;
            const FOURTEEN_DAYS = 14 * ONE_DAY;

            // Filter raw list first
            const filteredRawList = updatingList.filter(entry => {
                if (typeof entry === 'string') return false;
                if (filterType === 'all') return true;
                if (filterType === 'pending') return !entry.executed && !isCancelled(entry);
                if (filterType === 'executed') return entry.executed;
                if (filterType === 'cancelled') return isCancelled(entry);
                return true;
            });

            // Sort by Status then Time (newest first)
            const sortedList = [...filteredRawList].sort((a, b) => {
                if (typeof a === 'string' || typeof b === 'string') return 0;

                const getPriority = (entry: any) => {
                    if (!isCancelled(entry) && !entry.executed) return 0; // Pending (highest priority)
                    if (entry.executed) return 1; // Executed (includes cancelled+executed cases)
                    return 2; // Cancelled only
                };

                const priorityA = getPriority(a);
                const priorityB = getPriority(b);

                if (priorityA !== priorityB) return priorityA - priorityB;
                return b.createdAt - a.createdAt;
            });

            // Group by time buckets
            const last7Days: any[] = [];
            const last7To14Days: any[] = [];
            const over14Days: any[] = [];

            sortedList.forEach(entry => {
                if (typeof entry === 'string') return;
                const age = now - entry.createdAt;
                if (age <= SEVEN_DAYS) {
                    last7Days.push(entry);
                } else if (age <= FOURTEEN_DAYS) {
                    last7To14Days.push(entry);
                } else {
                    over14Days.push(entry);
                }
            });

            const items: vscode.QuickPickItem[] = [];

            const addGroup = (label: string, entries: any[]) => {
                if (entries.length === 0) return;

                items.push({
                    label: label,
                    kind: vscode.QuickPickItemKind.Separator
                });

                entries.forEach(entry => {
                    let icon = "$(clock)";
                    let statusText = "Pending";

                    // Handle status priority: Executed trumps Cancelled
                    // (If both are true, the user completed the update before admin could cancel it)
                    if (entry.executed) {
                        icon = "$(check)";
                        statusText = "Executed";
                    } else if (isCancelled(entry)) {
                        icon = "$(close)";
                        statusText = "Cancelled";
                    }

                    const dateStr = new Date(entry.createdAt).toLocaleString();
                    const cancelledBy = getCancelledBy(entry);

                    // Build detail line with appropriate context
                    let detailLine = `Added by ${entry.addedBy} on ${dateStr}`;

                    // If both cancelled and executed, explain what happened
                    if (isCancelled(entry) && entry.executed && cancelledBy) {
                        detailLine += ` • Update completed before cancellation by ${cancelledBy}`;
                    } else if (isCancelled(entry) && cancelledBy) {
                        detailLine += ` • Cancelled by ${cancelledBy}`;
                    }

                    // Show clear button only if feature is enabled and entry is clearable
                    const canClear = isFeatureEnabled('ENABLE_ENTRY_CLEARING') && (entry.executed || isCancelled(entry));

                    items.push({
                        label: `${icon} ${entry.userToUpdate}`,
                        description: statusText,
                        detail: detailLine,
                        entry: entry,  // Store entry for later actions
                        buttons: canClear ? [{
                            iconPath: new vscode.ThemeIcon("trash"),
                            tooltip: "Clear Entry?"
                        }] : []
                    } as any);
                });
            };

            addGroup("Last 7 Days", last7Days);
            addGroup("Between 7 and 14 Days", last7To14Days);
            addGroup("Over 14 Days", over14Days);

            return items;
        };

        // Create QuickPick
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = "Remote Update History";
        // Show clear instructions only if feature is enabled
        quickPick.placeholder = isFeatureEnabled('ENABLE_ENTRY_CLEARING')
            ? "Click trash icon (🗑️) to clear completed/cancelled entries from history"
            : "Filter by status using the buttons above";
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        // Define buttons
        const btnAll = { iconPath: new vscode.ThemeIcon("list-unordered"), tooltip: "Show All" };
        const btnPending = { iconPath: new vscode.ThemeIcon("clock"), tooltip: "Show Pending" };
        const btnExecuted = { iconPath: new vscode.ThemeIcon("check"), tooltip: "Show Executed" };
        const btnCancelled = { iconPath: new vscode.ThemeIcon("close"), tooltip: "Show Cancelled" };

        quickPick.buttons = [btnAll, btnPending, btnExecuted, btnCancelled];

        // Update items based on filter
        const updateItems = (filterType: 'all' | 'pending' | 'executed' | 'cancelled') => {
            quickPick.items = generateItems(filterType);
            // Don't auto-select the first entry
            quickPick.activeItems = [];
        };

        // Initial state
        updateItems('all');

        // Handle filter button clicks
        quickPick.onDidTriggerButton(button => {
            if (button === btnAll) updateItems('all');
            else if (button === btnPending) updateItems('pending');
            else if (button === btnExecuted) updateItems('executed');
            else if (button === btnCancelled) updateItems('cancelled');
        });

        // Handle trash icon button clicks on individual items
        quickPick.onDidTriggerItemButton(async (e) => {
            const selectedItem = e.item as any;
            if (!selectedItem || !selectedItem.entry) {
                return;
            }

            const entry = selectedItem.entry;

            // Check permissions first
            const permCheck = await checkProjectAdminPermissions();
            if (!permCheck.hasPermission) {
                vscode.window.showErrorMessage(
                    `⛔ Permission Denied\n\nYou do not have permission to clear entries from history.\n\nRequires: Maintainer or Owner role\nReason: ${permCheck.error || "Insufficient permissions"}`
                );
                return;
            }

            const confirmed = await vscode.window.showWarningMessage(
                `⚠️ Clear "${entry.userToUpdate}" from history?\n\n` +
                `This will permanently delete this entry from all records and cannot be undone.`,
                { modal: true },
                "Yes, Clear Entry",
                "No, Keep It"
            );

            if (confirmed === "Yes, Clear Entry") {
                try {
                    // Update metadata to mark entry for clearing
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (!workspaceFolder) {
                        vscode.window.showErrorMessage("No workspace open");
                        return;
                    }

                    const updateResult = await MetadataManager.safeUpdateMetadata(
                        workspaceFolder.uri,
                        (metadata: any) => {
                            if (!metadata.meta?.initiateRemoteUpdatingFor) {
                                return metadata;
                            }

                            // Find and mark entry for clearing
                            const list = metadata.meta.initiateRemoteUpdatingFor;
                            for (let i = 0; i < list.length; i++) {
                                if (typeof list[i] === 'object' &&
                                    list[i].userToUpdate === entry.userToUpdate &&
                                    list[i].createdAt === entry.createdAt &&
                                    list[i].addedBy === entry.addedBy) {
                                    list[i].clearEntry = true;
                                    list[i].updatedAt = Date.now();
                                    break;
                                }
                            }

                            return metadata;
                        }
                    );

                    if (!updateResult.success) {
                        throw new Error(updateResult.error || "Failed to update metadata");
                    }

                    // Sync to push the clearing
                    const commitMessage = `Cleared update entry from history: ${entry.userToUpdate}`;
                    await vscode.commands.executeCommand(
                        "codex-editor-extension.triggerSync",
                        commitMessage
                    );

                    vscode.window.showInformationMessage(
                        `✅ Entry for "${entry.userToUpdate}" has been cleared from history`
                    );

                    quickPick.hide();
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to clear entry: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        });


        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();

    } catch (error) {
        console.error("Error viewing remote updating list:", error);
        vscode.window.showErrorMessage(
            `Failed to view updating list: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Register all remote updating commands
 */
export function registerRemoteUpdatingCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.initiateRemoteUpdating",
            initiateRemoteUpdating
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.viewRemoteUpdatingList",
            viewRemoteUpdatingList
        )
    );

    debug("Remote updating commands registered");
}

