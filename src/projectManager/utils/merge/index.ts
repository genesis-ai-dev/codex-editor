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

export interface SyncResult {
    success: boolean;
    changedFiles: string[];
    conflictFiles: string[];
    newFiles: string[];
    deletedFiles: string[];
    totalChanges: number;
}

export async function stageAndCommitAllAndSync(
    commitMessage: string,
    showCompletionMessage: boolean = true
): Promise<SyncResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return {
            success: false,
            changedFiles: [],
            conflictFiles: [],
            newFiles: [],
            deletedFiles: [],
            totalChanges: 0
        };
    }

    // Save all files before syncing
    await vscode.workspace.saveAll();

    const authApi = getAuthApi();
    if (!authApi) {
        vscode.window.showErrorMessage("No auth API found");
        return {
            success: false,
            changedFiles: [],
            conflictFiles: [],
            newFiles: [],
            deletedFiles: [],
            totalChanges: 0
        };
    }

    const syncResult: SyncResult = {
        success: false,
        changedFiles: [],
        conflictFiles: [],
        newFiles: [],
        deletedFiles: [],
        totalChanges: 0
    };

    try {
        // First check if we have a valid git repo
        let remotes;
        try {
            remotes = await git.listRemotes({ fs, dir: workspaceFolder });
            if (remotes.length === 0) {
                console.log("No remotes found");
                return syncResult;
            }
        } catch (error) {
            vscode.window.showErrorMessage("No git repository found in this project");
            return syncResult;
        }

        // Instead of doing our own fetch, we'll rely on authApi.syncChanges()
        // which handles authentication properly
        const conflictsResponse = await authApi.syncChanges();

        if (conflictsResponse?.hasConflicts) {
            const conflicts = conflictsResponse.conflicts || [];
            console.log(`🔧 Processing ${conflicts.length} file conflicts from git sync...`);

            // Track which files are being modified
            for (const conflict of conflicts) {
                syncResult.conflictFiles.push(conflict.filepath);

                if (conflict.isNew) {
                    syncResult.newFiles.push(conflict.filepath);
                } else if (conflict.isDeleted) {
                    syncResult.deletedFiles.push(conflict.filepath);
                } else {
                    syncResult.changedFiles.push(conflict.filepath);
                }
            }

            const resolvedFiles = await resolveConflictFiles(conflicts, workspaceFolder);
            if (resolvedFiles.length > 0) {
                await authApi.completeMerge(resolvedFiles);
                console.log(`✅ Resolved ${resolvedFiles.length} file conflicts`);
            }
        }

        syncResult.totalChanges = syncResult.changedFiles.length + syncResult.newFiles.length + syncResult.deletedFiles.length;
        syncResult.success = true;

        console.log(`📊 Git sync completed: ${syncResult.totalChanges} total changes (${syncResult.changedFiles.length} modified, ${syncResult.newFiles.length} new, ${syncResult.deletedFiles.length} deleted)`);

        // Only show completion message if requested (not during startup with splash screen)
        if (showCompletionMessage) {
            vscode.window.showInformationMessage("Project is fully synced.");
        }

        return syncResult;
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
