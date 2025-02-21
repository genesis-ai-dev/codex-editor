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
import {
    generateVerseContext,
    getBibleDataRecordById as getBibleDataRecordById,
    TheographicBibleDataRecord,
} from "./sourceData";
import { CodexExportFormat, exportCodexContent } from "../../commands/exportHandler";
import { DownloadBibleTransaction } from "../../transactions/DownloadBibleTransaction";
import { getExtendedEbibleMetadataByLanguageNameOrCode } from "../../utils/ebible/ebibleCorpusUtils";
import { analyzeEditHistory } from "./miniIndex/indexes/editHistory";
import { createEditAnalysisProvider } from "../../providers/EditAnalysisView/EditAnalysisViewProvider";

export async function registerCommands(context: vscode.ExtensionContext) {
    const indexVrefsCommand = vscode.commands.registerCommand(
        "codex-editor-extension.indexVrefs",
        indexVerseRefsInSourceText
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
        async ({
            format,
            userSelectedPath,
            filesToExport,
        }: {
            format: CodexExportFormat;
            userSelectedPath: string;
            filesToExport: string[];
        }) => {
            await exportCodexContent(format, userSelectedPath, filesToExport);
        }
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
        indexVrefsCommand,
        searchIndexCommand,
        notebookSerializer,
        codexKernel,
        openChapterCommand,
        openFileCommand,
        openDictionaryCommand,
        createCodexNotebookCommand,
        setEditorFontCommand,
        getBibleDataRecordByIdCommand,
        exportCodexContentCommand,
        getContextDataFromVrefCommand,
        updateProjectNotebooksToUseCellsForVerseContentCommand,
        openSourceUploadCommand,
        uploadSourceFolderCommand,
        uploadTranslationFolderCommand,
        downloadSourceBibleCommand,
        analyzeEditsCommand
    );
}
