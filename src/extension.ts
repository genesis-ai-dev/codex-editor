import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectNotebooks,
} from "./codexNotebookUtils";
import { CodexNotebookProvider } from "./tree-view/scriptureTreeViewProvider";
import {
    getAllBookRefs,
    getProjectMetadata,
    getWorkSpaceFolder,
    jumpToCellInNotebook,
} from "./utils";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { LanguageMetadata, LanguageProjectStatus, Project } from "./types";
import { nonCanonicalBookRefs } from "./assets/vref";
import { LanguageCodes } from "./assets/languages";
import { ResourceProvider } from "./tree-view/resourceTreeViewProvider";
import { initializeProjectMetadata, promptForProjectDetails } from "./projectUtils";

const ROOT_PATH = getWorkSpaceFolder();

if (!ROOT_PATH) {
    vscode.window.showErrorMessage("No workspace found");
}

export function activate(context: vscode.ExtensionContext) {
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);

    // Add .bible files to the files.readonlyInclude glob pattern to make them readonly without overriding existing patterns
    const config = vscode.workspace.getConfiguration();
    const existingPatterns = config.get('files.readonlyInclude') || {};
    const updatedPatterns = { ...existingPatterns, "**/*.bible": true };
    config.update('files.readonlyInclude', updatedPatterns, vscode.ConfigurationTarget.Global);

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
                    vscode.window.showErrorMessage(
                        `Failed to open chapter: ${error}`,
                    );
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
                    vscode.window.showErrorMessage(
                        `Failed to open document: ${error}`,
                    );
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
                vscode.window.showInformationMessage(
                    "Initializing new project...",
                );
                try {
                    const projectDetails = await promptForProjectDetails();
                    if (projectDetails) {
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
                        } else if (overwriteConfirmation === "No") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project without overwrite.",
                            );
                            await createProjectNotebooks({ books });
                        }
                    } else {
                        vscode.window.showErrorMessage(
                            "Project initialization cancelled.",
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to initialize new project: ${error}`,
                    );
                }
            },
        ),
    );

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const resourceTreeViewProvider = new ResourceProvider(ROOT_PATH);
    vscode.window.registerTreeDataProvider(
        "resource-explorer",
        resourceTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand("resource-explorer.refreshEntry", () =>
        resourceTreeViewProvider.refresh(),
    );
    vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh(),
    );
}
