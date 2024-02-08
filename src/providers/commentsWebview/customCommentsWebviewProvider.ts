import * as vscode from "vscode";
import {
    FileHandler,
    serializeCommentThreadArray,
} from "../../commentsProvider";

const abortController: AbortController | null = null;

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
            "commentsWebview",
            "build",
            "assets",
            "index.js",
        ),
    );
    const styleUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "commentsWebview",
            "build",
            "assets",
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
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${
        webviewView.webview.cspSource
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
const sendCommentsToWebview = async (webviewView: vscode.WebviewView) => {
    console.log("sendCommentsToWebview was called");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const filePath = workspaceFolders
        ? vscode.Uri.joinPath(workspaceFolders[0].uri, "notebook-comments.json")
              .fsPath
        : "";
    try {
        const uri = vscode.Uri.file(filePath);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        webviewView.webview.postMessage({
            command: "commentsFromWorkspace",
            content: fileContent,
        });
    } catch (error) {
        console.error("Error reading file:", error);
        vscode.window.showErrorMessage(`Error reading file: ${filePath}`);
    }
};

async function writeSerializedData(
    serializedData: string,
    filename: string = "notebook-comments.json",
) {
    const fileHandler = new FileHandler();

    try {
        await fileHandler.writeFile(filename, serializedData);
        console.log("Write operation completed.");
    } catch (error) {
        console.error("Error writing file:", error);
    }
}
export class CustomWebviewProvider {
    _extensionUri: any;
    selectionChangeListener: any;
    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        loadWebviewHtml(webviewView, this._extensionUri);
        webviewView.webview.postMessage({ command: "reload" });
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                sendCommentsToWebview(webviewView);
                webviewView.webview.postMessage({ command: "reload" });
            }
        });

        vscode.window.onDidChangeActiveTextEditor(() => {
            // When the active editor changes, remove the old listener and add a new one
            if (this.selectionChangeListener) {
                this.selectionChangeListener.dispose();
            }

            sendCommentsToWebview(webviewView);
        });

        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log({ message });
            try {
                switch (message.command) {
                    case "updateCommentThread": {
                        const serializedData = serializeCommentThreadArray(
                            JSON.parse(message.comments),
                        ); // Assuming serializeCommentThreads is available in this scope
                        await writeSerializedData(
                            serializedData,
                            "notebook-comments.json",
                        );
                        break;
                    }
                    case "abort-fetch":
                        if (abortController) {
                            abortController.abort();
                        }
                        break;
                    default:
                        break;
                }
            } catch (error) {
                console.error("Error:", error);
                vscode.window.showErrorMessage("Service access failed.");
            }
        });
    }
}

export function registerCommentsWebviewProvider(
    context: vscode.ExtensionContext,
) {
    const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "comments-sidebar",
            new CustomWebviewProvider(context.extensionUri),
        ),
    );
    item.show();
}