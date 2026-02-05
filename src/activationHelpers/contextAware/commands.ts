import { NavigationWebviewProvider } from './../../providers/navigationWebview/navigationWebviewProvider';
import { getWorkSpaceUri } from "./../../utils/index";
import * as vscode from "vscode";
import { CodexKernel } from "../../controller";
import { CodexContentSerializer } from "../../serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    updateProjectNotebooksToUseCellsForVerseContent,
} from "../../utils/codexNotebookUtils";
import { jumpToCellInNotebook } from "../../utils";
import { setTargetFont } from "../../projectManager/projectInitializers";
import { CodexExportFormat, exportCodexContent } from "../../exportHandler/exportHandler";


import { createEditAnalysisProvider } from "../../providers/EditAnalysisView/EditAnalysisViewProvider";
import { registerSyncCommands } from "../../projectManager/syncManager";
import { MainMenuProvider } from "../../providers/mainMenu/mainMenuProvider";
import { getSQLiteIndexManager } from "./contentIndexes/indexes/sqliteIndexManager";
import { testProjectLoadingPerformance } from "../../test-project-loading";
import { migrateXM4aFiles, showMigrationResults } from "../../utils/audioMigration";

export async function registerCommands(context: vscode.ExtensionContext) {
    // Register the centralized sync commands
    registerSyncCommands(context);

    // Prevent Save As for .codex and .source files to avoid creating duplicates
    const preventSaveAsCommand = vscode.commands.registerCommand(
        "codex-editor.preventSaveAs",
        () => {
            vscode.window.showInformationMessage(
                "Save As is disabled for .codex and .source files to prevent creating duplicates."
            );
        }
    );

    // Performance testing command for project loading
    const testProjectLoadingPerformanceCommand = vscode.commands.registerCommand(
        "codex-editor.testProjectLoadingPerformance",
        testProjectLoadingPerformance
    );

    // Register command to navigate to main menu
    const navigateToMainMenuCommand = vscode.commands.registerCommand(
        "codex-editor.navigateToMainMenu",
        async () => {
            try {
                // Focus the main menu view
                await vscode.commands.executeCommand(`${NavigationWebviewProvider.viewType}.focus`, true);
            } catch (error) {
                console.error("Error focusing main menu view:", error);
                vscode.window.showErrorMessage(`Error focusing main menu view: ${error}`);
            }
        }
    );



    const analyzeEditsCommand = vscode.commands.registerCommand(
        "codex-editor-extension.analyzeEdits",
        async () => {
            try {
                const provider = createEditAnalysisProvider(context.extensionUri);
                await provider.show();
            } catch (error) {
                console.error("Failed to analyze edits:", error);
                await vscode.window.showErrorMessage("Failed to analyze edit history");
            }
        }
    );

    const refreshAllWebviewsCommand = vscode.commands.registerCommand(
        "codex-editor.refreshAllWebviews",
        async () => {
            try {
                console.log("Refreshing all webviews due to metadata changes");

                // Import GlobalProvider here to avoid circular dependencies
                const { GlobalProvider } = await import("../../globalProvider");
                const globalProvider = GlobalProvider.getInstance();

                // Send refresh message to all registered webview providers
                globalProvider.postMessageToAllWebviews({
                    command: "refreshMetadata",
                    content: { type: "cellId", cellId: "refresh-all" }
                });

                // Also refresh CodexCellEditor instances by accessing the registered provider
                // The CodexCellEditorProvider should handle this message and refresh all open editor instances
                globalProvider.postMessageToAllProviders({
                    command: "refreshAllEditors",
                    destination: "provider"
                });

            } catch (error) {
                console.error("Error refreshing webviews:", error);
            }
        }
    );

    const notebookSerializer = vscode.workspace.registerNotebookSerializer(
        NOTEBOOK_TYPE,
        new CodexContentSerializer(),
        { transientOutputs: true }
    );

    const codexKernel = new CodexKernel();

    const openChapterCommand = vscode.commands.registerCommand(
        "codex-editor-extension.openSection",
        async (notebookPath: string, sectionMarker: string) => {
            try {
                jumpToCellInNotebook(context, notebookPath, sectionMarker);
            } catch (error) {
                console.error(`Failed to open section: ${error}`);
            }
        }
    );

    const openFileCommand = vscode.commands.registerCommand(
        "codex-notebook-extension.openFile",
        async (resourceUri: vscode.Uri) => {
            try {
                const document = await vscode.workspace.openTextDocument(resourceUri);
                await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
            } catch (error) {
                console.error(`Failed to open document: ${error}`);
            }
        }
    );

    const openDictionaryCommand = vscode.commands.registerCommand(
        "codex-editor-extension.openDictionaryFile",
        async () => {
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceUri) {
                vscode.window.showErrorMessage(
                    "No workspace found. Please open a workspace first."
                );
                return;
            }
            const dictionaryUri = vscode.Uri.joinPath(workspaceUri, "files", "project.dictionary");
            try {
                // Ensure the files directory and dictionary file exist
                const filesUri = vscode.Uri.joinPath(workspaceUri, "files");
                await vscode.workspace.fs.createDirectory(filesUri);
                try {
                    await vscode.workspace.fs.stat(dictionaryUri);
                } catch {
                    // Create the file if it doesn't exist
                    await vscode.workspace.fs.writeFile(dictionaryUri, new Uint8Array([]));
                }
                await vscode.commands.executeCommand("vscode.open", dictionaryUri);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open dictionary: ${error}`);
            }
        }
    );

    const createCodexNotebookCommand = vscode.commands.registerCommand(
        "codex-editor-extension.createCodexNotebook",
        async () => {
            const doc = await createCodexNotebook();
            await vscode.window.showNotebookDocument(doc);
        }
    );

    const updateProjectNotebooksToUseCellsForVerseContentCommand = vscode.commands.registerCommand(
        "codex-editor-extension.updateProjectNotebooksToUseCellsForVerseContent",
        updateProjectNotebooksToUseCellsForVerseContent
    );

    const setEditorFontCommand = vscode.commands.registerCommand(
        "codex-editor-extension.setEditorFontToTargetLanguage",
        setTargetFont
    );

    const exportCodexContentCommand = vscode.commands.registerCommand(
        "codex-editor-extension.exportCodexContent",
        async ({
            format,
            userSelectedPath,
            filesToExport,
            options,
        }: {
            format: CodexExportFormat;
            userSelectedPath: string;
            filesToExport: string[];
            options?: { skipValidation?: boolean; removeIds?: boolean; };
        }) => {
            await exportCodexContent(format, userSelectedPath, filesToExport, options);
        }
    );


    const uploadSourceFolderCommand = vscode.commands.registerCommand(
        "codex-editor-extension.uploadSourceFolder",
        async (folderName: string) => {
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select USFM Folder",
            });

            if (folderUri && folderUri[0]) {
                await vscode.commands.executeCommand(
                    "codex-editor-extension.importSourceText",
                    folderUri[0]
                );
            }
        }
    );

    const uploadTranslationFolderCommand = vscode.commands.registerCommand(
        "codex-editor-extension.uploadTranslationFolder",
        async (folderName: string, sourceFileName: string) => {
            // Implement translation folder upload logic here
            vscode.window.showInformationMessage("Translation folder upload not yet implemented");
        }
    );





    const deduplicateSourceCellsCommand = vscode.commands.registerCommand(
        "codex-editor-extension.deduplicateSourceCells",
        async () => {
            try {
                const response = await vscode.window.showWarningMessage(
                    "This will remove duplicate source cells from the database. The operation is safe and will only remove duplicates from 'unknown' files when proper source files exist. Continue?",
                    "Yes, Clean Up Duplicates",
                    "Cancel"
                );

                if (response !== "Yes, Clean Up Duplicates") {
                    return;
                }

                const indexManager = getSQLiteIndexManager();
                if (!indexManager) {
                    vscode.window.showErrorMessage("Search index manager not available");
                    return;
                }

                vscode.window.showInformationMessage("Deduplicating source cells...");

                const result = await indexManager.deduplicateSourceCells();

                if (result.duplicatesRemoved > 0) {
                    vscode.window.showInformationMessage(
                        `✅ Cleaned up ${result.duplicatesRemoved} duplicate source cells affecting ${result.cellsAffected} unique cells. ${result.unknownFileRemoved ? 'Unknown file entry removed.' : ''}`
                    );
                } else {
                    vscode.window.showInformationMessage("No duplicate source cells found");
                }
            } catch (error) {
                console.error("Error deduplicating source cells:", error);
                vscode.window.showErrorMessage(`Failed to deduplicate source cells: ${error}`);
            }
        }
    );

    const setGlobalFontSizeCommand = vscode.commands.registerCommand(
        "codex-editor.setGlobalFontSize",
        async () => {
            try {
                // Get the main menu provider instance from the global provider
                const { GlobalProvider } = await import("../../globalProvider");
                const globalProvider = GlobalProvider.getInstance();

                // Get the registered main menu provider
                const providers = (globalProvider as any).providers;
                const mainMenuProvider = providers?.get("codex-editor.mainMenu");

                if (mainMenuProvider && typeof mainMenuProvider.handleSetGlobalFontSize === 'function') {
                    // Directly call the method on the main menu provider
                    await mainMenuProvider.handleSetGlobalFontSize();
                } else {
                    // Fallback: navigate to main menu and show instructions
                    await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                    vscode.window.showInformationMessage("Please use the 'Set Global Font Size' button in the Main Menu panel.");
                }
            } catch (error) {
                console.error("Error executing global font size command:", error);
                vscode.window.showErrorMessage(`Failed to set global font size: ${error}`);
            }
        }
    );

    const setGlobalTextDirectionCommand = vscode.commands.registerCommand(
        "codex-editor.setGlobalTextDirection",
        async () => {
            try {
                // Get the main menu provider instance from the global provider
                const { GlobalProvider } = await import("../../globalProvider");
                const globalProvider = GlobalProvider.getInstance();

                // Get the registered main menu provider
                const providers = (globalProvider as any).providers;
                const mainMenuProvider = providers?.get("codex-editor.mainMenu");

                if (mainMenuProvider && typeof mainMenuProvider.handleSetGlobalTextDirection === 'function') {
                    // Directly call the method on the main menu provider
                    await mainMenuProvider.handleSetGlobalTextDirection();
                } else {
                    // Fallback: navigate to main menu and show instructions
                    await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                    vscode.window.showInformationMessage("Please use the 'Set Global Text Direction' button in the Main Menu panel.");
                }
            } catch (error) {
                console.error("Error executing global text direction command:", error);
                vscode.window.showErrorMessage(`Failed to set global text direction: ${error}`);
            }
        }
    );

    const setGlobalLineNumbersCommand = vscode.commands.registerCommand(
        "codex-editor.setGlobalLineNumbers",
        async () => {
            try {
                // Get the main menu provider instance from the global provider
                const { GlobalProvider } = await import("../../globalProvider");
                const globalProvider = GlobalProvider.getInstance();

                // Get the registered main menu provider
                const providers = (globalProvider as any).providers;
                const mainMenuProvider = providers?.get("codex-editor.mainMenu");

                if (mainMenuProvider && typeof mainMenuProvider.handleSetGlobalLineNumbers === 'function') {
                    // Directly call the method on the main menu provider
                    await mainMenuProvider.handleSetGlobalLineNumbers();
                } else {
                    // Fallback: navigate to main menu and show instructions
                    await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                    vscode.window.showInformationMessage("Please use the 'Set Global Line Numbers' button in the Main Menu panel.");
                }
            } catch (error) {
                console.error("Error executing global line numbers command:", error);
                vscode.window.showErrorMessage(`Failed to set global line numbers: ${error}`);
            }
        }
    );

    // Audio migration command to rename .x-m4a files to .m4a
    const migrateAudioFilesCommand = vscode.commands.registerCommand(
        "codex-editor.migrateAudioFiles",
        async () => {
            try {
                const choice = await vscode.window.showWarningMessage(
                    'This will rename all .x-m4a audio files to .m4a format. This operation cannot be undone. Continue?',
                    { modal: true },
                    'Yes, Migrate',
                    'Cancel'
                );

                if (choice !== 'Yes, Migrate') {
                    return;
                }

                const result = await migrateXM4aFiles();
                showMigrationResults(result);
            } catch (error) {
                console.error("Error migrating audio files:", error);
                vscode.window.showErrorMessage(`Failed to migrate audio files: ${error}`);
            }
        }
    );

    context.subscriptions.push(
        preventSaveAsCommand,
        notebookSerializer,
        codexKernel,
        openChapterCommand,
        openFileCommand,
        openDictionaryCommand,
        createCodexNotebookCommand,
        setEditorFontCommand,
        exportCodexContentCommand,
        updateProjectNotebooksToUseCellsForVerseContentCommand,
        uploadSourceFolderCommand,
        uploadTranslationFolderCommand,

        analyzeEditsCommand,
        navigateToMainMenuCommand,
        refreshAllWebviewsCommand,
        setGlobalFontSizeCommand,
        setGlobalTextDirectionCommand,
        setGlobalLineNumbersCommand,

        deduplicateSourceCellsCommand,
        testProjectLoadingPerformanceCommand,
        migrateAudioFilesCommand,

    );
}
