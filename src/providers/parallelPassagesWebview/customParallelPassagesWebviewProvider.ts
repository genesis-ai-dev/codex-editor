import * as vscode from "vscode";
import { jumpToCellInNotebook } from "../../utils";
import { TranslationPair } from "../../../types";

async function simpleOpen(uri: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().includes(".codex")) {
            // jumpToCellInNotebook(context, uri.toString(), 0);
            vscode.window.showErrorMessage(
                "Note: you need to pass the cellId to updateWorkspaceState for the cell with the content you want to open"
            );
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}

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
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "ParallelView",
            "index.js"
        )
    );
    // const styleUri = webviewView.webview.asWebviewUri(
    //     vscode.Uri.joinPath(
    //         extensionUri,
    //         "webviews",
    //         "codex-webviews",
    //         "dist",
    //         "ParallelView",
    //         "index.css",
    //     ),
    // );
    function getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    const nonce = getNonce();
    // FIXME: the api base url below is hardcoded to localhost:3002. This should probably be dynamic at least.
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
    <link href="${codiconsUri}" rel="stylesheet">
    <script nonce="${nonce}">
    //   const vscode = acquireVsCodeApi();
    const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
    </script>
    </head>
    <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
  </html>`;

    webviewView.webview.html = html;
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
        // Changed the type to any to handle multiple message types
        switch (message.command) {
            case "openFileAtLocation":
                simpleOpen(message.uri);
                break;
            case "search":
                if (message.database === "both") {
                    try {
                        const results = await vscode.commands.executeCommand<TranslationPair[]>(
                            "translators-copilot.searchParallelVerses",
                            message.query
                        );
                        if (results) {
                            webviewView.webview.postMessage({
                                command: "searchResults",
                                data: results,
                            });
                        }
                    } catch (error) {
                        console.error("Error searching parallel verses:", error);
                    }
                }
                break;
            default:
                console.error(`Unknown command: ${message.command}`);
        }
    });
};

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);
    }
}

export function registerParallelViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("parallel-passages-sidebar", provider)
    );
}
