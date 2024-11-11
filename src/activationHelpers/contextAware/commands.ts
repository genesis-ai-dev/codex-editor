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
import {
    searchVerseRefPositionIndex,
    indexVerseRefsInSourceText,
} from "../../commands/indexVrefsCommand";
import { setTargetFont } from "../../projectManager/projectInitializers";

import { CodexNotebookTreeViewProvider } from "../../providers/treeViews/navigationTreeViewProvider";
import { getWorkSpaceFolder } from "../../utils";
import {
    generateVerseContext,
    getBibleDataRecordById as getBibleDataRecordById,
    TheographicBibleDataRecord,
    Verse,
} from "./sourceData";
import { exportCodexContent } from "../../commands/exportHandler";
import debounce from "lodash/debounce";
import { DownloadBibleTransaction } from "../../transactions/DownloadBibleTransaction";
import { getExtendedEbibleMetadataByLanguageNameOrCode } from "../../utils/ebible/ebibleCorpusUtils";

const ROOT_PATH = getWorkSpaceFolder();

export async function registerCommands(context: vscode.ExtensionContext) {
    const navigationTreeViewProvider = new CodexNotebookTreeViewProvider(ROOT_PATH, context);
    vscode.window.registerTreeDataProvider("codexNotebookTreeView", navigationTreeViewProvider);

    // Create a debounced refresh function
    const debouncedRefresh = debounce(async () => {
        console.log("Commands: Triggering debounced refresh");
        try {
            // Clear the metadata cache before refreshing
            await navigationTreeViewProvider.model.invalidateCache();
            navigationTreeViewProvider.refresh();
        } catch (error) {
            console.error("Commands: Error during refresh:", error);
            vscode.window.showErrorMessage("Failed to refresh navigation tree");
        }
    }, 500);

    const navigationExplorerRefreshCommand = vscode.commands.registerCommand(
        "codexNotebookTreeView.refresh",
        () => {
            console.log("Commands: Refresh command triggered");
            return debouncedRefresh();
        }
    );

    const indexVrefsCommand = vscode.commands.registerCommand(
        "codex-editor-extension.indexVrefs",
        indexVerseRefsInSourceText
    );

    const searchIndexCommand = vscode.commands.registerCommand(
        "codex-editor-extension.searchIndex",
        async () => {
            const searchString = await vscode.window.showInputBox({
                prompt: "Enter the task number to check its status",
                placeHolder: "Task number",
            });
            if (searchString !== undefined) {
                searchVerseRefPositionIndex(searchString);
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

    const createCodexNotebookCommand = vscode.commands.registerCommand(
        "codex-editor-extension.createCodexNotebook",
        async () => {
            const doc = await createCodexNotebook();
            await vscode.window.showNotebookDocument(doc);
        }
    );

    // const initializeNewProjectCommand = vscode.commands.registerCommand(
    //     "codex-editor-extension.initializeNewProject",
    //     await initializeProject
    // );

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
        exportCodexContent
    );

    const getBibleDataRecordByIdCommand = vscode.commands.registerCommand(
        "codex-editor-extension.getBibleDataRecordById",
        async (passedId: string) => {
            let result = null;
            let id = passedId;
            if (!id) {
                id =
                    (await vscode.window.showInputBox({
                        prompt: "Enter the ID of the Bible data record to get",
                        placeHolder: "Record ID",
                    })) || "";
            }
            result = await getBibleDataRecordById(id);
            if (result) {
                const { record } = result;
                vscode.window.showInformationMessage(`Found record in category: ${record}`);
            } else {
                vscode.window.showWarningMessage(`No record found for ID: ${id}`);
            }
            return result;
        }
    );

    const getContextDataFromVrefCommand = vscode.commands.registerCommand(
        "codex-editor-extension.getContextDataFromVref",
        async (vref: string): Promise<TheographicBibleDataRecord> => {
            return await generateVerseContext(vref);
        }
    );

    const openSourceUploadCommand = vscode.commands.registerCommand(
        "codexNotebookTreeView.openSourceFile",
        async (treeNode: Node & { sourceFileUri?: vscode.Uri }) => {
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

    const navigationExplorerOpenChapterCommand = vscode.commands.registerCommand(
        "codexNotebookTreeView.openSection",
        async (resource: vscode.Uri, cellId?: string) => {
            try {
                await navigationTreeViewProvider.openSection(resource, cellId);
            } catch (error) {
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`Failed to open notebook: ${error.message}`);
                } else {
                    vscode.window.showErrorMessage("Failed to open notebook: Unknown error");
                }
            }
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

    context.subscriptions.push(
        navigationTreeViewProvider,
        navigationExplorerRefreshCommand,
        indexVrefsCommand,
        searchIndexCommand,
        notebookSerializer,
        codexKernel,
        openChapterCommand,
        openFileCommand,
        createCodexNotebookCommand,
        setEditorFontCommand,
        getBibleDataRecordByIdCommand,
        exportCodexContentCommand,
        getContextDataFromVrefCommand,
        updateProjectNotebooksToUseCellsForVerseContentCommand,
        openSourceUploadCommand,
        uploadSourceFolderCommand,
        uploadTranslationFolderCommand,
        navigationExplorerOpenChapterCommand,
        downloadSourceBibleCommand
    );
}
