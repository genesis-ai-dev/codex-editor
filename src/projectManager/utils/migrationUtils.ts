import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "@/serializer";
import { vrefData } from "@/utils/verseRefUtils/verseData";
import { EditMapUtils } from "@/utils/editMapUtils";
import { EditType } from "../../../types/enums";
import type { ValidationEntry } from "../../../types";

// FIXME: move notebook format migration here

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
            console.log("Timestamps data migration already completed, skipping");
            return;
        }

        console.log("Running timestamps data migration...");

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
            const legacyType = (md as any).type; // some importers may have put type at top too

            const hasLegacyTs = legacyStart !== undefined || legacyEnd !== undefined || legacyFormat !== undefined || legacyOriginalText !== undefined;

            if (hasLegacyTs) {
                // Only set if not already present in data
                if (legacyStart !== undefined && data.startTime === undefined) data.startTime = legacyStart;
                if (legacyEnd !== undefined && data.endTime === undefined) data.endTime = legacyEnd;
                if (legacyFormat !== undefined && data.format === undefined) data.format = legacyFormat;
                if (legacyOriginalText !== undefined && data.originalText === undefined) data.originalText = legacyOriginalText;
                if (legacyType !== undefined && data.type === undefined) data.type = legacyType;

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
