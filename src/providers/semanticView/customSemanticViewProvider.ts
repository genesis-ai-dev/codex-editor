// TODO: Get rid of this for something better
import * as vscode from "vscode";

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

async function simpleOpen(uri: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().endsWith(".codex")) {
            vscode.workspace.openNotebookDocument(parsedUri);
        } else {
            const document = await vscode.workspace.openTextDocument(parsedUri);
            await vscode.window.showTextDocument(document);
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

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "SemanticView",
            "index.js"
        )
    );
    // const styleUri = webviewView.webview.asWebviewUri(
    //     vscode.Uri.joinPath(
    //         extensionUri,
    //         "webviews",
    //         "codex-webviews",
    //         "dist",
    //         "SemanticView",
    //         "index.css"
    //     )
    // );
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
      // const vsCodeApi = acquireVsCodeApi();
      const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
    </link>
    </head>
    <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;

    webviewView.webview.html = html;
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
        console.log(message.command);
        switch (message.command) {
            case "openFileAtLocation":
                simpleOpen(message.uri);
                break;
            case "translators-copilot.getSimilarWords":
                try {
                    console.log("Requesting similar words for:", message.word);
                    const word = message.word;
                    const response = await vscode.commands.executeCommand(
                        "translators-copilot.getSimilarWords",
                        word
                    );

                    console.log("Response from translators-copilot.getSimilarWords:", response);
                    if (response) {
                        console.log("Sending similarWords message to webview");
                        webviewView.webview.postMessage({
                            command: "similarWords",
                            data: response,
                        });
                    } else {
                        console.error("No response from translators-copilot.getSimilarWords");
                        webviewView.webview.postMessage({
                            command: "similarWords",
                            data: [],
                        });
                    }
                } catch (error) {
                    console.error("Failed to get similar words:", error);
                    webviewView.webview.postMessage({
                        command: "similarWords",
                        data: [],
                    });
                }
                break;
            default:
                console.error(`Unknown command: ${message.command}`);
        }
    });
};

export class CustomWebviewProvider {
    _context: vscode.ExtensionContext;
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        loadWebviewHtml(webviewView, this._context.extensionUri);
    }
}

export function registerSemanticViewProvider(context: vscode.ExtensionContext) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "semantic-sidebar",
            new CustomWebviewProvider(context)
        )
    );

    item.show();
}
