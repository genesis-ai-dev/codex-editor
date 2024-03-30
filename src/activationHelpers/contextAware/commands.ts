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
import { ResourceProvider } from "../../providers/treeViews/resourceTreeViewProvider";

import { CodexNotebookProvider } from "../../providers/treeViews/scriptureTreeViewProvider";
import {
    getWorkSpaceFolder,
} from "../../utils";


const ROOT_PATH = getWorkSpaceFolder();



export async function registerCommands(context: vscode.ExtensionContext) {

    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const resourceTreeViewProvider = new ResourceProvider(ROOT_PATH);

    vscode.window.registerTreeDataProvider(
        "resource-explorer",
        resourceTreeViewProvider,
    );

    vscode.commands.registerCommand("resource-explorer.refreshEntry", () =>
        resourceTreeViewProvider.refresh(),
    );
    vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider,
    );

    vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh(),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "scripture-explorer-activity-bar.openChapter",
            async (notebookPath: string, chapterIndex: number) => {
                try {
                    jumpToCellInNotebook(notebookPath, chapterIndex);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open chapter: ${error}`,
                    );
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.indexVrefs",
            indexVerseRefsInSourceText,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.openTnAcademy",
            async (resource: DownloadedResource) => {
                await translationAcademy(context, resource);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.searchIndex",
            async () => {
                const searchString = await vscode.window.showInputBox({
                    prompt: "Enter the task number to check its status",
                    placeHolder: "Task number",
                });
                if (searchString !== undefined) {
                    searchVerseRefPositionIndex(searchString);
                }
            },
        ),
    );

    // Register the Codex Notebook serializer for saving and loading .codex files
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            NOTEBOOK_TYPE,
            new CodexContentSerializer(),
            { transientOutputs: true },
        ),
        new CodexKernel(),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.openChapter",
            async (notebookPath: string, chapterIndex: number) => {
                try {
                    jumpToCellInNotebook(notebookPath, chapterIndex);
                } catch (error) {
                    console.error(`Failed to open chapter: ${error}`);
                }
            },
        ),
    );

    // Register a command called openChapter that opens a specific .codex notebook to a specific chapter
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.openFile",
            async (resourceUri: vscode.Uri) => {
                try {
                    const document =
                        await vscode.workspace.openTextDocument(resourceUri);
                    await vscode.window.showTextDocument(
                        document,
                        vscode.ViewColumn.Beside,
                    );
                } catch (error) {
                    console.error(`Failed to open document: ${error}`);
                }
            },
        ),
    );
    // Register extension commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.createCodexNotebook",
            async () => {
                vscode.window.showInformationMessage("Creating Codex Notebook");
                const doc = await createCodexNotebook();
                await vscode.window.showNotebookDocument(doc);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.initializeNewProject",
            await initializeProject,
        ),
    );

    vscode.commands.registerCommand(
        "codex-editor.setEditorFontToTargetLanguage",
        await setTargetFont
    );

    vscode.commands.registerCommand(
        "codex-editor-extension.downloadSourceTextBibles",
        await downloadBible
    );
    ensureBibleDownload(); // TODO: This feels weird, are the commands registered only to be called by this function?
}

async function ensureBibleDownload(){
    vscode.window.showInformationMessage(
        "Ensuring Source Bible is downloaded...",
    );
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const bibleFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, "**/*.bible"),
            "**/node_modules/**",
            1,
        );
        if (bibleFiles.length === 0) {
            vscode.commands.executeCommand(
                "codex-editor-extension.downloadSourceTextBibles",
            );
        } else {
            vscode.window.showInformationMessage(
                "Bible files already exist in the workspace.",
            );
        }
    }
}
