/**
 * Merge Conflict Resolution Flow
 *
 * This module handles conflict resolution during pull operations, NOT during git merge states.
 * The flow is:
 * 1. syncChanges() detects conflicts during pull
 * 2. Frontier provides conflicting file contents directly (no MERGE_HEAD or merge markers)
 * 3. We apply resolution strategies to the raw content
 * 4. We write resolved content back to files
 * 5. We notify Frontier via completeMerge() that files are ready
 *
 * Note: We never enter an actual git merge state - this is pre-merge conflict resolution.
 */

import * as vscode from "vscode";
import git from "isomorphic-git";
import fs from "fs";
import { resolveConflictFiles } from "./resolvers";
import { getAuthApi } from "../../../extension";
import { ConflictFile } from "./types";

export async function stageAndCommitAllAndSync(commitMessage: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }

    const authApi = getAuthApi();
    if (!authApi) {
        vscode.window.showErrorMessage("No auth API found");
        return;
    }

    try {
        // First check if we have a valid git repo
        try {
            const remotes = await git.listRemotes({ fs, dir: workspaceFolder });
            if (remotes.length === 0) {
                console.log("No remotes found");
                return;
            }
        } catch (error) {
            vscode.window.showErrorMessage("No git repository found in this project");
            return;
        }

        // Get the status before syncing to check for unmerged paths
        const status = await git.statusMatrix({ fs, dir: workspaceFolder });
        const hasUnmergedPaths = status.some(([_filepath, _head, _workdir, stage]) => stage === 2);

        if (hasUnmergedPaths) {
            console.log("Detected unmerged paths, attempting to resolve...");
            // Try to resolve any existing conflicts first
<<<<<<< HEAD
            const conflicts = await authApi.syncChanges(); // FIXME: why does this assume every file is a completely new file / conflict??
=======
            const conflicts = await authApi.syncChanges();
>>>>>>> main
            if (conflicts?.hasConflicts) {
                console.log("Resolving conflicts...");
                const resolvedFiles = await resolveConflictFiles(
                    conflicts.conflicts || [],
                    workspaceFolder
                );
                if (resolvedFiles.length > 0) {
                    await authApi.completeMerge(resolvedFiles);
                }
            }
        }

        // Now try the sync
        const syncResult = await authApi.syncChanges();
        if (syncResult?.hasConflicts) {
<<<<<<< HEAD
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Resolving conflicts...",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ increment: 0 });
                    const resolvedFiles = await resolveConflictFiles(
                        syncResult.conflicts || [],
                        workspaceFolder
                    );
                    progress.report({ increment: 50 });
                    if (resolvedFiles.length > 0) {
                        await authApi.completeMerge(resolvedFiles);
                    }
                    progress.report({ increment: 100 });
                }
            );
=======
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Resolving conflicts...",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });
                const resolvedFiles = await resolveConflictFiles(
                    syncResult.conflicts || [],
                    workspaceFolder
                );
                progress.report({ increment: 50 });
                if (resolvedFiles.length > 0) {
                    await authApi.completeMerge(resolvedFiles);
                }
                progress.report({ increment: 100 });
            });
>>>>>>> main
        }
    } catch (error) {
        console.error("Failed to commit and sync changes:", error);
        vscode.window.showErrorMessage(
            `Failed to commit and sync changes: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

// Re-export types and functions that should be available to consumers
export * from "./types";
export * from "./strategies";
export { resolveConflictFiles } from "./resolvers";
