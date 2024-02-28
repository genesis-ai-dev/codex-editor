import {
    Disposable,
    Webview,
    WebviewPanel,
    window,
    Uri,
    ViewColumn,
} from "vscode";
import * as vscode from "vscode";
import { ScripturePostMessages, ScriptureContent } from "../../../types";

function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const sendDataToWebview = async (webview: vscode.WebviewView["webview"]) => {
    console.log("sendDataToWebview was called");
    let uri = vscode.window.activeTextEditor?.document.uri;
    console.log({ uri });

    // Check if the URI scheme is not 'file', then adjust it to create a file URI
    if (uri && uri.scheme !== "file") {
        // Use the fsPath to create a new URI with the 'file' scheme
        uri = vscode.Uri.file(uri.fsPath);
    }

    console.log({ adjustedUri: uri });

    if (uri?.toString().includes(".codex")) {
        try {
            const fileContentUint8Array =
                await vscode.workspace.fs.readFile(uri);
            const fileContent = new TextDecoder().decode(fileContentUint8Array);
            webview.postMessage({
                command: "sendData",
                data: JSON.parse(fileContent),
            } as ScripturePostMessages);
        } catch (error) {
            console.error("Error reading file:", error);
            vscode.window.showErrorMessage(
                `Error reading file: ${uri?.toString()}`,
            );
        }
    }
};

export class ScriptureViewerPanel {
    public static currentPanel: ScriptureViewerPanel | undefined;
    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];

    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;

        const initAsync = async () => {
            // const { data, uri } = await FileHandler.readFile(
            //     "scriptures/project.scripture",
            // );
            // if (!data) {
            //     return;
            // }
            // const scriptureContent: ScriptureContent = JSON.parse(data);
            // console.log("Parsed scripture content:", scriptureContent);

            this._panel.webview.html = this._getWebviewContent(
                this._panel.webview,
                extensionUri,
            );

            this._setWebviewMessageListener(this._panel.webview);

            await sendDataToWebview(this._panel.webview);
        };

        initAsync().catch(console.error);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static render(extensionUri: Uri): ScriptureViewerPanel {
        if (ScriptureViewerPanel.currentPanel) {
            ScriptureViewerPanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            const panel = window.createWebviewPanel(
                "scripture-view",
                "Scripture View",
                ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        Uri.joinPath(extensionUri, "out"),
                        Uri.joinPath(
                            extensionUri,
                            "webviews/codex-webviews/dist/ScriptureViewer",
                        ),
                    ],
                },
            );
            ScriptureViewerPanel.currentPanel = new ScriptureViewerPanel(
                panel,
                extensionUri,
            );
        }
        return ScriptureViewerPanel.currentPanel;
    }

    public static createOrShow(
        documentUri: vscode.Uri,
        extensionUri: vscode.Uri,
        webviewPanel?: vscode.WebviewPanel,
    ): ScriptureViewerPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ScriptureViewerPanel.currentPanel) {
            ScriptureViewerPanel.currentPanel._panel.reveal(column);
            return ScriptureViewerPanel.currentPanel;
        }
        const panel =
            webviewPanel ||
            vscode.window.createWebviewPanel(
                "scripture-view",
                "Scripture View",
                column || vscode.ViewColumn.One,
                { enableScripts: true },
            );
        return new ScriptureViewerPanel(panel, extensionUri);
    }

    public dispose() {
        ScriptureViewerPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "ScriptureViewer",
                "index.js",
            ),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "ScriptureViewer",
                "index.css",
            ),
        );

        const nonce = getNonce();

        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${styleUri}">
          <title>Scripture View</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }

    private _setWebviewMessageListener(webview: Webview) {
        webview.onDidReceiveMessage(
            async (message: ScripturePostMessages) => {
                const command = message.command;

                switch (command) {
                    case "fetchData": {
                        sendDataToWebview(webview);
                        break;
                    }
                }
            },
            undefined,
            this._disposables,
        );
    }
}

class FileHandler {
    static async readFile(
        filePath: string,
    ): Promise<{ data: string | undefined; uri: vscode.Uri | undefined }> {
        try {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error("No workspace folder found");
            }
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceFolder, filePath);
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const data = new TextDecoder().decode(fileData);
            return { data, uri: fileUri };
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading file: ${filePath}`);
            console.error({ error });
            return { data: undefined, uri: undefined };
        }
    }

    static async writeFile(filePath: string, data: string): Promise<void> {
        try {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error("No workspace folder found");
            }
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceFolder, filePath);
            const fileData = new TextEncoder().encode(data);
            await vscode.workspace.fs.writeFile(fileUri, fileData);
        } catch (error) {
            console.error({ error });
            vscode.window.showErrorMessage(
                `Error writing to file: ${filePath}`,
            );
        }
    }
}

export function registerScriptureViewerProvider(
    context: vscode.ExtensionContext,
) {
    const showScriptureViewerCommand = vscode.commands.registerCommand(
        "scriptureViewer.showScriptureViewer",
        async () => {
            ScriptureViewerPanel.render(context.extensionUri);
        },
    );

    context.subscriptions.push(showScriptureViewerCommand);
}
