import * as vscode from "vscode";

/**
 * Workspace-level (project) migration completion flags.
 *
 * These are stored in the project's `.vscode/settings.json` under the
 * `codex-project-manager` namespace (i.e. `codex-project-manager.<key>`).
 *
 * NOTE: Keep this list in sync with the `migrationKey = "..."` strings in
 * `src/projectManager/utils/migrationUtils.ts`.
 */
export const CODEX_PROJECT_MIGRATION_FLAG_KEYS = [
    "timestampsDataMigrationCompleted",
    "cellTypePromotionMigrationCompleted",
    "chatSystemMessageToMetadataMigrationCompleted",
    "editHistoryFormatMigrationCompleted",
    "lineNumbersMigrationCompleted",
    "importerTypeMigrationCompleted",
    "documentContextHoistMigrationCompleted",
    "milestoneCellsMigrationCompleted",
    "paratextReorderMigrationCompleted",
    "globalReferencesMigrationCompleted",
    "cellIdsToUuidMigrationCompleted",
    "tempFilesRecoveryAndDuplicateMergeCompleted",
    "editIdsMigrationCompleted",
] as const;

export type CodexProjectMigrationFlagKey = (typeof CODEX_PROJECT_MIGRATION_FLAG_KEYS)[number];

type MigrationCompletionStatus = {
    complete: boolean;
    incompleteKeys: CodexProjectMigrationFlagKey[];
};

function safeGetMigrationFlag(
    config: vscode.WorkspaceConfiguration,
    key: CodexProjectMigrationFlagKey,
    context?: vscode.ExtensionContext
): boolean {
    try {
        return config.get<boolean>(key, false);
    } catch {
        // If settings aren't registered yet (or config access throws), fall back to workspaceState.
        // This keeps behavior aligned with how migrations themselves record completion.
        return context?.workspaceState.get<boolean>(key) ?? false;
    }
}

/**
 * Returns whether all known project migrations have completed.
 *
 * "Completed" is defined by `codex-project-manager.<migrationKey> === true` in workspace settings,
 * with a fallback to `context.workspaceState` for edge cases.
 */
export function areCodexProjectMigrationsComplete(
    context?: vscode.ExtensionContext
): MigrationCompletionStatus {
    const config = vscode.workspace.getConfiguration("codex-project-manager");

    const incompleteKeys = CODEX_PROJECT_MIGRATION_FLAG_KEYS.filter((key) => {
        const isComplete = safeGetMigrationFlag(config, key, context);
        return !isComplete;
    });

    return {
        complete: incompleteKeys.length === 0,
        incompleteKeys,
    };
}

