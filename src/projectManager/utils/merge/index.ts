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
import * as dugiteGit from "../../../utils/dugiteGit";
import { resolveConflictFiles } from "./resolvers";
import { getAuthApi } from "../../../extension";
import { ConflictFile } from "./types";
import { getFrontierVersionStatus } from "../../utils/versionChecks";
import { migration_recoverTempFilesAndMergeDuplicates } from "../migrationUtils";

const DEBUG_MODE = false;
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Merge]", ...args);
    }
}

export interface SyncResult {
    success: boolean;
    changedFiles: string[];
    conflictFiles: string[];
    newFiles: string[];
    deletedFiles: string[];
    totalChanges: number;
    offline?: boolean;
    uploadedLfsFiles?: string[]; // List of LFS files that were uploaded during sync
}

export async function stageAndCommitAllAndSync(
    commitMessage: string,
    showCompletionMessage: boolean = true,
    retryCount: number = 0
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
    // Enforce Frontier version requirement for sync operations (Git LFS safety gate)
    // Note: Check before constructing syncResult to avoid using before declaration
    const versionStatus = await getFrontierVersionStatus();
    if (!versionStatus.ok) {
        debug("Frontier version requirement not met. Blocking sync operation.");
        const details = versionStatus.installedVersion
            ? `Frontier Authentication ${versionStatus.installedVersion} is installed, but version ${versionStatus.requiredVersion} or newer is needed to sync. Please update the extension.`
            : `Frontier Authentication is not installed. Version ${versionStatus.requiredVersion} or newer is required to sync.`;
        await vscode.window.showWarningMessage(details, { modal: true });
        return {
            success: false,
            changedFiles: [],
            conflictFiles: [],
            newFiles: [],
            deletedFiles: [],
            totalChanges: 0,
            offline: false
        };
    }


    const authApi = getAuthApi();
    if (!authApi) {
        vscode.window.showErrorMessage("Sync is not available. Please make sure you're signed in and try again.");
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
        totalChanges: 0,
        offline: false
    };

    try {
        // First check if we have a valid git repo
        let remotes;
        try {
            remotes = await dugiteGit.listRemotes(workspaceFolder);
            if (remotes.length === 0) {
                return syncResult;
            }
        } catch (error) {
            vscode.window.showErrorMessage("This project is not set up for syncing. Please re-open the project and try again.");
            return syncResult;
        }

        const conflictsResponse = await authApi.syncChanges({ commitMessage });
        if (!conflictsResponse) {
            throw new Error("syncChanges returned an empty response — sync may not have completed");
        }
        if (conflictsResponse.blocked) {
            debug("Sync was blocked by Frontier (e.g., extension version requirements)");
            return syncResult;
        }
        if (conflictsResponse.offline) {
            syncResult.offline = true;
            syncResult.uploadedLfsFiles = conflictsResponse.uploadedLfsFiles;
            return syncResult;
        }

        // Optional diagnostics from Frontier to help detect “remote changes not applied” scenarios.
        // This is intentionally non-destructive: we only warn/log so issues can be triaged.
        try {
            const conflictsArr = Array.isArray(conflictsResponse?.conflicts)
                ? (conflictsResponse.conflicts as Array<{ filepath?: string; }>)
                : [];
            const conflictPaths = new Set(
                conflictsArr.map((c) => c?.filepath).filter((p): p is string => typeof p === "string")
            );

            const remoteChanged = conflictsResponse?.remoteChangedFilePaths;
            const allChanged = conflictsResponse?.allChangedFilePaths;
            const changedList: unknown =
                Array.isArray(remoteChanged) ? remoteChanged : Array.isArray(allChanged) ? allChanged : [];

            if (Array.isArray(changedList) && changedList.length > 0) {
                const changedPaths = changedList.filter(
                    (p): p is string => typeof p === "string" && p.length > 0
                );
                const remoteCodex = changedPaths.filter(
                    (p) => p.startsWith("files/target/") && p.endsWith(".codex")
                );

                const missingFromConflicts = remoteCodex.filter((p) => !conflictPaths.has(p));
                if (missingFromConflicts.length > 0) {
                    console.warn(
                        "[Sync] Frontier reported remote `.codex` changes not present in conflict list:",
                        missingFromConflicts
                    );
                    // Avoid modal spam; one-time lightweight warning.
                    vscode.window.showWarningMessage(
                        `Some changes from other team members may not have been included. Try syncing again if something looks missing.`
                    );
                }
            }
        } catch (e) {
            // Never fail sync due to diagnostics
        }

        // Capture uploaded LFS files from the sync operation
        if (conflictsResponse?.uploadedLfsFiles) {
            syncResult.uploadedLfsFiles = conflictsResponse.uploadedLfsFiles;
        }

        if (conflictsResponse?.hasConflicts) {
            const conflicts = conflictsResponse.conflicts || [];
            debug(`🔧 Processing ${conflicts.length} file conflicts from git sync...`);

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

            const { resolved: resolvedFiles, failed: failedConflicts } = await resolveConflictFiles(conflicts, workspaceFolder);

            if (failedConflicts.length > 0) {
                const failedList = failedConflicts
                    .map((f) => `  - ${f.filepath}: ${f.error}`)
                    .join("\n");
                console.error(
                    `[Merge] ${failedConflicts.length} conflict(s) could not be resolved:\n${failedList}`
                );
                vscode.window.showErrorMessage(
                    `${failedConflicts.length} file(s) had changes that couldn't be combined automatically. ` +
                    `Your data is safe — please try syncing again or contact support.`
                );
                throw new Error(
                    `Merge aborted: ${failedConflicts.length} conflict(s) could not be resolved. ` +
                    `Resolved ${resolvedFiles.length} of ${conflicts.length} total. ` +
                    `Failed:\n${failedList}`
                );
            }

            if (resolvedFiles.length > 0) {
                try {
                    await authApi.completeMerge(resolvedFiles, undefined);
                    debug(`✅ Resolved ${resolvedFiles.length} file conflicts`);
                } catch (completeMergeError) {
                    const errorMessage = completeMergeError instanceof Error ? completeMergeError.message : String(completeMergeError);
                    debug("completeMerge error:", errorMessage);

                    // Only retry on transient errors (push rejected because remote
                    // advanced, network hiccups, etc.). Permanent failures like auth,
                    // validation, or staging errors should surface immediately.
                    const isTransient =
                        errorMessage.includes("non-fast-forward") ||
                        errorMessage.includes("failed to push") ||
                        errorMessage.includes("Failed to push") ||
                        errorMessage.includes("timeout") ||
                        errorMessage.includes("ETIMEDOUT") ||
                        errorMessage.includes("ECONNRESET") ||
                        errorMessage.includes("ECONNREFUSED") ||
                        errorMessage.includes("network");

                    if (isTransient && retryCount < 3) {
                        debug(`⚠️ Transient completeMerge failure, retrying... (attempt ${retryCount + 1}/3)`);

                        const backoffMs = 5 * Math.pow(2, retryCount) * 1000;
                        debug(`⏳ Waiting ${backoffMs / 1000} seconds before retrying...`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));

                        return stageAndCommitAllAndSync(commitMessage, showCompletionMessage, retryCount + 1);
                    }

                    if (retryCount >= 3) {
                        vscode.window.showErrorMessage(
                            `Sync couldn't complete after multiple attempts. Please check your internet connection and try again.`
                        );
                    }
                    throw completeMergeError;
                }
            }
        }

        syncResult.totalChanges = syncResult.changedFiles.length + syncResult.newFiles.length + syncResult.deletedFiles.length;
        syncResult.success = true;

        debug(`📊 Git sync completed: ${syncResult.totalChanges} total changes (${syncResult.changedFiles.length} modified, ${syncResult.newFiles.length} new, ${syncResult.deletedFiles.length} deleted)`);

        // Run temp files recovery and duplicate merge cleanup after successful commit
        // This only runs once (checked internally by the migration function)
        try {
            await migration_recoverTempFilesAndMergeDuplicates(undefined);
        } catch (cleanupError) {
            // Don't fail the sync if cleanup fails - just log it
            console.warn("[Sync] Temp files cleanup failed (non-critical):", cleanupError);
        }

        // Only show completion message if requested (not during startup with splash screen)
        if (showCompletionMessage) {
            vscode.window.showInformationMessage("Your project is up to date!");
        }

        return syncResult;
    } catch (error) {
        console.error("Failed to commit and sync changes:", error);
        // Fire-and-forget: showErrorMessage with an action only resolves when
        // the user dismisses/clicks the toast, and we must not block the sync
        // promise on that — background sync (syncManager) would stall behind
        // an ignored notification.
        void showSyncErrorWithCopy(error, { commitMessage });
        throw error;
    }
}

/**
 * Show the sync-failure toast with a "Copy Error Details" action. The action
 * writes a plaintext diagnostic report to the clipboard so users can paste it
 * directly to support — most users have no useful access to the dev console.
 *
 * The report extracts structured fields from a `GitLabApiError` thrown by
 * frontier-authentication (status, URL, response body, etc.) when present,
 * and falls back to the generic Error message + stack otherwise.
 */
async function showSyncErrorWithCopy(
    error: unknown,
    context: { commitMessage?: string },
): Promise<void> {
    const COPY_ACTION = "Copy Error Details";
    const choice = await vscode.window.showErrorMessage(
        "Sync failed. Please try again or contact support if the problem persists.",
        COPY_ACTION,
    );
    if (choice !== COPY_ACTION) return;
    await vscode.env.clipboard.writeText(formatSyncErrorReport(error, context));
    vscode.window.showInformationMessage("Error details copied to clipboard.");
}

function formatSyncErrorReport(
    error: unknown,
    context: { commitMessage?: string },
): string {
    const lines: string[] = [
        "Codex Sync Error Report",
        `Time: ${new Date().toISOString()}`,
    ];
    if (context.commitMessage) lines.push(`Commit message: ${context.commitMessage}`);
    lines.push("");

    // Duck-type GitLabApiError thrown by frontier-authentication. We avoid an
    // import because codex-editor doesn't depend on frontier-authentication;
    // the error crosses the executeCommand boundary as a plain object whose
    // `name` and structured fields are preserved.
    if (
        error
        && typeof error === "object"
        && (error as { name?: unknown }).name === "GitLabApiError"
    ) {
        const e = error as {
            operation?: string;
            method?: string;
            url?: string;
            status?: number;
            statusText?: string;
            body?: string;
            timestamp?: string;
        };
        lines.push("GitLab API Error");
        if (e.timestamp) lines.push(`API call time: ${e.timestamp}`);
        lines.push(`Operation: ${e.operation ?? "(unknown)"}`);
        lines.push(`Method:    ${e.method ?? "(unknown)"}`);
        lines.push(`URL:       ${e.url ?? "(unknown)"}`);
        lines.push(`Status:    ${e.status ?? "?"} ${e.statusText ?? ""}`);
        lines.push("");
        lines.push("Response body:");
        lines.push(e.body || "(empty)");
        return lines.join("\n");
    }

    if (error instanceof Error) {
        lines.push(`Error: ${error.message}`);
        if (error.stack) {
            lines.push("");
            lines.push("Stack trace:");
            lines.push(error.stack);
        }
        return lines.join("\n");
    }

    lines.push(`Error: ${String(error)}`);
    return lines.join("\n");
}

// Re-export types and functions that should be available to consumers
export * from "./types";
export * from "./strategies";
export { resolveConflictFiles } from "./resolvers";
