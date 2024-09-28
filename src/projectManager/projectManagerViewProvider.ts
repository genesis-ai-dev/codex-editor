import * as vscode from "vscode";
import { getWorkSpaceFolder, jumpToCellInNotebook } from "../utils";
import { ProjectOverview } from "../../types";
import { getProjectOverview } from "./utils/projectUtils";
import { initializeProjectMetadata } from "./utils/projectUtils";
import { SourceUploadProvider } from "../providers/SourceUpload/SourceUploadProvider";

async function simpleOpen(uri: string, context: vscode.ExtensionContext) {
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
    <!--
      Use a content security policy to only allow loading images from https or from our extension directory,
      and only allow scripts that have a specific nonce.
    -->
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${
        webviewView.webview.cspSource
    }; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${codiconsUri}" rel="stylesheet" />
    <script nonce="${nonce}">
      const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
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

    constructor(context: vscode.ExtensionContext) {
        console.log("constructor in projectManagerViewProvider");
        this._context = context;
    }

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);

        // Wait for the webview to signal it's ready
        await new Promise<void>((resolve) => {
            const readyListener = webviewView.webview.onDidReceiveMessage((message) => {
                if (message.command === "webviewReady") {
                    resolve();
                    readyListener.dispose();
                }
            });
        });

        // Initial project overview fetch
        await this.updateProjectOverview();

        // Add message listener
        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            console.log("message in provider", message);
            switch (message.command) {
                case "requestProjectOverview":
                    console.log("requestProjectOverview called in provider");
                    await this.updateProjectOverview(true);
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
                    console.log(`${message.command} called`);
                    await vscode.commands.executeCommand(
                        `codex-project-manager.${message.command}`
                    );
                    // Schedule a refresh after a short delay
                    setTimeout(() => this.updateProjectOverview(true), 1000);
                    break;
                case "createNewProject":
                    await this.createNewProject();
                    break;
                case "openBible":
                    // vscode.window.showInformationMessage(
                    //     `Opening source text: ${JSON.stringify(message)}`
                    // );
                    simpleOpen(message.data.path, this._context);
                    break;
                case "webviewReady":
                    break;
                case "exportProjectAsPlaintext":
                    await vscode.commands.executeCommand(
                        "codex-editor-extension.exportCodexContent"
                    );
                    break;
                case "selectprimarySourceText":
                    await this.setprimarySourceText(message.data);
                    break;
                default:
                    console.error(`Unknown command: ${message.command}`);
            }
        });

        // Set up a listener for configuration changes
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration("codex-project-manager")) {
                await this.updateProjectOverview();
            }
        });
    }

    private webviewHasInitialProjectOverviewData: boolean = false;

    private async updateProjectOverview(force: boolean = false) {
        try {
            const newProjectOverview = await getProjectOverview();
            console.log("newProjectOverview", { newProjectOverview });
            const primarySourceText = vscode.workspace
                .getConfiguration("codex-project-manager")
                .get("primarySourceText");

            if (!newProjectOverview) {
                // If no project overview is available, send a message to show the "Create New Project" button
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
            await initializeProjectMetadata({});
            // Wait a short moment to ensure the file system has time to update
            await new Promise((resolve) => setTimeout(resolve, 500));

            const newProjectOverview = await getProjectOverview();
            if (newProjectOverview) {
                this._projectOverview = newProjectOverview;
                this._view?.webview.postMessage({
                    command: "projectCreated",
                    data: newProjectOverview,
                });
            } else {
                console.warn("Project created but overview not immediately available");
                // Instead of throwing an error, we'll send a message to refresh
                this._view?.webview.postMessage({
                    command: "refreshProjectOverview",
                });
            }
        } catch (error) {
            console.error("Error creating new project:", error);
            this._view?.webview.postMessage({
                command: "error",
                message: "Failed to create new project. Please try again.",
            });
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
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("project-manager-sidebar", provider)
    );

    // Show the sidebar when loading - which includes the button to create a new project
    vscode.commands.executeCommand("project-manager-sidebar.focus");
}
