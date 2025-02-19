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
import http from "isomorphic-git/http/web";
import { resolveConflictFiles } from "./resolvers";
import { getAuthApi } from "../../../extension";
import { ConflictFile } from "./types";

export async function stageAndCommitAllAndSync(commitMessage: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }

    // Save all files before syncing
    await vscode.workspace.saveAll();

    const authApi = getAuthApi();
    if (!authApi) {
        vscode.window.showErrorMessage("No auth API found");
        return;
    }

    try {
        // First check if we have a valid git repo
        let remotes;
        try {
            remotes = await git.listRemotes({ fs, dir: workspaceFolder });
            if (remotes.length === 0) {
                console.log("No remotes found");
                return;
            }
        } catch (error) {
            vscode.window.showErrorMessage("No git repository found in this project");
            return;
        }

        // Fetch latest changes from remote
        await git.fetch({
            fs,
            http,
            dir: workspaceFolder,
            remote: remotes[0].remote,
        });

        // Check for remote changes by comparing HEAD with remote
        const localRef = await git.resolveRef({ fs, dir: workspaceFolder, ref: "HEAD" });
        const remoteRef = await git.resolveRef({
            fs,
            dir: workspaceFolder,
            ref: `refs/remotes/${remotes[0].remote}/HEAD`,
        });
        const hasRemoteChanges = localRef !== remoteRef;

        // Get the status before syncing to check for unmerged paths
        const status = await git.statusMatrix({ fs, dir: workspaceFolder });
        const hasUncommittedChanges = status.some(([_filepath, head, workdir, stage]) => {
            const isModifiedNotStaged = workdir !== stage;
            const isStagedDifferentFromHead = stage !== head;
            const isUnmerged = stage === 2;
            return isModifiedNotStaged || isStagedDifferentFromHead || isUnmerged;
        });

        // Sync if there are either local or remote changes
        if (hasUncommittedChanges || hasRemoteChanges) {
            const conflicts = await authApi.syncChanges();
            if (conflicts?.hasConflicts) {
                const resolvedFiles = await resolveConflictFiles(
                    conflicts.conflicts || [],
                    workspaceFolder
                );
                if (resolvedFiles.length > 0) {
                    await authApi.completeMerge(resolvedFiles);
                }
            }
            vscode.window.showInformationMessage("Project is fully synced.");
        } else {
            vscode.window.showInformationMessage("Project is already up to date.");
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
