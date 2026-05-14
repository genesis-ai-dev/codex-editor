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
import {
    TransientSyncError,
    isRetriableSyncError,
    isUserSurfacedError,
    markUserSurfaced,
} from "./transientSyncError";

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

        // Diagnostic: every remote-changed file MUST appear in the conflict list.
        // If it doesn't, something dropped silently between Frontier's existence
        // classification and the conflict list it produced — proceeding would
        // create a merge commit missing those files. Throw a TransientSyncError
        // so the retry layer below can re-run sync (which refetches via
        // fetchOrigin) before bothering the user.
        //
        // Unlike the old diagnostic, this checks ALL paths, not just `.codex`,
        // because the gan-ji-an regression involved .webm pointer files too.
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
            const missingFromConflicts = changedPaths.filter((p) => !conflictPaths.has(p));
            if (missingFromConflicts.length > 0) {
                const sample = missingFromConflicts.slice(0, 5).join(", ");
                const extra = missingFromConflicts.length > 5
                    ? ` (+${missingFromConflicts.length - 5} more)`
                    : "";
                throw new TransientSyncError(
                    `${missingFromConflicts.length} remote-changed file(s) were not in the conflict list. Missing: ${sample}${extra}`,
                    missingFromConflicts
                );
            }
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
                // If any failure originated from a BLOB_READ_FAILED: sentinel (e.g.
                // empty-content isNew in Fix 4), let the outer retry handle it
                // silently before surfacing UI. Otherwise it's a non-retriable
                // merge issue and falls through to the existing user-facing path.
                const anyTransient = failedConflicts.some((f) =>
                    typeof f.error === "string" && f.error.startsWith("BLOB_READ_FAILED:")
                );
                if (anyTransient) {
                    throw new TransientSyncError(
                        `Merge aborted: ${failedConflicts.length} conflict(s) could not be resolved due to incomplete fetch. ` +
                        `Resolved ${resolvedFiles.length} of ${conflicts.length} total.`,
                        failedConflicts.map((f) => `${f.filepath}: ${f.error}`)
                    );
                }
                // Non-transient: show the specific "data is safe" dialog and tag the
                // error so the outer catch knows not to surface a generic dialog on
                // top of this one.
                vscode.window.showErrorMessage(
                    `${failedConflicts.length} file(s) had changes that couldn't be combined automatically. ` +
                    `Your data is safe — please try syncing again or contact support.`
                );
                throw markUserSurfaced(new Error(
                    `Merge aborted: ${failedConflicts.length} conflict(s) could not be resolved. ` +
                    `Resolved ${resolvedFiles.length} of ${conflicts.length} total. ` +
                    `Failed:\n${failedList}`
                ));
            }

            if (resolvedFiles.length > 0) {
                try {
                    await authApi.completeMerge(resolvedFiles, undefined);
                    debug(`✅ Resolved ${resolvedFiles.length} file conflicts`);
                } catch (completeMergeError) {
                    const errorMessage = completeMergeError instanceof Error ? completeMergeError.message : String(completeMergeError);
                    debug("completeMerge error:", errorMessage);

                    // Use the shared classifier so completeMerge retries stay aligned
                    // with the outer transient-error policy (single source of truth).
                    if (isRetriableSyncError(completeMergeError) && retryCount < 3) {
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
        // Self-healing outer retry: re-run the entire sync (which forces a fresh
        // authApi.syncChanges → fetchOrigin) if this looks like a transient
        // condition. Caps at 2 retries (1.5s, 3s) so we never block the user
        // forever; on final failure we still throw (so SyncManager updates its
        // status) but we also surface a non-modal dialog with a Retry button
        // for foreground syncs. Background syncs (showCompletionMessage=false)
        // stay silent so SyncManager's scheduler can reschedule.
        if (isRetriableSyncError(error) && retryCount < 2) {
            const backoffMs = 1500 * Math.pow(2, retryCount); // 1.5s then 3s
            debug(
                `[Sync] Transient outer failure (attempt ${retryCount + 1}/2), retrying after ${backoffMs}ms: ${(error as Error).message}`
            );
            await new Promise((r) => setTimeout(r, backoffMs));
            return stageAndCommitAllAndSync(commitMessage, showCompletionMessage, retryCount + 1);
        }

        console.error("Failed to commit and sync changes:", error);

        // Suppress the outer dialog if an inner step already showed a more
        // specific dialog to the user (e.g. failedConflicts non-transient path).
        // Foreground syncs see the toast; background syncs (showCompletionMessage=false)
        // stay silent so SyncManager's scheduler can reschedule.
        //
        // Fire-and-forget: showErrorMessage with actions only resolves when the
        // user interacts, and we must not block the sync promise on that —
        // background sync would stall behind an ignored notification.
        if (showCompletionMessage && !isUserSurfacedError(error)) {
            void showSyncErrorWithCopy(error, {
                commitMessage,
                wasTransient: isRetriableSyncError(error),
                onRetry: async () => {
                    // Use SyncManager directly so the retry flows through the
                    // same scheduling/UI status path as a manual user-triggered
                    // sync.
                    const { SyncManager } = await import("../../syncManager");
                    await SyncManager.getInstance().executeSync(
                        "Retrying sync",
                        true,
                        undefined,
                        true
                    );
                },
            });
        }

        throw error;
    }
}

/**
 * Show the sync-failure toast.
 *
 * Actions on the toast:
 *  - "Retry sync now" (only when `onRetry` is provided): re-runs the sync via
 *    `SyncManager.executeSync`. Surfaced for transient failures so users are
 *    never permanently blocked after the auto-retry layer gives up.
 *  - "Copy Error Details": writes a plaintext diagnostic report to the
 *    clipboard so users can paste it directly to support — most users have no
 *    useful access to the dev console. The report extracts structured fields
 *    from a `GitLabApiError` thrown by frontier-authentication (status, URL,
 *    response body, etc.) when present, and falls back to the generic Error
 *    message + stack otherwise.
 *
 * The message text is adjusted based on `wasTransient` so users get a softer,
 * more reassuring message ("Your changes are safe...") when the failure looks
 * like a brief network hiccup, vs the generic "Sync failed" message for
 * unknown failures.
 */
async function showSyncErrorWithCopy(
    error: unknown,
    context: {
        commitMessage?: string;
        wasTransient?: boolean;
        onRetry?: () => Promise<void> | void;
    },
): Promise<void> {
    const RETRY_ACTION = "Retry sync now";
    const COPY_ACTION = "Copy Error Details";

    const message = context.wasTransient
        ? "Some files from other team members couldn't be downloaded just now (likely a brief network issue). " +
        "Your changes are safe. Try again — if it keeps happening, please contact support."
        : "Sync failed. Please try again or contact support if the problem persists.";

    const actions = context.onRetry
        ? [RETRY_ACTION, COPY_ACTION]
        : [COPY_ACTION];

    const choice = await vscode.window.showErrorMessage(message, ...actions);

    if (choice === RETRY_ACTION && context.onRetry) {
        try {
            await context.onRetry();
        } catch (retryError) {
            console.error("Manual retry from sync error dialog failed:", retryError);
        }
        return;
    }

    if (choice === COPY_ACTION) {
        await vscode.env.clipboard.writeText(formatSyncErrorReport(error, context));
        vscode.window.showInformationMessage("Error details copied to clipboard.");
    }
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
