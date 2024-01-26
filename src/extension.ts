import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectNotebooks,
} from "./codexNotebookUtils";
import { CodexNotebookProvider } from "./tree-view/scriptureTreeViewProvider";
import { getAllBookRefs, getWorkSpaceFolder, jumpToCellInNotebook } from "./utils";
import { registerReferences } from "./referencesProvider";
import { Project } from "./types";
import { nonCanonicalBookRefs } from "./assets/vref";

const ROOT_PATH = getWorkSpaceFolder();

export function activate(context: vscode.ExtensionContext) {
    registerReferences(context);

    // Register the Codex Notebook serializer for saving and loading .codex files
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            NOTEBOOK_TYPE,
            new CodexContentSerializer(),
            { transientOutputs: true },
        ),
        new CodexKernel(),
    );

    // Register a command called openChapter that opens a specific .codex notebook to a specific chapter
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.openChapter",
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
    // Register extension commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.createCodexNotebook",
            async () => {
                vscode.window.showInformationMessage("Creating Codex Notebook");
                const doc = await createCodexNotebook();
                await vscode.window.showNotebookDocument(doc);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.createCodexProject",
            async () => {
                const overwriteConfirmation =
                    await vscode.window.showWarningMessage(
                        "Do you want to overwrite any existing project files?",
                        "Yes",
                        "No",
                    );
                if (overwriteConfirmation === "Yes") {
                    vscode.window.showInformationMessage(
                        "Creating Codex Project with overwrite.",
                    );
                    await createProjectNotebooks(true);
                } else {
                    vscode.window.showInformationMessage(
                        "Creating Codex Project without overwrite.",
                    );
                    await createProjectNotebooks();
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.initializeNewProject",
            async () => {
                vscode.window.showInformationMessage("Initializing new project...");
                try {
                    const projectDetails = await promptForProjectDetails();
                    if (projectDetails) {
                        const newProject = await initializeProject(projectDetails);
                        vscode.window.showInformationMessage(`New project initialized: ${newProject?.meta.generator.userName}'s ${newProject?.meta.category}`);
                    } else {
                        vscode.window.showErrorMessage("Project initialization cancelled.");
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to initialize new project: ${error}`);
                }
            },
        ),
    );

    interface ProjectDetails {
        projectName: string;
        projectCategory: string;
        userName: string;
        abbreviation: string;
    }

    async function promptForProjectDetails() {
        // Prompt user for project details and return them

        const projectCategory = await vscode.window.showQuickPick(
            ["Scripture", "Gloss", "Parascriptural", "Peripheral"],
            { placeHolder: "Select the project category" },
        );
        if (!projectCategory) return;

        const projectName = await vscode.window.showInputBox({ prompt: "Enter the project name" });
        if (!projectName) return;


        const userName = await vscode.window.showInputBox({ prompt: "Enter your username" });
        if (!userName) return;

        const abbreviation = await vscode.window.showInputBox({ prompt: "Enter the project abbreviation" });
        if (!abbreviation) return;

        return {
            projectName,
            projectCategory,
            userName,
            abbreviation,
        };
    }

    function generateProjectScope(skipNonCanonical: boolean = true): Project["type"]["flavorType"]["currentScope"] {
        /** For now, we are just setting the scope as all books, but allowing the vref.ts file to determine the books.
         * We could add a feature to allow users to select which books they want to include in the project.
         * And we could even drill down to specific chapter/verse ranges.
         * 
         * FIXME: need to sort out whether the scope can sometimes be something other than books, like stories, etc.
         */
        const books: string[] = getAllBookRefs();

        // The keys will be the book refs, and the values will be empty arrays
        const projectScope: any = {}; // NOTE: explicit any type here because we are dynamically generating the keys

        skipNonCanonical ? books.filter(book =>
            !nonCanonicalBookRefs
                .includes(book))
            .forEach(book => {
                projectScope[book] = [];
            }) : books.forEach(book => {
                projectScope[book] = [];
            });
        return projectScope;
    }

    async function initializeProject(details: { projectName?: string; projectCategory: any; userName: any; }) {
        // Initialize a new project with the given details and return the project object
        const newProject = {
            format: "1.0",
            meta: {
                version: "1.0",
                category: details.projectCategory,
                generator: {
                    softwareName: "Codex Editor",
                    softwareVersion: "1.0",
                    userName: details.userName,
                },
                defaultLocale: "en",
                dateCreated: new Date().toDateString(),
                normalization: "NFC",
                comments: [],
            },
            idAuthorities: {},
            identification: {},
            languages: [],
            type: {
                flavorType: {
                    name: "default",
                    flavor: {
                        name: "default",
                        usfmVersion: "3.0",
                        translationType: "unknown",
                        audience: "general",
                        projectType: "unknown",
                    },
                    currentScope: generateProjectScope(),
                },
            },
            confidential: false,
            agencies: [],
            targetAreas: [],
            localizedNames: {},
            ingredients: {},
            copyright: {
                shortStatements: [],
            },
        };
        const workspaceFolder = vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;

        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const WORKSPACE_FOLDER = vscode?.workspace?.workspaceFolders && vscode?.workspace?.workspaceFolders[0];

        if (!WORKSPACE_FOLDER) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const projectFilePath = vscode.Uri.joinPath(WORKSPACE_FOLDER.uri, 'project.json');
        const projectFileData = Buffer.from(JSON.stringify(newProject, null, 4), 'utf8');

        vscode.workspace.fs.writeFile(projectFilePath, projectFileData)
            .then(() => vscode.window.showInformationMessage(`Project created at ${projectFilePath.fsPath}`));
        return newProject;
    }

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    vscode.window.registerTreeDataProvider(
        "scripture-explorer",
        scriptureTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand("scripture-explorer.refreshEntry", () =>
        scriptureTreeViewProvider.refresh(),
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
