import * as vscode from "vscode";
import { getWorkSpaceFolder, jumpToCellInNotebook } from "../utils";
import { ProjectOverview } from "../../types";
import {
    getProjectOverview,
    initializeProjectMetadata,
    findAllCodexProjects,
    checkIfMetadataIsInitialized,
} from "./utils/projectUtils";
import { SourceUploadProvider } from "../providers/SourceUpload/SourceUploadProvider";
import path from "path";
import * as semver from "semver";

export async function simpleOpen(uri: string, context: vscode.ExtensionContext) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().endsWith(".codex") || parsedUri.toString().endsWith(".source")) {
            vscode.commands.executeCommand("vscode.openWith", parsedUri, "codex.cellEditor");
        } else {
            const document = await vscode.workspace.openTextDocument(parsedUri);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}

// async function jumpToFirstOccurrence(context: vscode.ExtensionContext, uri: string, word: string) {
//   const chapter = word.split(":");
//   jumpToCellInNotebook(context, uri, chapter[0]);
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) {
//     return;
//   }

//   const document = editor.document;
//   const text = document.getText();
//   const wordIndex = text.indexOf(word);

//   if (wordIndex === -1) {
//     return;
//   }

//   const position = document.positionAt(wordIndex);
//   editor.selection = new vscode.Selection(position, position);
//   editor.revealRange(
//     new vscode.Range(position, position),
//     vscode.TextEditorRevealType.InCenter
//   );

//   vscode.window.showInformationMessage(
//     `Jumped to the first occurrence of "${word}"`
//   );
// }

const loadWebviewHtml = (webviewView: vscode.WebviewView, extensionUri: vscode.Uri) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css")
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "ProjectManagerView",
            "index.js"
        )
    );
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );

    function getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    const nonce = getNonce();

    const html = /*html*/ `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none';
            img-src ${webviewView.webview.cspSource} https: data:;
            style-src ${webviewView.webview.cspSource} 'unsafe-inline';
            script-src 'nonce-${nonce}';
            font-src ${webviewView.webview.cspSource};
            connect-src ${webviewView.webview.cspSource} https:;">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${codiconsUri}" rel="stylesheet" />
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const apiBaseUrl = ${JSON.stringify(
                process.env.API_BASE_URL || "http://localhost:3002"
            )}
        </script>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;

    webviewView.webview.html = html;
};

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private _projectOverview?: ProjectOverview;
    private webviewHasInitialProjectOverviewData: boolean = false;  // Add this property

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);

        // Wait for webview ready signal
        await new Promise<void>((resolve) => {
            const readyListener = webviewView.webview.onDidReceiveMessage((message) => {
                if (message.command === "webviewReady") {
                    resolve();
                    readyListener.dispose();
                }
            });
        });

        // Check if workspace is open
        if (!vscode.workspace.workspaceFolders) {
            const projects = await findAllCodexProjects();
            this._view.webview.postMessage({
                command: "noWorkspaceOpen",
                data: projects,
            });
        } else {
            const hasMetadata = await checkIfMetadataIsInitialized();
            console.log("Metadata initialized:", hasMetadata);
            if (!hasMetadata) {
                const projects = await findAllCodexProjects();
                this._view.webview.postMessage({
                    command: "noWorkspaceOpen",
                    data: projects,
                });
            } else {
                await this.updateProjectOverview(true);
            }
        }

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            switch (message.command) {
                case "requestProjectOverview":
                    await this.updateProjectOverview(true);
                    break;
                // Add these missing cases
                case "createNewWorkspaceAndProject":
                    await this.createNewWorkspaceAndProject();
                    break;
                case "openProjectSettings":
                case "renameProject":
                case "changeUserName":
                case "editAbbreviation":
                case "changeSourceLanguage":
                case "changeTargetLanguage":
                case "selectCategory":
                case "downloadSourceText":
                case "openAISettings":
                case "openSourceUpload":
                    await vscode.commands.executeCommand(
                        `codex-project-manager.${message.command}`
                    );
                    // FIXME: sometimes this refreshes before the command is finished. Need to return values on all of them
                    // Send a response back to the webview
                    this._view?.webview.postMessage({ command: "actionCompleted" });
                    break;
                case "initializeProject":
                    await this.createNewProject();
                    break;
                case "exportProjectAsPlaintext":
                    await vscode.commands.executeCommand(
                        "codex-editor-extension.exportCodexContent"
                    );
                    break;
                // other cases...
            }
        });

        // Add this after webview ready signal
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const watchedFolders = config.get<string[]>("watchedFolders") || [];
        
        // Send initial watched folders
        this._view?.webview.postMessage({
            command: "sendWatchedFolders",
            data: watchedFolders
        });
    }

    private async updateProjectOverview(force: boolean = false) {
        try {
            const newProjectOverview = await getProjectOverview();
            const primarySourceText = vscode.workspace
                .getConfiguration("codex-project-manager")
                .get("primarySourceText");

            if (!newProjectOverview) {
                this._view?.webview.postMessage({
                    command: "noProjectFound",
                });
                this.webviewHasInitialProjectOverviewData = true;
            } else if (!this.webviewHasInitialProjectOverviewData || force) {
                this._view?.webview.postMessage({
                    command: "sendProjectOverview",
                    data: { ...newProjectOverview, primarySourceText },
                });
                this.webviewHasInitialProjectOverviewData = true;
            } else if (
                JSON.stringify(newProjectOverview) !== JSON.stringify(this._projectOverview) ||
                primarySourceText !== this._projectOverview?.primarySourceText
            ) {
                this._projectOverview = {
                    ...newProjectOverview,
                    primarySourceText: primarySourceText as vscode.Uri,
                };
                this._view?.webview.postMessage({
                    command: "sendProjectOverview",
                    data: this._projectOverview,
                });
            }
        } catch (error) {
            console.error("Error updating project overview:", error);
            this._view?.webview.postMessage({
                command: "error",
                message: "Failed to load project overview. Please try again.",
            });
        }
    }

    private async createNewProject() {
        try {
            // Initialize project metadata
            await initializeProjectMetadata({});

            // Create necessary project files
            await vscode.commands.executeCommand("codex-project-manager.initializeNewProject");

            // Force an update of the project overview
            await this.updateProjectOverview(true);
        } catch (error) {
            console.error("Error creating new project:", error);
            throw error;
        }
    }

    private async setprimarySourceText(biblePath: string) {
        try {
            await vscode.workspace
                .getConfiguration("codex-project-manager")
                .update("primarySourceText", biblePath, vscode.ConfigurationTarget.Workspace);
            // Force an update immediately after setting the primary source Bible
            await this.updateProjectOverview(true);
        } catch (error) {
            console.error("Error setting primary source Bible:", error);
            this._view?.webview.postMessage({
                command: "error",
                message: "Failed to set primary source Bible. Please try again.",
            });
        }
    }

    private async createNewWorkspaceAndProject() {
        // First show an info message with instructions
        const choice = await vscode.window.showInformationMessage(
            "Would you like to create a new folder for your project?",
            { modal: true },
            "Create New Folder",
            "Select Existing Empty Folder"
        );

        if (!choice) {
            return;
        }

        if (choice === "Create New Folder") {
            // Show folder picker for parent directory
            const parentFolderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Choose Location for New Project Folder",
            });

            if (!parentFolderUri || !parentFolderUri[0]) {
                return;
            }

            // Check if parent folder is inside a project
            const isNestedProject = await this.checkForParentProjects(parentFolderUri[0]);
            if (isNestedProject) {
                await vscode.window.showErrorMessage(
                    "Cannot create a project inside another Codex project. Please choose a different location.",
                    { modal: true }
                );
                return;
            }

            // Prompt for new folder name
            const folderName = await vscode.window.showInputBox({
                prompt: "Enter name for new project folder",
                validateInput: (value) => {
                    if (!value) return "Folder name cannot be empty";
                    if (value.match(/[<>:"/\\|?*]/))
                        return "Folder name contains invalid characters";
                    return null;
                },
            });

            if (!folderName) {
                return;
            }

            // Create the new folder
            const newFolderUri = vscode.Uri.joinPath(parentFolderUri[0], folderName);
            try {
                await vscode.workspace.fs.createDirectory(newFolderUri);
                await vscode.commands.executeCommand("vscode.openFolder", newFolderUri);

                // Wait for workspace to open
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // Initialize the project
                await this.createNewProject();

                // After project is created, force an update of the project overview
                await this.updateProjectOverview(true);

                // Switch view mode to overview
                this._view?.webview.postMessage({
                    command: "sendProjectOverview",
                    data: await getProjectOverview(),
                });
            } catch (error) {
                console.error("Error creating new project folder:", error);
                await vscode.window.showErrorMessage(
                    "Failed to create new project folder. Please try again.",
                    { modal: true }
                );
            }
        } else {
            // Use existing folder picker logic
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Choose Empty Folder for New Project",
            });

            if (folderUri && folderUri[0]) {
                try {
                    // Check if the selected folder is empty
                    const entries = await vscode.workspace.fs.readDirectory(folderUri[0]);
                    if (entries.length > 0) {
                        await vscode.window.showErrorMessage(
                            "The selected folder must be empty. Please create a new empty folder for your project.",
                            { modal: true }
                        );
                        return;
                    }

                    // Check if the selected folder or any parent folder is a Codex project
                    const isNestedProject = await this.checkForParentProjects(folderUri[0]);
                    if (isNestedProject) {
                        await vscode.window.showErrorMessage(
                            "Cannot create a project inside another Codex project. Please choose a different location.",
                            { modal: true }
                        );
                        return;
                    }

                    await vscode.commands.executeCommand("vscode.openFolder", folderUri[0]);
                    // Wait for workspace to open
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    await this.createNewProject();
                } catch (error) {
                    console.error("Error creating new project:", error);
                    await vscode.window.showErrorMessage(
                        "Failed to create new project. Please try again.",
                        { modal: true }
                    );
                }
            }
        }
    }

    private async checkForParentProjects(folderUri: vscode.Uri): Promise<boolean> {
        let currentPath = folderUri.fsPath;
        const rootPath = path.parse(currentPath).root;

        while (currentPath !== rootPath) {
            try {
                const metadataPath = vscode.Uri.file(path.join(currentPath, "metadata.json"));
                await vscode.workspace.fs.stat(metadataPath);
                // If we find a metadata.json file, this may be a Codex project, but we also need to check
                // the metadata.json file json contents, specifically the meta.generator.softwareName field
                // to see if it is "Codex Editor"
                const metadata = await vscode.workspace.fs.readFile(metadataPath);
                const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
                if (metadataJson.meta.generator.softwareName === "Codex Editor") {
                    return true;
                }
            } catch {
                // No metadata.json found at this level, move up one directory
                currentPath = path.dirname(currentPath);
            }
        }
        return false;
    }

    private async openProject(projectPath: string) {
        try {
            const uri = vscode.Uri.file(projectPath);
            const currentVersion =
                vscode.extensions.getExtension("project-accelerate.codex-editor-extension")
                    ?.packageJSON.version || "0.0.0";

            // Verify this is still a valid Codex project
            const metadataPath = vscode.Uri.joinPath(uri, "metadata.json");
            try {
                const metadata = await vscode.workspace.fs.readFile(metadataPath);
                const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
                const projectVersion = metadataJson.meta?.generator?.softwareVersion || "0.0.0";

                // Check version compatibility
                if (semver.major(projectVersion) !== semver.major(currentVersion)) {
                    const proceed = await vscode.window.showWarningMessage(
                        `This project was created with Codex Editor v${projectVersion}, which may be incompatible with the current version (v${currentVersion}). Opening it may cause issues.`,
                        { modal: true },
                        "Open Anyway",
                        "Cancel"
                    );
                    if (proceed !== "Open Anyway") {
                        return;
                    }
                } else if (semver.lt(projectVersion, currentVersion)) {
                    await vscode.window.showInformationMessage(
                        `This project was created with an older version of Codex Editor (v${projectVersion}). It will be automatically upgraded to v${currentVersion}.`
                    );
                }

                // Update last opened time
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const projectHistory = config.get<Record<string, string>>("projectHistory") || {};
                projectHistory[projectPath] = new Date().toISOString();
                await config.update(
                    "projectHistory",
                    projectHistory,
                    vscode.ConfigurationTarget.Global
                );

                await vscode.commands.executeCommand("vscode.openFolder", uri);
            } catch (error) {
                await vscode.window.showErrorMessage(
                    "This folder is no longer a valid Codex project. It may have been moved or deleted.",
                    { modal: true }
                );
                return;
            }
        } catch (error) {
            console.error("Error opening project:", error);
            await vscode.window.showErrorMessage(
                "Failed to open project. The folder may no longer exist.",
                { modal: true }
            );
        }
    }

    private async addWatchFolder(data: { path: string }) {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Select Folder to Watch",
        });

        if (folderUri && folderUri[0]) {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const watchedFolders = config.get<string[]>("watchedFolders") || [];
            const newPath = folderUri[0].fsPath;

            if (!watchedFolders.includes(newPath)) {
                watchedFolders.push(newPath);
                await config.update(
                    "watchedFolders",
                    watchedFolders,
                    vscode.ConfigurationTarget.Global
                );

                // Refresh both watched folders and projects list
                await this.refreshWatchedFolders();
                await this.refreshProjects();
            }
        }
    }

    private async removeWatchFolder(data: { path: string }) {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const watchedFolders = config.get<string[]>("watchedFolders") || [];
        const updatedFolders = watchedFolders.filter((f) => f !== data.path);

        await config.update("watchedFolders", updatedFolders, vscode.ConfigurationTarget.Global);

        // Refresh both watched folders and projects list
        await this.refreshWatchedFolders();
        await this.refreshProjects();
    }

    private async refreshProjects() {
        const projects = await findAllCodexProjects();
        this._view?.webview.postMessage({
            command: "sendProjectsList",
            data: projects,
        });
    }

    // Add this method to the CustomWebviewProvider class
    private async refreshWatchedFolders() {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const watchedFolders = config.get<string[]>("watchedFolders") || [];

        this._view?.webview.postMessage({
            command: "sendWatchedFolders",
            data: watchedFolders,
        });
    }
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("project-manager-sidebar", provider)
    );

    // Show the sidebar when loading - which includes the button to create a new project
    vscode.commands.executeCommand("project-manager-sidebar.focus");
}
