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

        const conflicts = await authApi.syncChanges();
        if (conflicts?.hasConflicts) {
            vscode.window.showInformationMessage("Attempting to resolve conflicts manually...");
            const resolvedFiles = await resolveConflictFiles(
                conflicts?.conflicts || [],
                workspaceFolder
            );
            await authApi.completeMerge(resolvedFiles);
        }
    } catch (error) {
        console.error("Failed to commit and sync changes:", error);
        vscode.window.showErrorMessage(
            `Failed to commit and sync changes: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

// async function mergeAndResolveConflicts(oursBranch: string, theirsBranch: string) {
//     const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
//     if (!workspaceFolder) {
//         vscode.window.showErrorMessage("No workspace folder found");
//         return;
//     }

//     const authApi = getAuthApi();
//     if (!authApi) {
//         vscode.window.showErrorMessage("No auth API found");
//         return;
//     }

//     try {
//         await git
//             .merge({
//                 fs,
//                 dir: workspaceFolder,
//                 ours: oursBranch,
//                 theirs: theirsBranch,
//                 abortOnConflict: false,
//             })
//             .catch(async (error) => {
//                 if (error?.name === "MergeConflictError") {
//                     vscode.window.showInformationMessage(
//                         "Merge conflict detected, applying custom resolution..."
//                     );
//                     const resolvedFiles = await resolveConflictFiles(
//                         error.data as ConflictFile[],
//                         workspaceFolder
//                     );

//                     // Alert the FrontierAPI that we've resolved conflicts manually, so it can create the merge commit
//                     console.log("Resolved files:", resolvedFiles);
//                     await authApi.completeMerge(resolvedFiles);
//                 } else {
//                     throw error;
//                 }
//             });
//     } catch (error) {
//         vscode.window.showErrorMessage(`Merge failed: ${String(error)}`);
//     }
// }

// Re-export types and functions that should be available to consumers
export * from "./types";
export * from "./strategies";
export { resolveConflictFiles } from "./resolvers";
