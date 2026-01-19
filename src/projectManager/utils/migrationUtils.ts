import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import git from "isomorphic-git";
import fs from "fs";
import { CodexContentSerializer } from "@/serializer";
import { vrefData } from "@/utils/verseRefUtils/verseData";
import { EditMapUtils } from "@/utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
import type { ValidationEntry } from "../../../types";
import { getAuthApi } from "../../extension";
import { extractParentCellIdFromParatext } from "../../providers/codexCellEditorProvider/utils/cellUtils";
import { generateCellIdFromHash, isUuidFormat } from "../../utils/uuidUtils";
import { getCorrespondingSourceUri, getCorrespondingCodexUri } from "../../utils/codexNotebookUtils";
import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";
import { resolveCodexCustomMerge } from "./merge/resolvers";
import { atomicWriteUriText } from "../../utils/notebookSafeSaveUtils";
import { normalizeNotebookFileText, formatJsonForNotebookFile } from "../../utils/notebookFileFormattingUtils";

// FIXME: move notebook format migration here

const DEBUG_MODE = false;
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Extension]", ...args);
    }
}

async function stageAndCommitAllWithMessage(
    workspacePath: string,
    message: string
): Promise<void> {
    try {
        let hasGit = false;
        try {
            await git.resolveRef({ fs, dir: workspacePath, ref: "HEAD" });
            hasGit = true;
        } catch {
            // No git repo or no commits; skip commit step
        }

        if (!hasGit) {
            return;
        }

        const statusMatrix = await git.statusMatrix({ fs, dir: workspacePath });
        const hasChanges = statusMatrix.some(([_, head, workdir, stage]) => {
            return !(head === 1 && workdir === 1 && stage === 1);
        });

        if (!hasChanges) {
            return;
        }

        await git.add({ fs, dir: workspacePath, filepath: "." });
        const authApi = getAuthApi();
        let userInfo;
        try {
            const authStatus = authApi?.getAuthStatus?.();
            if (authStatus?.isAuthenticated) {
                userInfo = await authApi?.getUserInfo();
            }
        } catch (error) {
            console.warn("[Cleanup] Could not fetch user info for git commit author:", error);
        }

        const author = {
            name:
                userInfo?.username ||
                vscode.workspace
                    .getConfiguration("codex-project-manager")
                    .get<string>("userName") ||
                "Unknown",
            email:
                userInfo?.email ||
                vscode.workspace
                    .getConfiguration("codex-project-manager")
                    .get<string>("userEmail") ||
                "unknown",
        };

        await git.commit({
            fs,
            dir: workspacePath,
            message,
            author,
        });
    } catch (error) {
        console.warn("[Cleanup] Unable to stage/commit changes (non-critical):", error);
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
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
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
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                await context?.workspaceState.update(migrationKey, true);
            }
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
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
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

type Primitive = string | number | boolean | null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is Primitive {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}

type CellDocumentContextRef = {
    ctx: Record<string, unknown>;
    container: Record<string, unknown>;
    path: "metadata.documentContext" | "metadata.data.documentContext";
};

function getCellDocumentContextRef(cell: unknown): CellDocumentContextRef | null {
    if (!isRecord(cell)) return null;
    const md = cell["metadata"];
    if (!isRecord(md)) return null;

    const direct = md["documentContext"];
    if (isRecord(direct)) {
        return { ctx: direct, container: md, path: "metadata.documentContext" };
    }

    const data = md["data"];
    if (isRecord(data)) {
        const nested = data["documentContext"];
        if (isRecord(nested)) {
            return { ctx: nested, container: data, path: "metadata.data.documentContext" };
        }
    }

    return null;
}

function allEqual<T>(values: T[]): boolean {
    if (values.length <= 1) return true;
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return false;
    }
    return true;
}

/**
 * Migration: Hoist per-cell documentContext into notebook metadata.importContext
 * - Idempotent
 * - Only hoists keys when values are consistent across all found documentContext objects
 * - Removes per-cell keys that were hoisted; deletes the per-cell documentContext object only if it becomes empty
 */
export const migration_hoistDocumentContextToNotebookMetadata = async (
    context?: vscode.ExtensionContext
) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const migrationKey = "documentContextHoistMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("DocumentContext hoist migration already completed, skipping");
            return;
        }

        console.log("Running documentContext hoist migration...");

        const workspaceFolder = workspaceFolders[0];
        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.codex")
        );
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/*.source")
        );

        const allFiles = [...codexFiles, ...sourceFiles];
        if (allFiles.length === 0) {
            // Mark migration as completed even when no files exist to prevent re-running
            try {
                await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                await context?.workspaceState.update(migrationKey, true);
            }
            return;
        }

        const serializer = new CodexContentSerializer();

        const HOIST_KEYS: ReadonlyArray<string> = [
            "importerType",
            "fileName",
            "originalFileName",
            "originalHash",
            "documentId",
            "documentVersion",
            "importTimestamp",
            "fileSize",
        ];

        let processedFiles = 0;
        let migratedFiles = 0;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Hoisting documentContext to notebook metadata",
                cancellable: false,
            },
            async (progress) => {
                for (let i = 0; i < allFiles.length; i++) {
                    const fileUri = allFiles[i];
                    progress.report({
                        message: `Processing ${path.basename(fileUri.fsPath)}`,
                        increment: 100 / allFiles.length,
                    });

                    try {
                        const fileContent = await vscode.workspace.fs.readFile(fileUri);
                        const notebookDataUnknown: unknown = await serializer.deserializeNotebook(
                            fileContent,
                            new vscode.CancellationTokenSource().token
                        );

                        if (!isRecord(notebookDataUnknown)) {
                            processedFiles++;
                            continue;
                        }

                        const notebookData = notebookDataUnknown as Record<string, unknown>;
                        const cellsUnknown = notebookData.cells;
                        const cells = Array.isArray(cellsUnknown) ? cellsUnknown : [];

                        const refs: CellDocumentContextRef[] = [];
                        for (const cell of cells) {
                            const ref = getCellDocumentContextRef(cell);
                            if (ref) refs.push(ref);
                        }

                        // Nothing to do for this file.
                        if (refs.length === 0) {
                            processedFiles++;
                            continue;
                        }

                        if (!isRecord(notebookData.metadata)) {
                            notebookData.metadata = {};
                        }
                        const md = notebookData.metadata as Record<string, unknown>;

                        const hoisted: Record<string, Primitive> = {};

                        for (const key of HOIST_KEYS) {
                            const values: Primitive[] = [];
                            for (const ref of refs) {
                                const v = ref.ctx[key];
                                if (v === undefined) continue;
                                if (isPrimitive(v)) {
                                    values.push(v);
                                }
                            }
                            if (values.length > 0 && allEqual(values)) {
                                hoisted[key] = values[0];
                            }
                        }

                        let hasChanges = false;

                        // Hoist importerType to top-level metadata.importerType when missing.
                        const hoistedImporterType = hoisted.importerType;
                        if (typeof hoistedImporterType === "string" && !md["importerType"]) {
                            const standardized = standardizeImporterType(hoistedImporterType);
                            if (standardized) {
                                md["importerType"] = standardized;
                                hasChanges = true;
                            }
                        }

                        // Hoist originalFileName when missing (derived from fileName/originalFileName).
                        if (!md["originalFileName"]) {
                            const candidate =
                                (typeof hoisted.originalFileName === "string" && hoisted.originalFileName) ||
                                (typeof hoisted.fileName === "string" && hoisted.fileName) ||
                                undefined;
                            if (candidate) {
                                md["originalFileName"] = candidate;
                                hasChanges = true;
                            }
                        }

                        // Hoist to metadata.importContext (fill missing keys only).
                        const existingImportContext = md["importContext"];
                        if (!isRecord(existingImportContext)) {
                            md["importContext"] = {};
                        }
                        const importContext = md["importContext"] as Record<string, unknown>;

                        for (const [key, value] of Object.entries(hoisted)) {
                            if (importContext[key] === undefined) {
                                importContext[key] = value;
                                hasChanges = true;
                            }
                        }

                        // Remove hoisted keys from per-cell contexts (only if they match what we hoisted).
                        const hoistedKeys = Object.keys(hoisted);
                        if (hoistedKeys.length > 0) {
                            for (const ref of refs) {
                                let ctxChanged = false;
                                for (const key of hoistedKeys) {
                                    const current = ref.ctx[key];
                                    const target = hoisted[key];
                                    if (current === target) {
                                        delete ref.ctx[key];
                                        ctxChanged = true;
                                    }
                                }

                                if (ctxChanged) {
                                    // If the context is now empty, remove it from its container.
                                    if (Object.keys(ref.ctx).length === 0) {
                                        delete ref.container["documentContext"];
                                    }
                                    hasChanges = true;
                                }
                            }
                        }

                        if (hasChanges) {
                            const updatedContent = await serializer.serializeNotebook(
                                notebookData as unknown as vscode.NotebookData,
                                new vscode.CancellationTokenSource().token
                            );
                            await vscode.workspace.fs.writeFile(fileUri, updatedContent);
                            migratedFiles++;
                        }

                        processedFiles++;
                    } catch (error) {
                        processedFiles++;
                        console.error(`Error processing ${fileUri.fsPath}:`, error);
                    }
                }
            }
        );

        try {
            await config.update(migrationKey, true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            await context?.workspaceState.update(migrationKey, true);
        }

        console.log(
            `DocumentContext hoist migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`
        );
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `DocumentContext hoist migration complete: ${migratedFiles} files updated`
            );
        }
    } catch (error) {
        console.error("Error running documentContext hoist migration:", error);
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
 * Extracts book abbreviation from a cell's globalReferences or cellMarkers.
 * Returns null if no book abbreviation can be found.
 */
function extractBookNameFromCell(cell: any): string | null {
    // Priority 1: Extract from globalReferences array (preferred method)
    const globalRefs = cell?.data?.globalReferences || cell?.metadata?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const firstRef = globalRefs[0];
        // Extract book name: "GEN 1:1" -> "GEN" or "TheChosen-201-en-SingleSpeaker 1:jkflds" -> "TheChosen-201-en-SingleSpeaker"
        const bookMatch = firstRef.match(/^([^\s]+)/);
        if (bookMatch) {
            return bookMatch[1];
        }
    }

    // Priority 2: Fallback to cellMarkers (legacy support during migration)
    if (cell?.cellMarkers?.[0]) {
        const firstMarker = cell.cellMarkers[0].split(":")[0];
        if (firstMarker) {
            const parts = firstMarker.split(" ");
            return parts[0];
        }
    }

    // Priority 3: Extract from cellId
    const cellId = cell?.metadata?.id || cell?.id;
    if (cellId) {
        // Extract book name from cellId: "GEN 1:1" -> "GEN"
        const bookMatch = cellId.match(/^([^\s]+)/);
        if (bookMatch) {
            return bookMatch[1];
        }
    }

    return null;
}

/**
 * Gets the localized book name from a book abbreviation.
 * Returns the abbreviation itself if no localized name is found.
 */
function getLocalizedBookName(bookAbbr: string): string {
    if (!bookAbbr) return bookAbbr;

    const bookInfo = (bibleData as any[]).find((book) => book.abbr === bookAbbr);
    return bookInfo?.name || bookAbbr;
}

/**
 * Creates a milestone cell with book name and chapter number derived from the cell below it.
 * Format: "BookName ChapterNumber" (e.g., "Isaiah 1")
 * @param cell - The cell to derive chapter information from
 * @param milestoneIndex - The index of the milestone (1-indexed)
 * @param uuid - Optional UUID to use for the milestone cell. If not provided, generates a new one.
 */
async function createMilestoneCell(cell: any, milestoneIndex: number, uuid?: string): Promise<any> {
    const cellUuid = uuid || randomUUID();
    const chapterNumber = extractChapterFromCell(cell, milestoneIndex);
    const currentTimestamp = Date.now();
    const author = await getCurrentUserName();

    // Extract book name from cell
    const bookAbbr = extractBookNameFromCell(cell);
    const bookName = bookAbbr ? getLocalizedBookName(bookAbbr) : null;

    // Combine book name and chapter number, or use just chapter number if no book name found
    const milestoneValue = bookName ? `${bookName} ${chapterNumber}` : chapterNumber;

    // Create initial edit entry similar to source file cells
    const initialEdit = {
        editMap: EditMapUtils.value(),
        value: milestoneValue,
        timestamp: currentTimestamp - 1000, // Ensure it's before any user edits
        type: EditType.INITIAL_IMPORT,
        author: author,
        validatedBy: []
    };

    return {
        kind: 2, // vscode.NotebookCellKind.Code
        languageId: "html",
        value: milestoneValue,
        metadata: {
            id: cellUuid,
            type: CodexCellTypes.MILESTONE,
            edits: [initialEdit]
        }
    };
}


/**
 * Migrates milestone cells for a source/codex file pair together.
 * Ensures milestone cells share the same IDs between source and codex files.
 * Inserts milestone cells at the start of each file and before each new chapter.
 * Handles orphaned files (when one file doesn't exist) by processing the existing file.
 * @param sourceUri - URI of the source file (null if file doesn't exist)
 * @param codexUri - URI of the codex file (null if file doesn't exist)
 * @returns Object indicating which files were migrated
 */
async function migrateMilestoneCellsForFilePair(
    sourceUri: vscode.Uri | null,
    codexUri: vscode.Uri | null
): Promise<{ sourceMigrated: boolean; codexMigrated: boolean; }> {
    const result = { sourceMigrated: false, codexMigrated: false };

    try {
        // Helper function to safely read a file
        const safeReadFile = async (uri: vscode.Uri): Promise<Uint8Array | null> => {
            try {
                return await vscode.workspace.fs.readFile(uri);
            } catch (error: unknown) {
                if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                    // File doesn't exist - this is expected for orphaned files
                    return null;
                }
                // Log unexpected errors
                console.error(`Error reading file ${uri.fsPath}:`, error);
                return null;
            }
        };

        // Read both files (if they exist)
        const [sourceContent, codexContent] = await Promise.all([
            sourceUri ? safeReadFile(sourceUri) : Promise.resolve(null),
            codexUri ? safeReadFile(codexUri) : Promise.resolve(null)
        ]);

        const serializer = new CodexContentSerializer();
        const token = new vscode.CancellationTokenSource().token;

        // Deserialize both notebooks
        const sourceNotebookData: any = sourceContent
            ? await serializer.deserializeNotebook(sourceContent, token)
            : null;
        const codexNotebookData: any = codexContent
            ? await serializer.deserializeNotebook(codexContent, token)
            : null;

        const sourceCells: any[] = sourceNotebookData?.cells || [];
        const codexCells: any[] = codexNotebookData?.cells || [];

        // Check if either file already has milestone cells (idempotent check)
        const sourceHasMilestones = sourceCells.some(
            (cell) => cell.metadata?.type === CodexCellTypes.MILESTONE
        );
        const codexHasMilestones = codexCells.some(
            (cell) => cell.metadata?.type === CodexCellTypes.MILESTONE
        );

        if (sourceHasMilestones && codexHasMilestones) {
            return result; // Already migrated
        }

        // Use source cells as the primary reference for determining chapters
        // If source file doesn't exist, use codex cells
        const primaryCells = sourceCells.length > 0 ? sourceCells : codexCells;
        if (primaryCells.length === 0) {
            return result;
        }

        // Find first cell for first milestone
        let firstCell: any | null = null;
        for (const cell of primaryCells) {
            if (cell.metadata?.id) {
                firstCell = cell;
                break;
            }
        }

        if (!firstCell) {
            return result;
        }

        // Extract basename for deterministic UUID generation
        // Use sourceUri first, fallback to codexUri, then extract basename without extension
        const filePath = sourceUri?.fsPath || codexUri?.fsPath || '';
        const basename = filePath ? path.basename(filePath, path.extname(filePath)) : 'unknown';

        // Map to store UUIDs for each chapter to ensure consistency across source and codex
        const chapterUuids = new Map<string, string>();

        // Track milestone index (1-indexed)
        let milestoneIndex = 1;

        // Track seen chapters to avoid duplicates
        const seenChapters = new Set<string>();

        // First, scan primary cells to determine all chapters and generate UUIDs for each
        // Also track milestone index for each chapter
        const chapterMilestoneIndex = new Map<string, number>();

        // Handle first milestone
        const firstCellId = firstCell.metadata?.id;
        const firstChapter = firstCellId ? extractChapterFromCellId(firstCellId) : null;
        const firstMilestoneKey = firstChapter || `milestone-${milestoneIndex}`;
        const firstMilestoneUuid = await generateCellIdFromHash(`milestone:${basename}:${firstMilestoneKey}`);
        if (firstChapter) {
            chapterUuids.set(firstChapter, firstMilestoneUuid);
            chapterMilestoneIndex.set(firstChapter, milestoneIndex);
            seenChapters.add(firstChapter);
        } else {
            // Use milestone index as key if no chapter found
            chapterUuids.set(`milestone-${milestoneIndex}`, firstMilestoneUuid);
            chapterMilestoneIndex.set(`milestone-${milestoneIndex}`, milestoneIndex);
        }
        milestoneIndex++;

        // Scan remaining primary cells to find other chapters
        for (const primaryCell of primaryCells) {
            const cellId = primaryCell.metadata?.id;
            if (cellId) {
                const chapter = extractChapterFromCellId(cellId);
                if (chapter && !seenChapters.has(chapter)) {
                    const chapterUuid = await generateCellIdFromHash(`milestone:${basename}:${chapter}`);
                    chapterUuids.set(chapter, chapterUuid);
                    chapterMilestoneIndex.set(chapter, milestoneIndex);
                    seenChapters.add(chapter);
                    milestoneIndex++;
                }
            }
        }

        // Build new cell arrays with milestone cells
        const newSourceCells: any[] = [];
        const newCodexCells: any[] = [];

        // Insert first milestone cell at the beginning (using same UUID for both)
        if (!sourceHasMilestones && sourceNotebookData) {
            const sourceFirstCell = sourceCells.find(c => c.metadata?.id) || sourceCells[0] || firstCell;
            const firstMilestoneIdx = firstChapter
                ? chapterMilestoneIndex.get(firstChapter)
                : chapterMilestoneIndex.get(`milestone-1`);
            newSourceCells.push(await createMilestoneCell(
                sourceFirstCell,
                firstMilestoneIdx || 1,
                firstMilestoneUuid
            ));
        }
        if (!codexHasMilestones && codexNotebookData) {
            const codexFirstCell = codexCells.find(c => c.metadata?.id) || codexCells[0] || firstCell;
            const firstMilestoneIdx = firstChapter
                ? chapterMilestoneIndex.get(firstChapter)
                : chapterMilestoneIndex.get(`milestone-1`);
            newCodexCells.push(await createMilestoneCell(
                codexFirstCell,
                firstMilestoneIdx || 1,
                firstMilestoneUuid
            ));
        }

        // Process source cells and insert milestones (skip first milestone as it's already added)
        if (!sourceHasMilestones && sourceNotebookData) {
            const sourceSeenChapters = new Set<string>();
            // Mark first chapter as seen since we already added its milestone
            if (firstChapter) {
                sourceSeenChapters.add(firstChapter);
            }

            for (const cell of sourceCells) {
                const cellId = cell.metadata?.id;
                if (cellId) {
                    const chapter = extractChapterFromCellId(cellId);
                    if (chapter && !sourceSeenChapters.has(chapter)) {
                        // Insert milestone before this chapter
                        const milestoneUuid = chapterUuids.get(chapter);
                        const milestoneIdx = chapterMilestoneIndex.get(chapter);
                        if (milestoneUuid && milestoneIdx !== undefined) {
                            newSourceCells.push(await createMilestoneCell(cell, milestoneIdx, milestoneUuid));
                        }
                        sourceSeenChapters.add(chapter);
                    }
                }
                newSourceCells.push(cell);
            }
        } else if (sourceNotebookData) {
            // Source already has milestones, just copy all cells
            newSourceCells.push(...sourceCells);
        }

        // Process codex cells and insert milestones using the same UUIDs (skip first milestone as it's already added)
        if (!codexHasMilestones && codexNotebookData) {
            const codexSeenChapters = new Set<string>();
            // Mark first chapter as seen since we already added its milestone
            if (firstChapter) {
                codexSeenChapters.add(firstChapter);
            }

            for (const cell of codexCells) {
                const cellId = cell.metadata?.id;
                if (cellId) {
                    const chapter = extractChapterFromCellId(cellId);
                    if (chapter && !codexSeenChapters.has(chapter)) {
                        // Insert milestone before this chapter using the same UUID and index as source
                        const milestoneUuid = chapterUuids.get(chapter);
                        const milestoneIdx = chapterMilestoneIndex.get(chapter);
                        if (milestoneUuid && milestoneIdx !== undefined) {
                            newCodexCells.push(await createMilestoneCell(cell, milestoneIdx, milestoneUuid));
                        }
                        codexSeenChapters.add(chapter);
                    }
                }
                newCodexCells.push(cell);
            }
        } else if (codexNotebookData) {
            // Codex already has milestones, just copy all cells
            newCodexCells.push(...codexCells);
        }

        // If source file exists and was modified, save it
        if (!sourceHasMilestones && sourceNotebookData && newSourceCells.length > 0 && sourceUri) {
            sourceNotebookData.cells = newSourceCells;
            const updatedSourceContent = await serializer.serializeNotebook(sourceNotebookData, token);
            await vscode.workspace.fs.writeFile(sourceUri, updatedSourceContent);
            result.sourceMigrated = true;
        }

        // If codex file exists and was modified, save it
        if (!codexHasMilestones && codexNotebookData && newCodexCells.length > 0 && codexUri) {
            codexNotebookData.cells = newCodexCells;
            const updatedCodexContent = await serializer.serializeNotebook(codexNotebookData, token);
            await vscode.workspace.fs.writeFile(codexUri, updatedCodexContent);
            result.codexMigrated = true;
        }

        return result;
    } catch (error) {
        const sourcePath = sourceUri?.fsPath || "none";
        const codexPath = codexUri?.fsPath || "none";
        console.error(`Error migrating milestone cells for file pair ${sourcePath} / ${codexPath}:`, error);
        return result;
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

        if (codexFiles.length === 0 && sourceFiles.length === 0) {
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

        // Create a map to match source and codex files by basename
        const sourceFileMap = new Map<string, vscode.Uri>();
        const codexFileMap = new Map<string, vscode.Uri>();
        const processedPairs = new Set<string>();

        // Index source files by basename
        for (const sourceFile of sourceFiles) {
            const basename = path.basename(sourceFile.fsPath, ".source");
            sourceFileMap.set(basename, sourceFile);
        }

        // Index codex files by basename
        for (const codexFile of codexFiles) {
            const basename = path.basename(codexFile.fsPath, ".codex");
            codexFileMap.set(basename, codexFile);
        }

        // Collect file pairs and orphaned files
        const filePairs: Array<{ sourceUri: vscode.Uri | null; codexUri: vscode.Uri | null; basename: string; }> = [];
        const allBasenames = new Set([...sourceFileMap.keys(), ...codexFileMap.keys()]);

        for (const basename of allBasenames) {
            const sourceUri = sourceFileMap.get(basename) || null;
            const codexUri = codexFileMap.get(basename) || null;
            filePairs.push({ sourceUri, codexUri, basename });
        }

        let processedFiles = 0;
        let migratedFiles = 0;

        // Process file pairs with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Adding milestone cells",
                cancellable: false
            },
            async (progress) => {
                for (let i = 0; i < filePairs.length; i++) {
                    const { sourceUri, codexUri, basename } = filePairs[i];
                    progress.report({
                        message: `Processing ${basename}`,
                        increment: (100 / filePairs.length)
                    });

                    try {
                        // Always use pair-based migration to ensure consistent UUIDs
                        // This handles both paired files and orphaned files
                        const result = await migrateMilestoneCellsForFilePair(sourceUri, codexUri);
                        processedFiles += (result.sourceMigrated ? 1 : 0) + (result.codexMigrated ? 1 : 0);
                        if (result.sourceMigrated || result.codexMigrated) {
                            migratedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error processing ${basename}:`, error);
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

/**
 * Migration: Add globalReferences array to content cells.
 * For each content cell (excluding STYLE, PARATEXT, MILESTONE), adds
 * metadata.data.globalReferences = [cellId] if it doesn't already exist.
 * 
 * This migration is idempotent - it skips cells that already have globalReferences.
 */
export const migration_addGlobalReferences = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "globalReferencesMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Global references migration already completed, skipping");
            return;
        }

        console.log("Running global references migration...");

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
            console.log("No codex or source files found, skipping global references migration");
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
                title: "Adding global references to cells",
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
                        const wasMigrated = await migrateGlobalReferencesForFile(file);
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

        console.log(`Global references migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Global references migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running global references migration:", error);
    }
};

/**
 * Processes a single file to add globalReferences to content cells.
 * Returns true if the file was modified, false otherwise.
 */
export async function migrateGlobalReferencesForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        let hasChanges = false;

        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const cellType = md.type;
            const cellId = md.id;

            // Skip if cell doesn't have an ID
            if (!cellId) {
                continue;
            }

            // Skip STYLE, PARATEXT, and MILESTONE cells (only process content cells)
            if (cellType === CodexCellTypes.STYLE ||
                cellType === CodexCellTypes.PARATEXT ||
                cellType === CodexCellTypes.MILESTONE) {
                continue;
            }

            // Ensure metadata.data exists
            if (!md.data) {
                md.data = {};
            }

            // Skip if globalReferences already exists
            if (md.data.globalReferences !== undefined) {
                continue;
            }

            // Add globalReferences array with the cell's ID
            md.data.globalReferences = [cellId];
            cell.metadata = md;
            hasChanges = true;
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
        console.error(`Error migrating global references for ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Migration: Convert all cell IDs to UUID format using SHA-256 hash of original ID.
 * For child cells (those with IDs containing ':' separators), adds metadata.parentId field.
 * Preserves metadata.data.globalReferences array unchanged.
 * 
 * This migration is idempotent - it skips cells that already have UUID format IDs.
 */
export const migration_cellIdsToUuid = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Check if migration has already been run
        const migrationKey = "cellIdsToUuidMigrationCompleted";
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let hasMigrationRun = false;

        try {
            hasMigrationRun = config.get(migrationKey, false);
        } catch (e) {
            // Setting might not be registered yet; fall back to workspaceState
            hasMigrationRun = !!context?.workspaceState.get<boolean>(migrationKey);
        }

        if (hasMigrationRun) {
            console.log("Cell IDs to UUID migration already completed, skipping");
            return;
        }

        console.log("Running cell IDs to UUID migration...");

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
            console.log("No codex or source files found, skipping cell IDs to UUID migration");
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
                title: "Migrating cell IDs to UUID format",
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
                        const wasMigrated = await migrateCellIdsToUuidForFile(file);
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

        console.log(`Cell IDs to UUID migration completed: ${processedFiles} files processed, ${migratedFiles} files migrated`);
        if (migratedFiles > 0) {
            vscode.window.showInformationMessage(
                `Cell IDs to UUID migration complete: ${migratedFiles} files updated`
            );
        }

    } catch (error) {
        console.error("Error running cell IDs to UUID migration:", error);
    }
};

/**
 * Processes a single file to convert cell IDs to UUID format.
 * Returns true if the file was modified, false otherwise.
 */
export async function migrateCellIdsToUuidForFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        let hasChanges = false;

        // First pass: check if file needs migration (all cells already have UUIDs)
        let needsMigration = false;
        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const cellId = md.id;
            if (cellId && !isUuidFormat(cellId)) {
                needsMigration = true;
                break;
            }
        }

        if (!needsMigration) {
            return false; // Already migrated
        }

        // Second pass: create a map of original IDs to UUIDs for all cells
        const idToUuidMap = new Map<string, string>();

        // Build the map first by processing all cells
        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const originalCellId = md.id;

            if (!originalCellId) continue;

            // Skip if already in UUID format
            if (isUuidFormat(originalCellId)) {
                continue;
            }

            // Generate UUID from original ID
            const newUuid = await generateCellIdFromHash(originalCellId);
            idToUuidMap.set(originalCellId, newUuid);

            // Also generate UUIDs for parent IDs of child cells
            const cellIdParts = originalCellId.split(":");
            if (cellIdParts.length > 2) {
                const parentOriginalId = cellIdParts.slice(0, 2).join(":");
                if (!idToUuidMap.has(parentOriginalId)) {
                    const parentUuid = await generateCellIdFromHash(parentOriginalId);
                    idToUuidMap.set(parentOriginalId, parentUuid);
                }
            }
        }

        // Third pass: update cell IDs and add parentId for child cells
        for (const cell of cells) {
            const md: any = cell.metadata || {};
            const originalCellId = md.id;

            if (!originalCellId) continue;

            // Skip if already in UUID format
            if (isUuidFormat(originalCellId)) {
                continue;
            }

            // Get UUID from map
            const newUuid = idToUuidMap.get(originalCellId);
            if (!newUuid) {
                continue; // Should not happen, but skip if it does
            }

            // Update cell ID
            md.id = newUuid;
            hasChanges = true;

            // Check if this is a child cell (has more than 2 parts when split by ':')
            // Examples: "GEN 1:1:cue-..." or "TheChosen-201-en-SingleSpeaker 1:cue-32.783-34.785:..."
            const cellIdParts = originalCellId.split(":");
            if (cellIdParts.length > 2) {
                // This is a child cell - extract parent ID
                // Parent ID is the first two parts joined by ':'
                const parentOriginalId = cellIdParts.slice(0, 2).join(":");
                const parentUuid = idToUuidMap.get(parentOriginalId);

                if (parentUuid) {
                    // Add parentId to metadata
                    md.parentId = parentUuid;
                }
            }

            cell.metadata = md;
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
        console.error(`Error migrating cell IDs to UUID for ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Merges duplicate cells in a notebook file using the same logic as sync and save.
 * Cells with the same ID are merged into one cell with combined edit history.
 * Returns true if any changes were made.
 */
async function mergeDuplicateCellsInFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileContent,
            new vscode.CancellationTokenSource().token
        );

        const cells: any[] = notebookData.cells || [];
        if (cells.length === 0) return false;

        // Group cells by ID to find duplicates
        const cellsById = new Map<string, any[]>();
        for (const cell of cells) {
            const cellId = cell.metadata?.id;
            if (!cellId) continue;

            if (!cellsById.has(cellId)) {
                cellsById.set(cellId, []);
            }
            cellsById.get(cellId)!.push(cell);
        }

        // Find duplicate IDs
        const duplicateIds: string[] = [];
        for (const [cellId, cellList] of cellsById.entries()) {
            if (cellList.length > 1) {
                duplicateIds.push(cellId);
            }
        }

        if (duplicateIds.length === 0) {
            return false; // No duplicates found
        }

        console.log(
            `[Cleanup] Found ${duplicateIds.length} duplicate cell ID(s) in ${fileUri.fsPath}: ${duplicateIds.join(", ")}`
        );

        // Merge duplicates: combine cells with the same ID into one cell
        // Use the same logic as resolveCodexCustomMerge to combine edit histories
        const mergedCells: any[] = [];
        const processedIds = new Set<string>();

        for (const cell of cells) {
            const cellId = cell.metadata?.id;
            if (!cellId) {
                // Cell without ID - keep as is
                mergedCells.push(cell);
                continue;
            }

            if (processedIds.has(cellId)) {
                // Already processed this ID - skip duplicate
                continue;
            }

            processedIds.add(cellId);
            const duplicateCells = cellsById.get(cellId)!;

            if (duplicateCells.length === 1) {
                // No duplicate, just add it
                mergedCells.push(duplicateCells[0]);
            } else {
                // Merge duplicates: combine edit histories and metadata
                // Use the same logic as resolveCodexCustomMerge
                const mergedCell = { ...duplicateCells[0] };

                // Combine all edits from all duplicate cells
                const allEdits: any[] = [];
                for (const cell of duplicateCells) {
                    if (cell.metadata?.edits) {
                        allEdits.push(...cell.metadata.edits);
                    }
                }

                // Sort by timestamp and deduplicate (same logic as resolveCodexCustomMerge)
                allEdits.sort((a, b) => a.timestamp - b.timestamp);
                const editMap = new Map<string, any>();
                allEdits.forEach((edit) => {
                    if (edit.editMap && Array.isArray(edit.editMap)) {
                        const editMapKey = edit.editMap.join('.');
                        const key = `${edit.timestamp}:${editMapKey}:${edit.value}`;
                        if (!editMap.has(key)) {
                            editMap.set(key, edit);
                        }
                    }
                });

                const uniqueEdits = Array.from(editMap.values()).sort((a, b) => a.timestamp - b.timestamp);

                if (!mergedCell.metadata) {
                    mergedCell.metadata = { id: cellId };
                }
                mergedCell.metadata.edits = uniqueEdits;

                // Merge other metadata fields (keep non-null values, prefer later cells)
                for (let i = 1; i < duplicateCells.length; i++) {
                    const cell = duplicateCells[i];
                    if (cell.metadata) {
                        Object.keys(cell.metadata).forEach((key) => {
                            if (key !== 'id' && key !== 'edits' && cell.metadata[key] != null) {
                                // Prefer non-null values from later cells
                                if (mergedCell.metadata[key] == null ||
                                    (typeof cell.metadata[key] === 'string' && cell.metadata[key].length > 0)) {
                                    mergedCell.metadata[key] = cell.metadata[key];
                                }
                            }
                        });
                    }
                }

                mergedCells.push(mergedCell);
            }
        }

        // Create final notebook with merged cells
        const finalNotebook = {
            ...notebookData,
            cells: mergedCells,
        };

        const finalContent = formatJsonForNotebookFile(finalNotebook);

        // Write back using atomic write
        await atomicWriteUriText(fileUri, normalizeNotebookFileText(finalContent));

        console.log(`[Cleanup] Successfully merged duplicate cells in ${fileUri.fsPath}`);
        return true;
    } catch (error) {
        console.error(`[Cleanup] Error merging duplicate cells in ${fileUri.fsPath}:`, error);
        return false;
    }
}

/**
 * Finds the original file path for a temp file by removing the .tmp-{timestamp}-{uuid} suffix.
 */
function getOriginalFilePathFromTemp(tempFilePath: string): string | null {
    // Pattern: filename.codex.tmp-{timestamp}-{uuid}
    // We need to extract: filename.codex

    const tmpPattern = /\.tmp-\d+-[a-f0-9-]+$/i;
    if (!tmpPattern.test(tempFilePath)) {
        return null; // Not a temp file
    }

    // Remove .tmp-{timestamp}-{uuid} suffix
    const originalPath = tempFilePath.replace(tmpPattern, '');
    return originalPath;
}

/**
 * Recovers temp files by merging them into their original files.
 * This handles the case where atomic writes were interrupted during sync or LLM saves.
 * 
 * Steps:
 * 1. Find all .tmp files
 * 2. For each temp file, merge it into the original file using resolveCodexCustomMerge
 * 3. After merging, deduplicate any duplicate cells
 * 4. Repeat step 3 as needed for each temp file that was merged
 */
export async function recoverTempFilesAndMergeDuplicates(
    context?: vscode.ExtensionContext
): Promise<{ recoveredFiles: number; mergedDuplicates: number; errors: number; }> {
    const result = {
        recoveredFiles: 0,
        mergedDuplicates: 0,
        errors: 0,
    };

    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log("[Cleanup] No workspace folders found");
            return result;
        }

        const workspaceFolder = workspaceFolders[0];

        // Find all .tmp files matching the pattern: *.tmp-{timestamp}-{uuid}
        const tmpPattern = new vscode.RelativePattern(
            workspaceFolder,
            "**/*.tmp-*-*"
        );

        const tmpFiles = await vscode.workspace.findFiles(tmpPattern);

        if (tmpFiles.length === 0) {
            console.log("[Cleanup] No temp files found to recover");
            return result;
        } else {
            console.log(`[Cleanup] Found ${tmpFiles.length} temp file(s) to recover`);
            // NOTE: this commit will only show if there is changes in the workspace
            await stageAndCommitAllWithMessage(
                workspaceFolder.uri.fsPath,
                "#528: Pre-migration checkpoint: temp file recovery"
            );
        }

        // Group temp files by their original file path
        const tempFilesByOriginal = new Map<string, vscode.Uri[]>();

        for (const tmpFile of tmpFiles) {
            const originalPath = getOriginalFilePathFromTemp(tmpFile.fsPath);
            if (!originalPath) {
                console.warn(`[Cleanup] Could not determine original file for temp file: ${tmpFile.fsPath}`);
                result.errors++;
                continue;
            }

            if (!tempFilesByOriginal.has(originalPath)) {
                tempFilesByOriginal.set(originalPath, []);
            }
            tempFilesByOriginal.get(originalPath)!.push(tmpFile);
        }

        // Process each original file and its temp files
        for (const [originalPath, tempFileUris] of tempFilesByOriginal.entries()) {
            try {
                const originalUri = vscode.Uri.file(originalPath);

                // Check if original file exists
                let originalExists = false;
                try {
                    await vscode.workspace.fs.stat(originalUri);
                    originalExists = true;
                } catch {
                    // Original file doesn't exist - this temp file might be the only version
                    console.log(`[Cleanup] Original file not found: ${originalPath}, will use temp file as original`);
                }

                // Read original file content (if it exists)
                let originalContent = "";
                if (originalExists) {
                    try {
                        const originalFileContent = await vscode.workspace.fs.readFile(originalUri);
                        originalContent = new TextDecoder("utf-8").decode(originalFileContent);
                    } catch (error) {
                        console.warn(`[Cleanup] Could not read original file ${originalPath}:`, error);
                        result.errors++;
                        continue;
                    }
                }

                // Merge each temp file into the original
                let mergedContent = originalContent;
                for (const tempUri of tempFileUris) {
                    try {
                        const tempFileContent = await vscode.workspace.fs.readFile(tempUri);
                        const tempContent = new TextDecoder("utf-8").decode(tempFileContent);

                        if (!mergedContent) {
                            // No original content, use temp file as base
                            mergedContent = tempContent;
                        } else {
                            // Merge temp file into original using the same logic as sync/save
                            mergedContent = await resolveCodexCustomMerge(mergedContent, tempContent);
                        }

                        console.log(`[Cleanup] Merged temp file ${tempUri.fsPath} into ${originalPath}`);
                    } catch (error) {
                        console.error(`[Cleanup] Error reading temp file ${tempUri.fsPath}:`, error);
                        result.errors++;
                        continue;
                    }
                }

                // Write merged content back to original file using atomic write
                await atomicWriteUriText(originalUri, normalizeNotebookFileText(mergedContent));
                result.recoveredFiles++;

                // Now merge duplicate cells in the recovered file
                let hasDuplicates = true;
                let mergeIterations = 0;
                const maxIterations = 10; // Prevent infinite loops

                while (hasDuplicates && mergeIterations < maxIterations) {
                    const hadDuplicates = await mergeDuplicateCellsInFile(originalUri);
                    if (hadDuplicates) {
                        result.mergedDuplicates++;
                        mergeIterations++;
                        console.log(
                            `[Cleanup] Merged duplicate cells in ${originalPath} (iteration ${mergeIterations})`
                        );
                    } else {
                        hasDuplicates = false;
                    }
                }

                if (mergeIterations >= maxIterations) {
                    console.warn(
                        `[Cleanup] Reached max iterations for merging duplicates in ${originalPath}`
                    );
                }

                // Delete temp files after successful merge
                for (const tempUri of tempFileUris) {
                    try {
                        await vscode.workspace.fs.delete(tempUri);
                        console.log(`[Cleanup] Deleted temp file: ${tempUri.fsPath}`);
                    } catch (error) {
                        console.warn(`[Cleanup] Could not delete temp file ${tempUri.fsPath}:`, error);
                    }
                }
            } catch (error) {
                console.error(`[Cleanup] Error processing original file ${originalPath}:`, error);
                result.errors++;
            }
        }

        await stageAndCommitAllWithMessage(
            workspaceFolder.uri.fsPath,
            "#528: Recovered temp files and merged duplicates"
        );

        console.log(
            `[Cleanup] Recovery complete: ${result.recoveredFiles} files recovered, ` +
            `${result.mergedDuplicates} duplicate merges, ${result.errors} errors`
        );

        return result;
    } catch (error) {
        console.error("[Cleanup] Error in recoverTempFilesAndMergeDuplicates:", error);
        result.errors++;
        return result;
    }
}

/**
 * Migration: Recover temp files and merge duplicate cells.
 * This migration runs once to clean up any .tmp files left behind from interrupted saves
 * and merge any duplicate cells that may have been created.
 */
export const migration_recoverTempFilesAndMergeDuplicates = async (context?: vscode.ExtensionContext) => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        console.log("Running temp files recovery and duplicate merge migration...");

        const result = await recoverTempFilesAndMergeDuplicates(context);

        console.log(
            `Temp files recovery and duplicate merge migration completed: ` +
            `${result.recoveredFiles} files recovered, ${result.mergedDuplicates} duplicate merges, ${result.errors} errors`
        );

        if (result.recoveredFiles > 0 || result.mergedDuplicates > 0) {
            vscode.window.showInformationMessage(
                `Cleanup complete: ${result.recoveredFiles} files recovered, ${result.mergedDuplicates} duplicate cells merged`
            );
        }

    } catch (error) {
        console.error("Error running temp files recovery and duplicate merge migration:", error);
    }
};
