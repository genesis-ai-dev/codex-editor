import * as vscode from "vscode";
import { jumpToCellInNotebook } from "../../utils";
import { registerTextSelectionHandler, performSearch } from "../../handlers/textSelectionHandler";
import { PythonMessenger } from "../../utils/pyglsMessenger";

const pyMessenger: PythonMessenger = new PythonMessenger();
const abortController: AbortController | null = null;

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

interface searchCommand {
    command: "searchResources"
    query: string,
    database: string,
}

async function simpleOpen(uri: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().includes(".codex")){
            jumpToCellInNotebook(uri.toString(),  0);

        }
        else {
            const document = await vscode.workspace.openTextDocument(parsedUri);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}



async function jumpToFirstOccurrence(uri: string, word: string) {
    const chapter = word.split(":");
    jumpToCellInNotebook(uri, parseInt(chapter[0], 10));
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;
    const text = document.getText();
    const wordIndex = text.indexOf(word);

    if (wordIndex === -1) {
        return;
    }

    const position = document.positionAt(wordIndex);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter,
    );

    vscode.window.showInformationMessage(
        `Jumped to the first occurrence of "${word}"`,
    );
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
            "ParallelView",
            "index.js",
        ),
    );
    const styleUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "ParallelView",
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
    webviewView.webview.onDidReceiveMessage(
        async (message: any) => { // Changed the type to any to handle multiple message types
            switch (message.command) {
                case "openFileAtLocation":
                    vscode.window.showInformationMessage(message.uri);
                    simpleOpen(message.uri);//message.word);
                    break;
                case "search":
                    if (message.database === 'resources') {
                        const query = message.query;
                        try {
                            const data = await pyMessenger.searchResources(query, 10);

                            webviewView.webview.postMessage({
                                command: "resourceResults",
                                data: data,
                            });
                        } catch (error) {
                            console.error('Failed to search resources:', error);
                        }
                    } else if (message.database === "both") {
                        performSearch(message.query, (data: JSON) => {
                            webviewView.webview.postMessage({
                                command: "searchResults",
                                data: data,
                            });
                        });
                    }
                    break;
                default:
                    console.error(`Unknown command: ${message.command}`);
            }
        },
    );
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
        if (webviewView.visible) {
            // sendCommentsToWebview(webviewView);
            // TODO: send verse parallels
        }
    }
}

export function registerParallelViewWebviewProvider(
    context: vscode.ExtensionContext,
) {
    const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "parallel-passages-sidebar",
            new CustomWebviewProvider(context),
        ),
    );

    item.show();
}

