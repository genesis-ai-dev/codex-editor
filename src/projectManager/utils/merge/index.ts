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

        // Instead of doing our own fetch, we'll rely on authApi.syncChanges()
        // which handles authentication properly
        const conflictsResponse = await authApi.syncChanges();

        if (conflictsResponse?.hasConflicts) {
            const resolvedFiles = await resolveConflictFiles(
                conflictsResponse.conflicts || [],
                workspaceFolder
            );
            if (resolvedFiles.length > 0) {
                await authApi.completeMerge(resolvedFiles);
            }
        }
        vscode.window.showInformationMessage("Project is fully synced.");
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
