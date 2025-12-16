import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "@/serializer";
import { vrefData } from "@/utils/verseRefUtils/verseData";
import { EditMapUtils } from "@/utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
import type { ValidationEntry } from "../../../types";
import { getAuthApi } from "../../extension";
import { extractParentCellIdFromParatext } from "../../providers/codexCellEditorProvider/utils/cellUtils";

// FIXME: move notebook format migration here

const DEBUG_MODE = false;
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Extension]", ...args);
    }
}

/**
 * Migration: Move timestamps (startTime/endTime) and related subtitle fields
 * from metadata top-level to metadata.data to match current schema.
 * - Idempotent
 * - Preserves existing metadata.data.* if already present
 */
export const migration_moveTimestampsToMetadataData = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "timestampsDataMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            debug("Timestamps data migration already completed, skipping");
            return;
        }

        debug("Running timestamps data migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping timestamps migration");
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Migrating subtitle timestamps",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: (100 / allFiles.length)
                    });

                    try {
                        const wasMigrated = await migrateTimestampsForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Timestamps data migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Subtitle timestamps migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running timestamps data migration:", error);
    }
};

/**
 * Migration: Ensure cell type is stored at metadata.type, not under metadata.data.type.
 * - Promotes metadata.data.type to metadata.type when metadata.type is missing.
 * - Removes metadata.data.type after promotion to avoid duplication.
 * - Idempotent.
 */
export const migration_promoteCellTypeToTopLevel = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const migrationKey = "cellTypePromotionMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Cell type promotion migration already completed, skipping");
            return;
        }

        console.log("Running cell type promotion migration...");

        const workspaceFolder = workspaceFolders[0];
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );
        const allFiles = [...codexFiles, ...sourceFiles];
        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping cell type promotion migration");
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Normalizing cell type metadata",
                cancellable: false,
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: 100 / allFiles.length,
                    });

                    try {
                        const wasMigrated = await promoteCellTypeForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Cell type promotion migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Cell type normalization complete: ${migratedFiles} files updated`
            );
        }
    } catch (error) {
        console.error("Error running cell type promotion migration:", error);
    }
};

export const migration_changeDraftFolderToFilesFolder = async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const rootUri = workspaceFolders[0].uri;
        const metadataUri = vscode.Uri.joinPath(rootUri, "metadata.json");
        const draftsUri = vscode.Uri.joinPath(rootUri, "drafts");
        const filesUri = vscode.Uri.joinPath(rootUri, "files");

        try {
            // Check if the 'metadata.json' file exists
            await vscode.workspace.fs.stat(metadataUri);

            // Check if the 'drafts' folder exists before trying to read it
            try {
                await vscode.workspace.fs.stat(draftsUri);

                // If we get here, the drafts folder exists, so read it
                const draftsFolder = await vscode.workspace.fs.readDirectory(draftsUri);

                // If the read succeeds, the folder exists, and we can attempt to rename it
                if (draftsFolder) {
                    await vscode.workspace.fs.rename(draftsUri, filesUri, {
                        overwrite: false,
                    });
                    console.log('Renamed "drafts" folder to "files".');
                }
            } catch (error) {
                // If the 'drafts' folder doesn't exist, we quietly pass
                console.log('The "drafts" folder does not exist. No action needed.');
            }
        } catch (error) {
            console.log('The "metadata.json" file does not exist. No action needed.');
        }
    }
};

export const migration_chatSystemMessageToMetadata = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            console.log('[Migration] No workspace folder found, skipping chatSystemMessage migration');
            return;
        }

        // Check if migration has already been run
        const migrationKey = "chatSystemMessageToMetadataMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            debug('[Migration] chatSystemMessageToMetadata migration already completed, skipping');
            return;
        }

        // Check if already migrated by checking metadata.json directly (without triggering generation)
        const { MetadataManager } = await import("../../utils/metadataManager");
        const metadataResult = await MetadataManager.safeReadMetadata(workspaceFolder);
        const existingChatSystemMessage = metadataResult.success && metadataResult.metadata
            ? (metadataResult.metadata as any).chatSystemMessage as string | undefined
            : undefined;

        // If metadata.json already has a chatSystemMessage, don't overwrite it
        if (existingChatSystemMessage && existingChatSystemMessage.trim() !== "") {
            debug('[Migration] chatSystemMessage already exists in metadata.json, marking migration as completed');
            // Mark migration as completed since value already exists
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                // If configuration key is not registered, fall back to workspaceState
                await context?.workspaceState.update(migrationKey, true);
            }
            return;
        }

        // Try to read from settings.json
        const codexConfig = vscode.workspace.getConfiguration("codex-editor-extension");
        const oldConfig = vscode.workspace.getConfiguration("translators-copilot");

        // Check both namespaces
        const newSettingInspection = codexConfig.inspect("chatSystemMessage");
        const oldSettingInspection = oldConfig.inspect("chatSystemMessage");

        const newValue = (newSettingInspection?.workspaceValue ||
            newSettingInspection?.workspaceFolderValue ||
            newSettingInspection?.globalValue) as string | undefined;

        const oldValue = (oldSettingInspection?.workspaceValue ||
            oldSettingInspection?.workspaceFolderValue ||
            oldSettingInspection?.globalValue) as string | undefined;

        // Prefer new namespace, fallback to old
        const valueToMigrate: string | undefined = newValue || oldValue;

        if (!valueToMigrate || valueToMigrate.trim() === "") {
            debug('[Migration] No chatSystemMessage found in settings.json to migrate');

            // Try to generate defaultValue using source and target languages from metadata.json
            try {
                const metadataUri = vscode.Uri.joinPath(workspaceFolder, "metadata.json");
                const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
                const metadata = JSON.parse(metadataContent.toString());

                const sourceLanguage = metadata.languages?.find(
                    (l: any) => l.projectStatus === "source"
                );
                const targetLanguage = metadata.languages?.find(
                    (l: any) => l.projectStatus === "target"
                );

                if (sourceLanguage?.refName && targetLanguage?.refName) {
                    debug('[Migration] Source and target languages found, generating chatSystemMessage...');

                    const { generateChatSystemMessage } = await import("../../copilotSettings/copilotSettings");
                    const generatedValue = await generateChatSystemMessage(
                        sourceLanguage,
                        targetLanguage,
                        workspaceFolder
                    );

                    if (generatedValue) {
                        const result = await MetadataManager.setChatSystemMessage(generatedValue, workspaceFolder);
                        if (result.success) {
                            console.log('[Migration] Successfully generated and saved chatSystemMessage to metadata.json');
                        } else {
                            console.warn('[Migration] Generated chatSystemMessage but failed to save:', result.error);
                        }
                    } else {
                        debug('[Migration] Failed to generate chatSystemMessage (likely no API key configured)');
                    }
                } else {
                    debug('[Migration] Source or target language not found in metadata.json, skipping generation');
                }
            } catch (error) {
                // Don't fail migration if generation fails - just log and continue
                debug('[Migration] Error attempting to generate chatSystemMessage:', error);
            }

            // Mark migration as completed even if generation failed (to prevent retrying on every reload)
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                // If configuration key is not registered, fall back to workspaceState
                await context?.workspaceState.update(migrationKey, true);
            }

            return;
        }

        // Re-check that metadata.json doesn't already have a chatSystemMessage before overwriting
        // (in case it was generated between the first check and now)
        const recheckResult = await MetadataManager.safeReadMetadata(workspaceFolder);
        const recheckChatSystemMessage = recheckResult.success && recheckResult.metadata
            ? (recheckResult.metadata as any).chatSystemMessage as string | undefined
            : undefined;

        if (recheckChatSystemMessage && recheckChatSystemMessage.trim() !== "") {
            console.log('[Migration] chatSystemMessage already exists in metadata.json, skipping migration from settings.json');
            // Mark migration as completed since value already exists
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                // If configuration key is not registered, fall back to workspaceState
                await context?.workspaceState.update(migrationKey, true);
            }
            return;
        }

        debug('[Migration] Migrating chatSystemMessage from settings.json to metadata.json...');

        // Write to metadata.json
        const result = await MetadataManager.setChatSystemMessage(valueToMigrate as string, workspaceFolder);

        if (!result.success) {
            console.error('[Migration] Failed to migrate chatSystemMessage to metadata.json:', result.error);
            return;
        }

        console.log('[Migration] Successfully migrated chatSystemMessage to metadata.json');

        // Remove from settings.json (both namespaces)
        if (newValue) {
            const targetScope = newSettingInspection?.workspaceValue ? vscode.ConfigurationTarget.Workspace :
                newSettingInspection?.workspaceFolderValue ? vscode.ConfigurationTarget.WorkspaceFolder :
                    vscode.ConfigurationTarget.Global;

            try {
                await codexConfig.update("chatSystemMessage", undefined, targetScope);
                console.log('[Migration] Removed chatSystemMessage from codex-editor-extension namespace');
            } catch (error) {
                console.warn('[Migration] Failed to remove chatSystemMessage from codex-editor-extension namespace:', error);
            }
        }

        if (oldValue) {
            const targetScope = oldSettingInspection?.workspaceValue ? vscode.ConfigurationTarget.Workspace :
                oldSettingInspection?.workspaceFolderValue ? vscode.ConfigurationTarget.WorkspaceFolder :
                    vscode.ConfigurationTarget.Global;

            try {
                await oldConfig.update("chatSystemMessage", undefined, targetScope);
                console.log('[Migration] Removed chatSystemMessage from translators-copilot namespace');
            } catch (error) {
                console.warn('[Migration] Failed to remove chatSystemMessage from translators-copilot namespace:', error);
            }
        }

        console.log('[Migration] chatSystemMessage migration completed successfully');

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }
    } catch (error) {
        console.error('[Migration] Error during chatSystemMessage to metadata.json migration:', error);
    }
};

export const migration_chatSystemMessageSetting = async () => {
    try {
        const codexConfig = vscode.workspace.getConfiguration("codex-editor-extension");
        const oldConfig = vscode.workspace.getConfiguration("translators-copilot");

        // Check if the new setting already has a value (excluding default)
        const newSettingInspection = codexConfig.inspect("chatSystemMessage");
        const hasNewValue = newSettingInspection?.workspaceValue !== undefined ||
            newSettingInspection?.workspaceFolderValue !== undefined ||
            newSettingInspection?.globalValue !== undefined;

        // Check if the old setting has a value (excluding default)
        const oldSettingInspection = oldConfig.inspect("chatSystemMessage");
        const oldValue = oldSettingInspection?.workspaceValue ||
            oldSettingInspection?.workspaceFolderValue ||
            oldSettingInspection?.globalValue;

        // CASE 1: Both keys exist - delete the old one (but warn if values differ)
        if (hasNewValue && oldValue) {
            // Get the new value to compare
            const newValue = newSettingInspection?.workspaceValue ||
                newSettingInspection?.workspaceFolderValue ||
                newSettingInspection?.globalValue;

            // Warn if values are different
            if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
                console.warn('⚠️ Both chatSystemMessage keys exist with DIFFERENT values!');
                console.warn(`  Old (translators-copilot): ${JSON.stringify(oldValue)}`);
                console.warn(`  New (codex-editor-extension): ${JSON.stringify(newValue)}`);
                console.warn('  → Keeping NEW value and deleting old key...');
            } else {
                console.log('Both chatSystemMessage keys exist with same value. Removing deprecated key...');
            }

            const targetScope = oldSettingInspection?.workspaceValue ? vscode.ConfigurationTarget.Workspace :
                oldSettingInspection?.workspaceFolderValue ? vscode.ConfigurationTarget.WorkspaceFolder :
                    vscode.ConfigurationTarget.Global;

            try {
                await oldConfig.update(
                    "chatSystemMessage",
                    undefined, // Setting to undefined removes the key
                    targetScope
                );

                // Verify deletion worked
                const verifyOldConfig = vscode.workspace.getConfiguration("translators-copilot");
                const stillExists = verifyOldConfig.inspect("chatSystemMessage")?.workspaceValue ||
                    verifyOldConfig.inspect("chatSystemMessage")?.workspaceFolderValue ||
                    verifyOldConfig.inspect("chatSystemMessage")?.globalValue;

                if (stillExists) {
                    console.error('⚠️ Failed to delete old chatSystemMessage key! It may still exist in a different scope.');
                } else {
                    console.log('✅ Successfully removed deprecated setting (new key already exists).');
                }
            } catch (error) {
                console.error('❌ Error removing deprecated chatSystemMessage:', error);
            }
            return;
        }

        // CASE 2: Only new key exists - nothing to do
        if (hasNewValue && !oldValue) {
            console.log('New chatSystemMessage setting already exists, old setting not found. No migration needed.');
            return;
        }

        // CASE 3: Only old key exists - migrate and delete
        if (!hasNewValue && oldValue) {
            console.log('Migrating chatSystemMessage from translators-copilot to codex-editor-extension namespace...');

            const targetScope = oldSettingInspection?.workspaceValue ? vscode.ConfigurationTarget.Workspace :
                oldSettingInspection?.workspaceFolderValue ? vscode.ConfigurationTarget.WorkspaceFolder :
                    vscode.ConfigurationTarget.Global;

            // Copy value to new key
            await codexConfig.update(
                "chatSystemMessage",
                oldValue,
                targetScope
            );

            console.log(`Successfully migrated chatSystemMessage setting to ${targetScope === vscode.ConfigurationTarget.Workspace ? 'workspace' :
                targetScope === vscode.ConfigurationTarget.WorkspaceFolder ? 'workspace folder' : 'global'} scope.`);

            // Delete the old key
            console.log('Removing deprecated translators-copilot.chatSystemMessage setting...');
            await oldConfig.update(
                "chatSystemMessage",
                undefined, // Setting to undefined removes the key
                targetScope
            );
            console.log('Successfully removed deprecated setting.');
            return;
        }

        // CASE 4: Neither key exists - nothing to do
        console.log('No chatSystemMessage setting found in either namespace. No migration needed.');
    } catch (error) {
        console.error('Error during chatSystemMessage migration:', error);
    }
};

export async function temporaryMigrationScript_checkMatthewNotebook() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const matthewNotebookPath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        "files",
        "target",
        "MAT.codex"
    );

    try {
        // Check if MAT.codex exists
        await vscode.workspace.fs.stat(matthewNotebookPath);

        // If MAT.codex exists, proceed with migration
        const document = await vscode.workspace.openNotebookDocument(matthewNotebookPath);
        for (const cell of document.getCells()) {
            if (
                cell.kind === vscode.NotebookCellKind.Code &&
                cell.document.getText().includes("MAT 1:1")
            ) {
                vscode.window.showInformationMessage(
                    "Updating notebook to use cells for verse content."
                );
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Updating notebooks",
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ increment: 0 });
                        await vscode.commands.executeCommand(
                            "codex-editor-extension.updateProjectNotebooksToUseCellsForVerseContent"
                        );
                        progress.report({ increment: 100 });
                    }
                );
                vscode.window.showInformationMessage(
                    "Updated notebook to use cells for verse content."
                );
                // Reload the window
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
                break;
            }
        }
    } catch (error) {
        // If MAT.codex doesn't exist, we silently ignore
        console.log("MAT.codex not found. Skipping migration.");
    }
}

export const migration_editHistoryFormat = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "editHistoryFormatMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Edit history format migration already completed, skipping");
            return;
        }

        console.log("Running edit history format migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping migration");
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Migrating edit history format",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: (100 / allFiles.length)
                    });

                    try {
                        const wasMigrated = await migrateEditHistoryForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Edit history format migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Edit history format migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running edit history format migration:", error);
    }
};

/**
 * Adds validations to value edits that match the current cell value, if and only if
 * the matching edit is a USER_EDIT. The validation will be attributed to the edit's author.
 * This migration is idempotent: it will not duplicate existing validations.
 */
export const migration_addValidationsForUserEdits = async () => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const workspaceFolder = workspaceFolders[0];

        // Only target Codex translation files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );

        if (codexFiles.length === 0) {
            console.log("No codex files found for validation migration");
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Migrating validations for user edits",
                cancellable: false,
            },
            async (progress) => {
                for (let i = 0; i < codexFiles.length; i++) {
                    const file = codexFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: 100 / codexFiles.length,
                    });

                    try {
                        const wasMigrated = await migrateValidationsForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        console.log(
            `Validation migration completed: ${processedFiles} files processed, ${migratedFiles} files updated`
        );
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Validation migration complete: ${migratedFiles} files updated`
            );
        }
    } catch (error) {
        console.error("Error running validation migration:", error);
    }
};

async function migrateValidationsForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Read the file content
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        let hasChanges = false;

        for (const cell of cells) {
            const cellValue: string = cell?.value;
            const edits: any[] = (cell?.metadata?.edits as any[]) || [];
            if (!cellValue || !Array.isArray(edits) || edits.length === 0) continue;

            // Find latest value-edit whose value matches the current cell value
            let targetEdit: any | undefined;
            for (let i = edits.length - 1; i >= 0; i--) {
                const e = edits[i];
                const isValueEdit = EditMapUtils.isValue(e?.editMap || []);
                if (isValueEdit && e?.value === cellValue) {
                    targetEdit = e;
                    break;
                }
            }

            if (!targetEdit) continue;
            if (targetEdit.type !== EditType.USER_EDIT) continue; // Only add validation to user edits

            // Normalize validatedBy to be an array of ValidationEntry objects
            if (!Array.isArray(targetEdit.validatedBy)) {
                targetEdit.validatedBy = [] as ValidationEntry[];
            } else {
                // Convert any string entries (legacy) to ValidationEntry objects
                const normalized: ValidationEntry[] = [];
                for (const entry of targetEdit.validatedBy) {
                    if (typeof entry === "string") {
                        const ts = Number(targetEdit.timestamp) || Date.now();
                        normalized.push({
                            username: entry,
                            creationTimestamp: ts,
                            updatedTimestamp: ts,
                            isDeleted: false,
                        });
                    } else if (entry && typeof entry === "object") {
                        normalized.push(entry as ValidationEntry);
                    }
                }
                targetEdit.validatedBy = normalized;
            }

            const author: string = targetEdit.author || "anonymous";
            const ts = Number(targetEdit.timestamp) || Date.now();

            // Check for existing non-deleted validation by the author
            const alreadyValidated = (targetEdit.validatedBy as ValidationEntry[]).some(
                (v) => v && v.username === author && v.isDeleted === false
            );
            if (!alreadyValidated) {
                const newEntry: ValidationEntry = {
                    username: author,
                    creationTimestamp: ts,
                    updatedTimestamp: ts,
                    isDeleted: false,
                };
                (targetEdit.validatedBy as ValidationEntry[]).push(newEntry);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            // Mark migration flag
            try {
                notebookData.metadata = notebookData.metadata || {};
                notebookData.metadata.validationMigrationComplete = true;
            } catch { /* ignore */ }

            const updatedContent = await serializer.serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`Error migrating validations for ${fileUri.fsPath}:`, error);
        return false;
    }
}

async function migrateTimestampsForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells = notebookData.cells || [];
        let hasChanges = false;

        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const data: any = md.data || {};

            // Detect legacy top-level timestamps
            const legacyStart = (md as any).startTime;
            const legacyEnd = (md as any).endTime;
            const legacyFormat = (md as any).format;
            const legacyOriginalText = (md as any).originalText;

            const hasLegacyTs = legacyStart !== undefined || legacyEnd !== undefined || legacyFormat !== undefined || legacyOriginalText !== undefined;

            if (hasLegacyTs) {
                // Only set if not already present in data
                if (legacyStart !== undefined && data.startTime === undefined) data.startTime = legacyStart;
                if (legacyEnd !== undefined && data.endTime === undefined) data.endTime = legacyEnd;
                if (legacyFormat !== undefined && data.format === undefined) data.format = legacyFormat;
                if (legacyOriginalText !== undefined && data.originalText === undefined) data.originalText = legacyOriginalText;

                // Clean legacy fields
                delete (md as any).startTime;
                delete (md as any).endTime;
                delete (md as any).format;
                delete (md as any).originalText;

                md.data = data;
                cell.metadata = md;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            const updatedContent = await serializer.serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`Error migrating timestamps for ${fileUri.fsPath}:`, error);
        return false;
    }
}

async function promoteCellTypeForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells = notebookData.cells || [];
        let hasChanges = false;

        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const data: any = md.data || {};

            // If top-level type is missing but data.type exists, promote it
            if ((md.type === undefined || md.type === null) && data && data.type !== undefined) {
                md.type = data.type;
                delete data.type;
                md.data = data;
                cell.metadata = md;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            const updatedContent = await serializer.serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`Error promoting cell type for ${fileUri.fsPath}:`, error);
        return false;
    }
}

async function migrateEditHistoryForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Read the file content
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells = notebookData.cells || [];
        let hasChanges = false;

        // Check and migrate each cell's edit history
        for (const cell of cells) {
            if (cell.metadata?.edits && cell.metadata.edits.length > 0) {
                for (const edit of cell.metadata.edits as any) {
                    // Check if this is an old format edit (has cellValue but no editMap)
                    if (edit.cellValue !== undefined && !edit.editMap) {
                        // Migrate old format to new format
                        edit.value = edit.cellValue; // Move cellValue to value
                        edit.editMap = ["value"]; // Set editMap to point to value
                        delete edit.cellValue; // Remove old property
                        hasChanges = true;

                        console.log(`Migrated edit in cell ${cell.metadata.id}: converted cellValue to value with editMap`);
                    }
                }
            }
        }

        // If any changes were made, save the file
        if (hasChanges) {
            const updatedContent = await serializer.serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
            return true;
        }

        return false;

    } catch (error) {
        console.error(`Error migrating edit history for ${fileUri.fsPath}:`, error);
        return false;
    }
}

export const migration_lineNumbersSettings = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "lineNumbersMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Line numbers migration already completed, skipping");
            return;
        }

        console.log("Running line numbers migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allNotebookFiles = [...codexFiles, ...sourceFiles];

        if (allNotebookFiles.length === 0) {
            console.log("No codex or source files found, skipping migration");
            return;
        }

        let processedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Setting up line numbers",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allNotebookFiles.length; i++) {
                    const file = allNotebookFiles[i];
                    progress.report({
                        message: `Analyzing ${path.basename(file.fsPath)}`,
                        increment: (100 / allNotebookFiles.length)
                    });

                    try {
                        // If this looks like a Bible notebook and is missing labels,
                        // add verse-number labels based on the verse ID (e.g. "GEN 1:1" -> label "1").
                        const probablyBible = await isBibleBook(file);
                        if (probablyBible) {
                            const added = await addCellLabelsToBibleBook(file);
                            if (added) {
                                console.log(`Added verse-number labels for ${path.basename(file.fsPath)}`);
                            }
                        }

                        const shouldShowLineNumbers = await analyzeFileForLineNumbers(file);
                        await updateFileLineNumbers(file, shouldShowLineNumbers);
                        processedFiles++;
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Line numbers migration completed: ${processedFiles} files processed`);
        vscode.window.showInformationMessage(
            `Line numbers setup complete: ${processedFiles} files configured`
        );

    } catch (error) {
        console.error("Error running line numbers migration:", error);
    }
};

// Gently migrate A/B testing probability from older explicit 25% to 5% with user consent
// (removed) migration_abTestingProbabilityDefault — intentionally deleted for now

async function analyzeFileForLineNumbers(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Read the file content using serializer for proper deserialization
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells = notebookData.cells || [];
        if (cells.length === 0) {
            // Empty file, show line numbers
            return true;
        }

        // Sample up to 10 random cells to analyze
        const sampleSize = Math.min(10, cells.length);
        const sampledCells = getRandomSample(cells, sampleSize);

        // Check if any cell has meaningful labels
        for (const cell of sampledCells) {
            const cellLabel = cell.metadata.cellLabel;

            // If there's no label, show line numbers
            if (!cellLabel) {
                return true;
            }

            // If label is just a number, we might not need line numbers
            // If label contains words (not just numbers), show line numbers
            if (isMeaningfulLabel(cellLabel)) {
                return true;
            }
        }

        // If we get here, all sampled cells have numeric labels or no labels
        // In this case, we can hide line numbers since the labels serve as identifiers
        return false;

    } catch (error) {
        console.error(`Error analyzing file ${fileUri.fsPath}:`, error);
        // On error, default to showing line numbers
        return true;
    }
}

function isMeaningfulLabel(label: string): boolean {
    if (!label || typeof label !== 'string') {
        return false;
    }

    // Trim whitespace
    const trimmedLabel = label.trim();

    // If it's empty, not meaningful
    if (trimmedLabel.length === 0) {
        return false;
    }

    // If it's just numbers (like "1", "2", "3"), not meaningful for our purposes
    if (/^\d+$/.test(trimmedLabel)) {
        return false;
    }

    // If it contains letters or other characters, it's meaningful
    if (/[a-zA-Z]/.test(trimmedLabel)) {
        return true;
    }

    // If it contains special characters or is a complex identifier
    if (/[^0-9\s]/.test(trimmedLabel)) {
        return true;
    }

    // If it's a simple number, not meaningful
    return false;
}

function getRandomSample<T>(array: T[], sampleSize: number): T[] {
    if (sampleSize >= array.length) {
        return array;
    }

    const sample: T[] = [];
    const usedIndices = new Set<number>();

    while (sample.length < sampleSize) {
        const randomIndex = Math.floor(Math.random() * array.length);
        if (!usedIndices.has(randomIndex)) {
            usedIndices.add(randomIndex);
            sample.push(array[randomIndex]);
        }
    }

    return sample;
}

async function updateFileLineNumbers(fileUri: vscode.Uri, enableLineNumbers: boolean): Promise<boolean> {
    try {
        // Read the file content
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        // Check if file already has line numbers setting
        const currentLineNumbersEnabled = notebookData.metadata?.lineNumbersEnabled;

        // Skip files that already have line numbers setting configured
        // This preserves any existing configuration (whether set locally or globally)
        if (currentLineNumbersEnabled !== undefined) {
            return false; // Skip this file - already has line numbers configured
        }

        // Update the line numbers setting and mark it as globally set

        notebookData.metadata.lineNumbersEnabled = enableLineNumbers;
        notebookData.metadata.lineNumbersEnabledSource = "global"; // Mark as globally set

        // Serialize the updated notebook back to the file
        const updatedContent = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );

        // Write the updated content back to the file
        await vscode.workspace.fs.writeFile(fileUri, updatedContent);

        return true; // File was updated

    } catch (error) {
        console.error(`Error updating line numbers for ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Heuristic: Determine if a notebook is likely a single Bible book.
 * We check a random sample of cells for verse-ref style IDs like "GEN 1:1" and
 * require that most matched cells share the same 3-letter book code present in vrefData.
 */
export async function isBibleBook(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = (notebookData as any).cells || [];
        if (cells.length === 0) return false;

        const sampleSize = Math.min(30, cells.length);
        const sampled = getRandomSample(cells, sampleSize);
        let matches = 0;
        const bookCounts = new Map<string, number>();

        for (const cell of sampled) {
            const id: string | undefined = cell?.metadata?.id;
            if (!id) continue;
            const m = String(id).match(/^([A-Z0-9]{3})\s+(\d+):(\d+)$/);
            if (m && vrefData[m[1]]) {
                matches++;
                bookCounts.set(m[1], (bookCounts.get(m[1]) || 0) + 1);
            }
        }

        if (matches === 0) return false;

        // consider it Bible if at least 60% of sampled cells match and dominant book is clear
        const dominant = [...bookCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        const dominantCount = dominant ? dominant[1] : 0;
        return matches / sampleSize >= 0.4 && dominantCount / matches >= 0.6; // lenient: heterogeneous files may still qualify
    } catch {
        return false;
    }
}

/**
 * Add verse-number labels to cells missing a label in Bible notebooks.
 * For an ID like "GEN 1:1", we set `cellLabel` to "1".
 * Returns true if any labels were added and the file was saved.
 */
export async function addCellLabelsToBibleBook(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        let changed = false;
        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const existing = md.cellLabel;
            const id: string | undefined = md.id;
            if (!id) continue;
            const m = String(id).match(/^([A-Z0-9]{3})\s+(\d+):(\d+)$/);
            if (!m) continue;
            const book = m[1];
            const verse = m[3];
            if (!vrefData[book]) continue;
            if (existing && String(existing).trim().length > 0) continue;

            // Assign verse number as label
            md.cellLabel = String(verse);
            cell.metadata = md;
            changed = true;
        }

        if (!changed) return false;

        const updatedContent = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(fileUri, updatedContent);
        return true;
    } catch (e) {
        console.error(`Failed to add Bible labels for ${fileUri.fsPath}:`, e);
        return false;
    }
}

/**
 * Standardizes old importerType values to match current FileImporterType definition
 */
function standardizeImporterType(importerType: string | undefined): string | undefined {
    if (!importerType) {
        return undefined;
    }

    const normalized = importerType.toLowerCase().trim();

    // Standardization rules
    if (normalized === "ebiblecorpus") {
        return "ebible";
    }
    if (normalized === "macula-bible") {
        return "macula";
    }
    if (normalized === "obs-story") {
        return "obs";
    }

    // Valid FileImporterType values
    const validTypes: string[] = [
        "smart-segmenter",
        "audio",
        "docx-roundtrip",
        "markdown",
        "subtitles",
        "spreadsheet",
        "tms",
        "pdf",
        "indesign",
        "usfm",
        "paratext",
        "ebible",
        "macula",
        "biblica",
        "obs",
    ];

    // Check if it's already a valid type (case-insensitive)
    const matchedType = validTypes.find((type) => type.toLowerCase() === normalized);
    if (matchedType) {
        return matchedType;
    }

    return undefined;
}

/**
 * Infers importerType from corpusMarker by matching to FileImporterType values
 */
function inferImporterTypeFromCorpusMarker(corpusMarker: string | undefined): string | undefined {
    if (!corpusMarker) {
        return undefined;
    }

    const normalized = corpusMarker.toLowerCase().trim();

    // Direct mapping from corpusMarker to importerType
    const mapping: Record<string, string> = {
        "pdf": "pdf",
        "tms": "tms",
        "obs": "obs",
        "markdown": "markdown",
        "subtitles": "subtitles",
        "subtitle": "subtitles", // Handle singular
        "spreadsheet": "spreadsheet",
        "indesign": "indesign",
        "usfm": "usfm",
        "paratext": "paratext",
        "ebible": "ebible",
        "ebiblecorpus": "ebible", // Special case
        "macula": "macula",
        "macula-bible": "macula", // Special case
        "biblica": "biblica",
        "audio": "audio",
        "smart-segmenter": "smart-segmenter",
        "docx-roundtrip": "docx-roundtrip",
        "docx": "docx-roundtrip", // Common alias
        "obs-story": "obs", // Special case
    };

    return mapping[normalized];
}

/**
 * Migrates importerType for a single notebook file
 */
async function migrateImporterTypeForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        if (!notebookData.metadata) {
            notebookData.metadata = {};
        }

        let hasChanges = false;
        const existingImporterType = notebookData.metadata.importerType;
        const corpusMarker = notebookData.metadata.corpusMarker;

        // First, standardize existing importerType if present
        if (existingImporterType) {
            const standardized = standardizeImporterType(existingImporterType);
            if (standardized && standardized !== existingImporterType) {
                notebookData.metadata.importerType = standardized;
                hasChanges = true;
                console.log(
                    `Standardized importerType in ${path.basename(fileUri.fsPath)}: "${existingImporterType}" → "${standardized}"`
                );
            } else if (!standardized) {
                // Invalid importerType, remove it
                delete notebookData.metadata.importerType;
                hasChanges = true;
                console.log(
                    `Removed invalid importerType "${existingImporterType}" from ${path.basename(fileUri.fsPath)}`
                );
            }
        }

        // If importerType is still missing, infer from corpusMarker
        if (!notebookData.metadata.importerType && corpusMarker) {
            const inferred = inferImporterTypeFromCorpusMarker(corpusMarker);
            if (inferred) {
                notebookData.metadata.importerType = inferred;
                hasChanges = true;
                console.log(
                    `Inferred importerType "${inferred}" from corpusMarker "${corpusMarker}" in ${path.basename(fileUri.fsPath)}`
                );
            }
        }

        if (hasChanges) {
            const updatedContent = await serializer.serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`Error migrating importerType for ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Migration: Add importerType to notebook metadata by inferring from corpusMarker
 * and standardizing old values to match current FileImporterType definition.
 * - Idempotent
 * - Standardizes old values: "ebibleCorpus" → "ebible", "macula-bible" → "macula", "obs-story" → "obs"
 * - Infers importerType from corpusMarker when missing
 */
export const migration_addImporterTypeToMetadata = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "importerTypeMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("ImporterType migration already completed, skipping");
            return;
        }

        console.log("Running importerType migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping importerType migration");
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Adding importerType to notebook metadata",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: (100 / allFiles.length)
                    });

                    try {
                        const wasMigrated = await migrateImporterTypeForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`ImporterType migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `ImporterType migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running importerType migration:", error);
    }
};

/**
 * Gets the current user name for edit tracking
 */
async function getCurrentUserName(): Promise<string> {
    try {
        // Try auth API first
        const authApi = await getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        if (userInfo?.username) {
            return userInfo.username;
        }
    } catch (error) {
        // Silent fallback
    }

    // Fallback
    return "unknown";
}

/**
 * Extracts the chapter/section number from a cellId.
 * Handles formats like:
 * - "GEN 1:1" -> "1"
 * - "Book Name 2:5" -> "2"
 * - "filename 1:1" -> "1"
 * Returns null if the pattern doesn't match.
 */
function extractChapterFromCellId(cellId: string): string | null {
    if (!cellId) return null;

    // Pattern: anything followed by space, then number, colon, number
    // e.g., "GEN 1:1", "Book Name 2:5", "filename 1:1"
    const match = cellId.match(/\s+(\d+):(\d+)(?::|$)/);
    if (match) {
        return match[1]; // Return the chapter number (first number)
    }
    return null;
}

/**
 * Extracts chapter number from a cell using priority order:
 * 1. metadata.chapterNumber (Biblica)
 * 2. metadata.chapter (USFM)
 * 3. metadata.data?.chapter (legacy)
 * 4. extractChapterFromCellId (from cellId)
 * 5. milestoneIndex (final fallback, 1-indexed)
 */
function extractChapterFromCell(cell: any, milestoneIndex: number): string {
    // Priority 1: metadata.chapterNumber (Biblica)
    if (cell?.metadata?.chapterNumber !== undefined && cell.metadata.chapterNumber !== null) {
        return String(cell.metadata.chapterNumber);
    }

    // Priority 2: metadata.chapter (USFM)
    if (cell?.metadata?.chapter !== undefined && cell.metadata.chapter !== null) {
        return String(cell.metadata.chapter);
    }

    // Priority 3: metadata.data?.chapter (legacy)
    if (cell?.metadata?.data?.chapter !== undefined && cell.metadata.data.chapter !== null) {
        return String(cell.metadata.data.chapter);
    }

    // Priority 4: Extract from cellId
    const cellId = cell?.metadata?.id || cell?.id;
    if (cellId) {
        const chapterFromId = extractChapterFromCellId(cellId);
        if (chapterFromId) {
            return chapterFromId;
        }
    }

    // Priority 5: Use milestone index (1-indexed)
    return milestoneIndex.toString();
}

/**
 * Creates a milestone cell with chapter number derived from the cell below it.
 */
async function createMilestoneCell(cell: any, milestoneIndex: number): Promise<any> {
    const uuid = randomUUID();
    const chapterNumber = extractChapterFromCell(cell, milestoneIndex);
    const currentTimestamp = Date.now();
    const author = await getCurrentUserName();

    // Create initial edit entry similar to source file cells
    const initialEdit = {
        editMap: EditMapUtils.value(),
        value: chapterNumber,
        timestamp: currentTimestamp - 1000, // Ensure it's before any user edits
        type: EditType.INITIAL_IMPORT,
        author: author,
        validatedBy: []
    };

    return {
        kind: 2, // vscode.NotebookCellKind.Code
        languageId: "html",
        value: chapterNumber,
        metadata: {
            id: uuid,
            type: CodexCellTypes.MILESTONE,
            edits: [initialEdit]
        }
    };
}

/**
 * Migrates milestone cells for a single notebook file.
 * Inserts milestone cells at the start of the file and before each new chapter.
 */
async function migrateMilestoneCellsForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        // Check if file already has milestone cells (idempotent check)
        const hasMilestoneCells = cells.some(
            (cell) => cell.metadata?.type === CodexCellTypes.MILESTONE
        );
        if (hasMilestoneCells) {
            return false; // Already migrated
        }

        const newCells: any[] = [];
        const seenChapters = new Set<string>();
        let firstCell: any | null = null;

        // First pass: find the first cell (for first milestone)
        for (const cell of cells) {
            if (cell.metadata?.id) {
                firstCell = cell;
                break;
            }
        }

        // If no cells found, skip this file
        if (!firstCell) {
            return false;
        }

        // Track milestone index (1-indexed)
        let milestoneIndex = 1;

        // Insert first milestone cell at the beginning
        newCells.push(await createMilestoneCell(firstCell, milestoneIndex));
        milestoneIndex++;

        // Track the chapter of the first cell to avoid duplicate milestone
        const firstCellId = firstCell.metadata?.id;
        if (firstCellId) {
            const chapter = extractChapterFromCellId(firstCellId);
            if (chapter) {
                seenChapters.add(chapter);
            }
        }

        // Process all cells and insert milestone cells before new chapters
        for (const cell of cells) {
            const cellId = cell.metadata?.id;
            if (cellId) {
                const chapter = extractChapterFromCellId(cellId);
                if (chapter && !seenChapters.has(chapter)) {
                    // Insert a milestone cell before this new chapter
                    newCells.push(await createMilestoneCell(cell, milestoneIndex));
                    milestoneIndex++;
                    seenChapters.add(chapter);
                }
            }
            newCells.push(cell);
        }

        // Update notebook data with new cells
        notebookData.cells = newCells;

        // Serialize and save
        const updatedContent = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(fileUri, updatedContent);

        return true;
    } catch (error) {
        console.error(`Error migrating milestone cells for ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Migration: Add milestone cells to mark chapters/sections in notebooks.
 * Milestone cells are inserted:
 * 1. At the very beginning of each file (for the first chapter)
 * 2. Before the first occurrence of each new chapter number
 * 
 * This migration is idempotent - it checks for existing milestone cells.
 */
export const migration_addMilestoneCells = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "milestoneCellsMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Milestone cells migration already completed, skipping");
            return;
        }

        console.log("Running milestone cells migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping milestone cells migration");
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                // If configuration key is not registered, fall back to workspaceState
                await context?.workspaceState.update(migrationKey, true);
            }
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Adding milestone cells",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: (100 / allFiles.length)
                    });

                    try {
                        const wasMigrated = await migrateMilestoneCellsForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Milestone cells migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Milestone cells migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running milestone cells migration:", error);
    }
};

/**
 * Deduplicates consecutive milestone cells that both have INITIAL_IMPORT edits.
 * Keeps the one with the latest timestamp and soft-deletes the other.
 * This should run only once after syncing the project.
 */
export const deduplicateConsecutiveMilestoneCells = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping milestone cells deduplication");
            return;
        }

        // Scan for duplicates first - if duplicates exist, proceed with deduplication
        const serializer = new CodexContentSerializer();
        let hasDuplicates = false;

        for (const fileUri of allFiles) {
            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const notebookData: any = await serializer.deserializeNotebook(
                    fileContent,
                    new vscode.CancellationTokenSource().token
                );

                const cells: any[] = notebookData.cells || [];
                if (cells.length === 0) {
                    continue;
                }

                // Check for consecutive milestone cells with matching values and initial_import edits
                for (let i = 0; i < cells.length - 1; i++) {
                    const currentCell = cells[i];
                    const nextCell = cells[i + 1];

                    // Skip if either cell is already deleted
                    if (currentCell?.metadata?.data?.deleted || nextCell?.metadata?.data?.deleted) {
                        continue;
                    }

                    // Check that both are milestone cells
                    const currentIsMilestone = currentCell?.metadata?.type === CodexCellTypes.MILESTONE;
                    const nextIsMilestone = nextCell?.metadata?.type === CodexCellTypes.MILESTONE;

                    if (!currentIsMilestone || !nextIsMilestone) {
                        continue;
                    }

                    // Check if values match
                    if (currentCell.value !== nextCell.value) {
                        continue;
                    }

                    // Check if both have INITIAL_IMPORT edits
                    const currentEdits = currentCell.metadata?.edits || [];
                    const nextEdits = nextCell.metadata?.edits || [];

                    const currentInitialEdit = currentEdits.find(
                        (edit: any) => edit.type === EditType.INITIAL_IMPORT
                    );
                    const nextInitialEdit = nextEdits.find(
                        (edit: any) => edit.type === EditType.INITIAL_IMPORT
                    );

                    if (currentInitialEdit && nextInitialEdit) {
                        hasDuplicates = true;
                        break;
                    }
                }

                if (hasDuplicates) {
                    break;
                }
            } catch (error) {
                // Continue scanning other files even if one fails
                continue;
            }
        }

        // If no duplicates found, skip deduplication
        if (!hasDuplicates) {
            console.log("No duplicate milestone cells found, skipping deduplication");
            return;
        }

        console.log("Running milestone cells deduplication...");

        const author = await getCurrentUserName();

        let processedFiles = 0;
        let deduplicatedFiles = 0;

        // Process files
        for (const fileUri of allFiles) {
            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const notebookData: any = await serializer.deserializeNotebook(
                    fileContent,
                    new vscode.CancellationTokenSource().token
                );

                const cells: any[] = notebookData.cells || [];
                if (cells.length === 0) {
                    processedFiles++;
                    continue;
                }

                let fileWasModified = false;

                // Iterate through cells to find consecutive milestone cells
                for (let i = 0; i < cells.length - 1; i++) {
                    const currentCell = cells[i];
                    const nextCell = cells[i + 1];

                    // Skip if either cell is already deleted
                    if (currentCell?.metadata?.data?.deleted || nextCell?.metadata?.data?.deleted) {
                        continue;
                    }

                    // Explicitly check that both are milestone cells - skip if not
                    const currentIsMilestone = currentCell?.metadata?.type === CodexCellTypes.MILESTONE;
                    const nextIsMilestone = nextCell?.metadata?.type === CodexCellTypes.MILESTONE;

                    if (!currentIsMilestone || !nextIsMilestone) {
                        // Skip non-milestone cells - we only process milestone cells
                        continue;
                    }

                    // Both are milestone cells - proceed with deduplication check
                    // Check if values match (only deduplicate when milestone values are the same)
                    if (currentCell.value !== nextCell.value) {
                        continue;
                    }

                    // Check if both have INITIAL_IMPORT edits
                    const currentEdits = currentCell.metadata?.edits || [];
                    const nextEdits = nextCell.metadata?.edits || [];

                    const currentInitialEdit = currentEdits.find(
                        (edit: any) => edit.type === EditType.INITIAL_IMPORT
                    );
                    const nextInitialEdit = nextEdits.find(
                        (edit: any) => edit.type === EditType.INITIAL_IMPORT
                    );

                    if (currentInitialEdit && nextInitialEdit) {
                        // Compare timestamps - keep the one with latest timestamp, delete the other
                        const cellToDelete =
                            currentInitialEdit.timestamp < nextInitialEdit.timestamp
                                ? currentCell
                                : nextCell;

                        // Double-check that we're only modifying milestone cells
                        if (cellToDelete?.metadata?.type !== CodexCellTypes.MILESTONE) {
                            console.warn(
                                `Skipping non-milestone cell during deduplication: ${cellToDelete?.metadata?.id}`
                            );
                            continue;
                        }

                        // Ensure metadata exists
                        if (!cellToDelete.metadata) {
                            cellToDelete.metadata = {
                                id: cellToDelete.metadata?.id || randomUUID(),
                                type: CodexCellTypes.MILESTONE,
                                edits: [],
                                data: {}
                            };
                        }

                        // Preserve the cell type - ensure it remains MILESTONE
                        const preservedType = cellToDelete.metadata.type || CodexCellTypes.MILESTONE;

                        // Soft delete the cell with earlier timestamp
                        if (!cellToDelete.metadata.data) {
                            cellToDelete.metadata.data = {};
                        }
                        cellToDelete.metadata.data.deleted = true;

                        // Ensure edits array exists
                        if (!cellToDelete.metadata.edits) {
                            cellToDelete.metadata.edits = [];
                        }

                        // Add deletion edit
                        const currentTimestamp = Date.now();
                        cellToDelete.metadata.edits.push({
                            editMap: EditMapUtils.dataDeleted(),
                            value: true,
                            timestamp: currentTimestamp,
                            type: EditType.USER_EDIT,
                            author: author,
                            validatedBy: []
                        });

                        // Explicitly preserve the cell type
                        cellToDelete.metadata.type = preservedType;

                        fileWasModified = true;
                    }
                }

                // Save file if modified
                if (fileWasModified) {
                    const updatedContent = await serializer.serializeNotebook(
                        notebookData,
                        new vscode.CancellationTokenSource().token
                    );
                    await vscode.workspace.fs.writeFile(fileUri, updatedContent);
                    deduplicatedFiles++;
                }

                processedFiles++;
            } catch (error) {
                console.error(`Error processing ${fileUri.fsPath} during deduplication:`, error);
            }
        }

        console.log(
            `Milestone cells deduplication completed: ${processedFiles} files processed, ${deduplicatedFiles} files deduplicated`
        );
    } catch (error) {
        console.error("Error running milestone cells deduplication:", error);
    }
};

/**
 * Migration: Reorder misplaced paratext cells to be above their parent cells.
 * Paratext cells that are found at the end of files (after all content cells) and
 * are not already positioned near their parent cells will be moved above their parent.
 * 
 * This migration is idempotent - it checks if paratext cells are correctly positioned.
 */
export const migration_reorderMisplacedParatextCells = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "paratextReorderMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Paratext reorder migration already completed, skipping");
            return;
        }

        console.log("Running paratext reorder migration...");

        const workspaceFolder = workspaceFolders[0];

        // Find all codex and source files
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];

        if (allFiles.length === 0) {
            console.log("No codex or source files found, skipping paratext reorder migration");
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                // If configuration key is not registered, fall back to workspaceState
                await context?.workspaceState.update(migrationKey, true);
            }
            return;
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Reordering misplaced paratext cells",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const file = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(file.fsPath)}`,
                        increment: (100 / allFiles.length)
                    });

                    try {
                        const wasMigrated = await migrateParatextCellsForFile(file);
                        processedFiles++;
                        if (wasMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.fsPath}:`, error);
                    }
                }
            }
        );

        // Mark migration as completed
        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // If configuration key is not registered, fall back to workspaceState
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(`Paratext reorder migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Paratext reorder migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running paratext reorder migration:", error);
    }
};

/**
 * Processes a single file to reorder misplaced paratext cells.
 * Returns true if the file was modified, false otherwise.
 */
export async function migrateParatextCellsForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        // Early return if no paratext cells found in the file
        const hasParatextCells = cells.some(
            (cell) => cell.metadata?.type === CodexCellTypes.PARATEXT
        );
        if (!hasParatextCells) {
            return false;
        }

        // Find the last content cell index (last non-paratext, non-milestone cell)
        let lastContentCellIndex = -1;
        for (let i = cells.length - 1; i >= 0; i--) {
            const cell = cells[i];
            const cellType = cell.metadata?.type;
            if (cellType !== CodexCellTypes.PARATEXT && cellType !== CodexCellTypes.MILESTONE) {
                lastContentCellIndex = i;
                break;
            }
        }

        // If no content cells found, skip this file
        if (lastContentCellIndex === -1) {
            return false;
        }

        // Identify misplaced paratext cells
        // A paratext cell is misplaced if:
        // 1. It appears after all content cells (index > lastContentCellIndex)
        // 2. It's not already positioned immediately before or after its parent cell
        const misplacedParatextCells: Array<{ cell: any; index: number; parentId: string; }> = [];
        const parentCellIndexMap = new Map<string, number>();

        // Build a map of parent cell IDs to their indices
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const cellId = cell.metadata?.id;
            if (cellId) {
                parentCellIndexMap.set(cellId, i);
            }
        }

        // Check paratext cells that appear after all content cells
        for (let i = lastContentCellIndex + 1; i < cells.length; i++) {
            const cell = cells[i];
            const cellType = cell.metadata?.type;
            const cellId = cell.metadata?.id;

            if (cellType === CodexCellTypes.PARATEXT && cellId) {
                const parentId = extractParentCellIdFromParatext(cellId);
                if (!parentId) {
                    // Skip paratext cells with no valid parent ID
                    continue;
                }

                const parentIndex = parentCellIndexMap.get(parentId);
                if (parentIndex === undefined) {
                    // Skip if parent cell not found
                    continue;
                }

                // Check if paratext is already positioned correctly (immediately before or after parent)
                const isBeforeParent = i === parentIndex - 1;
                const isAfterParent = i === parentIndex + 1;

                if (!isBeforeParent && !isAfterParent) {
                    // This paratext cell is misplaced
                    misplacedParatextCells.push({ cell, index: i, parentId });
                }
            }
        }

        // If no misplaced paratext cells found, file doesn't need migration
        if (misplacedParatextCells.length === 0) {
            return false;
        }

        // Group misplaced paratext cells by parent ID
        const paratextCellsByParent = new Map<string, Array<{ cell: any; originalIndex: number; }>>();
        for (const { cell, index, parentId } of misplacedParatextCells) {
            if (!paratextCellsByParent.has(parentId)) {
                paratextCellsByParent.set(parentId, []);
            }
            paratextCellsByParent.get(parentId)!.push({ cell, originalIndex: index });
        }

        // Sort paratext cells for each parent by their original index to maintain relative order
        for (const paratextCells of paratextCellsByParent.values()) {
            paratextCells.sort((a, b) => a.originalIndex - b.originalIndex);
        }

        // Build new cells array
        const newCells: any[] = [];
        const processedIndices = new Set<number>();

        // Mark all misplaced paratext cell indices as processed (they'll be moved)
        for (const { index } of misplacedParatextCells) {
            processedIndices.add(index);
        }

        // Iterate through original cells and rebuild array
        for (let i = 0; i < cells.length; i++) {
            // Skip misplaced paratext cells (they'll be inserted before their parent)
            if (processedIndices.has(i)) {
                continue;
            }

            const cell = cells[i];
            const cellId = cell.metadata?.id;

            // Check if this cell is a parent that has misplaced paratext cells
            if (cellId && paratextCellsByParent.has(cellId)) {
                // Insert paratext cells before the parent
                const paratextCells = paratextCellsByParent.get(cellId)!;
                for (const { cell: paratextCell } of paratextCells) {
                    newCells.push(paratextCell);
                }
            }

            // Add the current cell
            newCells.push(cell);
        }

        // Update notebook data with new cells
        notebookData.cells = newCells;

        // Serialize and save
        const updatedContent = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(fileUri, updatedContent);

        return true;
    } catch (error) {
        console.error(`Error migrating paratext cells for ${fileUri.fsPath}:`, error);
        return false;
    }
}
