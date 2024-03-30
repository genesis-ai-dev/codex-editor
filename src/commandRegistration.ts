import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectCommentFiles,
    createProjectNotebooks,
} from "./utils/codexNotebookUtils";
import {
    getProjectMetadata,
    jumpToCellInNotebook,
} from "./utils";
import { LanguageProjectStatus } from "codex-types";
import {
    initializeProjectMetadata,
    promptForProjectDetails,
} from "./utils/projectUtils";
import {
    searchVerseRefPositionIndex,
    indexVerseRefsInSourceText,
} from "./commands/indexVrefsCommand";
import * as path from "path";
import { DownloadedResource } from "./providers/obs/resources/types";
import { translationAcademy } from "./providers/translationAcademy/provider";
import { downloadBible, setTargetFont } from "./projectInitializers";
import { ResourceProvider } from "./providers/treeViews/resourceTreeViewProvider";

import { CodexNotebookProvider } from "./providers/treeViews/scriptureTreeViewProvider";
import {
    getWorkSpaceFolder,
} from "./utils";


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
            async () => {
                const workspaceFolder = vscode.workspace.workspaceFolders
                    ? vscode.workspace.workspaceFolders[0]
                    : undefined;
                if (!workspaceFolder) {
                    console.error(
                        "No workspace folder found. Please open a folder to store your project in.",
                    );
                    return;
                }

                vscode.window.showInformationMessage(
                    "Initializing new project...",
                );
                try {
                    const projectDetails = await promptForProjectDetails();
                    if (projectDetails) {
                        const projectFilePath = await vscode.Uri.joinPath(
                            workspaceFolder.uri,
                            "metadata.json",
                        );

                        const fileExists = await vscode.workspace.fs
                            .stat(projectFilePath)
                            .then(
                                () => true,
                                () => false,
                            );

                        if (fileExists) {
                            const fileData =
                                await vscode.workspace.fs.readFile(
                                    projectFilePath,
                                );
                            const metadata = JSON.parse(fileData.toString());
                            const projectName = metadata.projectName;
                            const confirmDelete =
                                await vscode.window.showInputBox({
                                    prompt: `A project named ${projectName} already already exists. Type the project name to confirm deletion.`,
                                    placeHolder: "Project name",
                                });
                            if (confirmDelete !== projectName) {
                                vscode.window.showErrorMessage(
                                    "Project name does not match. Initialization cancelled.",
                                );
                                return;
                            }
                        }

                        const newProject =
                            await initializeProjectMetadata(projectDetails);
                        vscode.window.showInformationMessage(
                            `New project initialized: ${newProject?.meta.generator.userName}'s ${newProject?.meta.category}`,
                        );

                        // Spawn notebooks based on project scope
                        const projectScope =
                            newProject?.type.flavorType.currentScope;
                        if (!projectScope) {
                            vscode.window.showErrorMessage(
                                "Failed to initialize new project: project scope not found.",
                            );
                            return;
                        }
                        const books = Object.keys(projectScope);

                        const overwriteConfirmation =
                            await vscode.window.showWarningMessage(
                                "Do you want to overwrite any existing project files?",
                                { modal: true }, // This option ensures the dialog stays open until an explicit choice is made.
                                "Yes",
                                "No",
                            );
                        if (overwriteConfirmation === "Yes") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project with overwrite.",
                            );
                            await createProjectNotebooks({
                                shouldOverWrite: true,
                                books,
                            });
                            await createProjectCommentFiles({
                                shouldOverWrite: true,
                            });
                        } else if (overwriteConfirmation === "No") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project without overwrite.",
                            );
                            await createProjectNotebooks({ books });
                            await createProjectCommentFiles({
                                shouldOverWrite: false,
                            });
                        }
                    } else {
                        vscode.window.showInformationMessage(
                            "Project initialization cancelled.",
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to initialize new project: ${error}`,
                    );
                }
                await vscode.commands.executeCommand(
                    "scripture-explorer-activity-bar.refreshEntry",
                );
                await vscode.commands.executeCommand(
                    "codex-editor.setEditorFontToTargetLanguage",
                );
                await vscode.commands.executeCommand(
                    "codex-editor-extension.downloadSourceTextBibles",
                );
            },
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
}

