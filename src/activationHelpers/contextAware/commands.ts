import * as vscode from "vscode";
import { CodexKernel } from "../../controller";
import { CodexContentSerializer } from "../../serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
} from "../../utils/codexNotebookUtils";
import {
    jumpToCellInNotebook,
} from "../../utils";
import {
    searchVerseRefPositionIndex,
    indexVerseRefsInSourceText,
} from "../../commands/indexVrefsCommand";
import { DownloadedResource } from "../../providers/obs/resources/types";
import { translationAcademy } from "../../providers/translationAcademy/provider";
import { downloadBible, initializeProject, setTargetFont } from "../contextUnaware/projectInitializers";

import { CodexNotebookProvider } from "../../providers/treeViews/scriptureTreeViewProvider";
import {
    getWorkSpaceFolder,
} from "../../utils";

const ROOT_PATH = getWorkSpaceFolder();

export async function registerCommands(context: vscode.ExtensionContext) {

    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const scriptureExplorerTreeDataProvider = vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider
    );

    const scriptureExplorerRefreshCommand = vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh()
    );

    const scriptureExplorerOpenChapterCommand = vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.openChapter",
        async (notebookPath: string, chapterIndex: number) => {
            try {
                jumpToCellInNotebook(notebookPath, chapterIndex);
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to open chapter: ${error}`
                );
            }
        }
    );

    const indexVrefsCommand = vscode.commands.registerCommand(
        "codex-editor-extension.indexVrefs",
        indexVerseRefsInSourceText
    );

    const openTnAcademyCommand = vscode.commands.registerCommand(
        "codex-editor-extension.openTnAcademy",
        async (resource: DownloadedResource) => {
            await translationAcademy(context, resource);
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
        "codex-editor-extension.openChapter",
        async (notebookPath: string, chapterIndex: number) => {
            try {
                jumpToCellInNotebook(notebookPath, chapterIndex);
            } catch (error) {
                console.error(`Failed to open chapter: ${error}`);
            }
        }
    );

    const openFileCommand = vscode.commands.registerCommand(
        "codex-notebook-extension.openFile",
        async (resourceUri: vscode.Uri) => {
            try {
                const document = await vscode.workspace.openTextDocument(resourceUri);
                await vscode.window.showTextDocument(
                    document,
                    vscode.ViewColumn.Beside
                );
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

    const initializeNewProjectCommand = vscode.commands.registerCommand(
        "codex-editor-extension.initializeNewProject",
        await initializeProject
    );

    const setEditorFontCommand = vscode.commands.registerCommand(
        "codex-editor-extension.setEditorFontToTargetLanguage",
        await setTargetFont
    );

    const downloadSourceTextBiblesCommand = vscode.commands.registerCommand(
        "codex-editor-extension.downloadSourceTextBibles",
        await downloadBible
    );

    context.subscriptions.push(
        scriptureExplorerTreeDataProvider,
        scriptureExplorerRefreshCommand,
        scriptureExplorerOpenChapterCommand,
        indexVrefsCommand,
        openTnAcademyCommand,
        searchIndexCommand,
        notebookSerializer,
        codexKernel,
        openChapterCommand,
        openFileCommand,
        createCodexNotebookCommand,
        initializeNewProjectCommand,
        setEditorFontCommand,
        downloadSourceTextBiblesCommand
    );

    ensureBibleDownload();
}

async function ensureBibleDownload() {
    // We use a source Bible for various functions, so we need to ensure at least one is downloaded.
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const bibleFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, ".project/**/*.bible"),
            "**/node_modules/**",
            1,
        );
        if (bibleFiles.length === 0) {
            vscode.commands.executeCommand(
                "codex-editor-extension.downloadSourceTextBibles",
            );
        }
    }
}
