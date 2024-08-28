import * as vscode from "vscode";
import { jumpToCellInNotebook } from "../../utils";
import { registerTextSelectionHandler } from "../../handlers/textSelectionHandler";

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
      const vscode = acquireVsCodeApi();
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
                    simpleOpen(message.uri);
                    break;
                case "search":
                    if (message.database === "both") {
                        const results = await vscode.commands.executeCommand('translators-copilot.searchTargetVersesByQuery', message.query);
                        webviewView.webview.postMessage({
                            command: "searchResults",
                            data: {
                                bibleResults: [],
                                codexResults: results || []
                            },
                        });
                    }
                    break;
                default:
                    console.error(`Unknown command: ${message.command}`);
            }
        },
    );
};

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);

        registerTextSelectionHandler(this._context, async (query: string) => {
            const results = await vscode.commands.executeCommand('translators-copilot.searchTargetVersesByQuery', query);
            console.log("Results: ", results);
            if (typeof results === 'string') {
                vscode.window.showInformationMessage(results);
            } else {
                vscode.window.showInformationMessage('Search completed');
            }

            this._view?.webview.postMessage({
                command: "searchResults",
                data: {
                    bibleResults: [],
                    codexResults: results || []
                },
            });
        });
    }
}

export function registerParallelViewWebviewProvider(
    context: vscode.ExtensionContext,
) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "parallel-passages-sidebar",
            provider
        ),
    );
}
