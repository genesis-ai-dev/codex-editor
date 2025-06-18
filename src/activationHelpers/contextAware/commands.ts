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
import { DownloadBibleTransaction } from "../../transactions/DownloadBibleTransaction";
import { getExtendedEbibleMetadataByLanguageNameOrCode } from "../../utils/ebible/ebibleCorpusUtils";
import { createEditAnalysisProvider } from "../../providers/EditAnalysisView/EditAnalysisViewProvider";
import { registerSyncCommands } from "../../projectManager/syncManager";
import { MainMenuProvider } from "../../providers/mainMenu/mainMenuProvider";
import { getSQLiteIndexManager } from "./contentIndexes/indexes/sqliteIndexManager";
import { testProjectLoadingPerformance } from "../../test-project-loading";

export async function registerCommands(context: vscode.ExtensionContext) {
    // Register the centralized sync commands
    registerSyncCommands(context);

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
                await vscode.commands.executeCommand(`${MainMenuProvider.viewType}.focus`, true);
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
        await setTargetFont
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
            options?: { skipValidation?: boolean; };
        }) => {
            await exportCodexContent(format, userSelectedPath, filesToExport, options);
        }
    );



    const openSourceUploadCommand = vscode.commands.registerCommand(
        "codexNotebookTreeView.openSourceFile",
        async (treeNode: Node & { sourceFileUri?: vscode.Uri; }) => {
            if ("sourceFileUri" in treeNode && treeNode.sourceFileUri) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    try {
                        await vscode.commands.executeCommand(
                            "vscode.openWith",
                            treeNode.sourceFileUri,
                            "codex.cellEditor",
                            { viewColumn: vscode.ViewColumn.Beside }
                        );
                    } catch (error) {
                        console.error(`Failed to open source file: ${error}`);
                        vscode.window.showErrorMessage(
                            `Failed to open source file: ${JSON.stringify(treeNode)}`
                        );
                    }
                } else {
                    console.error(
                        "No workspace folder found, aborting codexNotebookTreeView.openSourceFile."
                    );
                }
            }
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

    // Add to your command registration
    const downloadSourceBibleCommand = vscode.commands.registerCommand(
        "codex-editor-extension.downloadSourceBible",
        async () => {
            // Show quick pick UI only when called directly from command palette
            const allEbibleBibles = getExtendedEbibleMetadataByLanguageNameOrCode();
            const languages = Array.from(
                new Set(allEbibleBibles.map((b) => b.languageName))
            ).filter(Boolean) as string[];

            const selectedLanguage = await vscode.window.showQuickPick(languages, {
                placeHolder: "Select a language",
            });

            if (selectedLanguage) {
                const biblesForLanguage = allEbibleBibles.filter(
                    (b) => b.languageName === selectedLanguage
                );
                const bibleItems = biblesForLanguage.map((b) => ({
                    label: b.shortTitle || b.title,
                    description: `${(b.OTbooks || 0) + (b.NTbooks || 0)} books`,
                    id: b.translationId,
                }));

                const selectedBible = await vscode.window.showQuickPick(
                    bibleItems as vscode.QuickPickItem[],
                    { placeHolder: "Select a Bible translation" }
                );

                if (selectedBible && "id" in selectedBible) {
                    const ebibleMetadata = biblesForLanguage.find(
                        (b) => b.translationId === selectedBible.id
                    );
                    const transaction = new DownloadBibleTransaction(false);

                    try {
                        await transaction.prepare();
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Downloading Bible",
                                cancellable: true,
                            },
                            async (progress, token) => {
                                await transaction.execute(progress, token);
                            }
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to download Bible: ${error}`);
                    }
                }
            }
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



    context.subscriptions.push(
        notebookSerializer,
        codexKernel,
        openChapterCommand,
        openFileCommand,
        openDictionaryCommand,
        createCodexNotebookCommand,
        setEditorFontCommand,
        exportCodexContentCommand,
        updateProjectNotebooksToUseCellsForVerseContentCommand,
        openSourceUploadCommand,
        uploadSourceFolderCommand,
        uploadTranslationFolderCommand,
        downloadSourceBibleCommand,
        analyzeEditsCommand,
        navigateToMainMenuCommand,

        deduplicateSourceCellsCommand,
        testProjectLoadingPerformanceCommand,

    );
}
