import * as vscode from "vscode";
import { jumpToCellInNotebook } from "../../utils";
import { registerTextSelectionHandler, performSearch } from "../../handlers/textSelectionHandler";
import { PythonMessenger } from "../../utils/pyglsMessenger";

const pyMessenger: PythonMessenger = new PythonMessenger();
const abortController: AbortController | null = null;

async function pollEditResults(webviewView: vscode.WebviewView) {
    try {
        const editResults = await pyMessenger.getEditResults();
        webviewView.webview.postMessage({
            command: "editResults",
            data: editResults,
        });
        pyMessenger.getHoveredLine().then(line => {
            webviewView.webview.postMessage({
                command: 'lineresult',
                line: line
            });
        });
    } catch (error) {
        console.error('Failed to fetch edit results:', error);
    }

    // Schedule the next poll
    setTimeout(() => pollEditResults(webviewView), 500);
}

async function simpleOpen(uri: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().includes(".codex")) {
            jumpToCellInNotebook(uri.toString(), 0);
        } else {
            const document = await vscode.workspace.openTextDocument(parsedUri);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}

const loadWebviewHtml = (
    webviewView: vscode.WebviewView,
    extensionUri: vscode.Uri,
) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css"),
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css"),
    );
    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "SmartView",
            "index.js",
        ),
    );
    const styleUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "SmartView",
            "index.css",
        ),
    );
    function getNonce() {
        let text = "";
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(
                Math.floor(Math.random() * possible.length),
            );
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
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webviewView.webview.cspSource
        }; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <script nonce="${nonce}">
      // const vsCodeApi = acquireVsCodeApi();
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

export class CustomWebviewProvider {
    _context: vscode.ExtensionContext;
    selectionChangeListener: any;
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        loadWebviewHtml(webviewView, this._context.extensionUri);

        registerTextSelectionHandler(this._context, (data: JSON) => {
            webviewView.webview.postMessage({
                command: "searchResults",
                data: data,
            });
        });

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            switch (message.command) {
                case "openFileAtLocation":
                    simpleOpen(message.uri);
                    break;
                case "search":
                    performSearch(message.query, (data: JSON) => {
                        webviewView.webview.postMessage({
                            command: "searchResult",
                            data: data,
                        });
                    });
                    break;
                case "applyEdit":
                    try {
                        await pyMessenger.applyEdit(message.uri, message.before, message.after);
                    } catch (error) {
                        console.error("Failed to apply edit:", error);
                    }
                    break;
                case "ignore":
                    try {
                       // await pyMessenger.ignoreEdit(message.reference);
                    } catch (error) {
                        console.error("Failed to ignore edit:", error);
                    }
                    break;
                case "edits":
                    await pyMessenger.searchForEdits(message.before, message.after);
                    break;
                case "undo":
                    try {
                        await pyMessenger.applyEdit(message.uri, message.after, message.before);
                    } catch (error) {
                        console.error("Failed to undo edit:", error);
                    }
                    break;
                default:
                    console.error(`Unknown command!!!: ${message.command}`);
            }
        });

        // Start polling for edit results
        pollEditResults(webviewView);
    }
}

export function registerSmartViewWebviewProvider(context: vscode.ExtensionContext) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("smart-edit-sidebar", new CustomWebviewProvider(context))
    );

    item.show();
}