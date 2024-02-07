import * as vscode from "vscode";

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
        vscode.Uri.joinPath(extensionUri, "src", "media", "reset.css"),
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "media", "vscode.css"),
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "commentsWebview",
            "build",
            "assets",
            "index.js",
        ),
    );
    const styleUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
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

export class CustomWebviewProvider {
    _extensionUri: any;
    selectionChangeListener: any;
    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    sendSelectMessage(webviewView: vscode.WebviewView, selectedText: string) {
        const activeEditor = vscode.window.activeTextEditor;
        let languageId = "";
        if (activeEditor) {
            languageId = activeEditor.document.languageId;
        }
        const formattedCode =
            "```" + languageId + "\r\n" + selectedText + "\r\n```";
        webviewView.webview.postMessage({
            command: "select",
            text: selectedText ? formattedCode : "",
        });
    }

    saveSelectionChanges(webviewView: vscode.WebviewView) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.selectionChangeListener =
                vscode.window.onDidChangeTextEditorSelection((e) => {
                    if (e.textEditor === activeEditor) {
                        const selectedText = activeEditor.document.getText(
                            e.selections[0],
                        );
                        this.sendSelectMessage(webviewView, selectedText);
                    }
                });
        }
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        loadWebviewHtml(webviewView, this._extensionUri);
        webviewView.webview.postMessage({ command: "reload" });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                webviewView.webview.postMessage({ command: "reload" });
            }
        });

        this.saveSelectionChanges(webviewView);
        vscode.window.onDidChangeActiveTextEditor(() => {
            // When the active editor changes, remove the old listener and add a new one
            if (this.selectionChangeListener) {
                this.selectionChangeListener.dispose();
            }
            this.saveSelectionChanges(webviewView);
        });

        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log({ message });
            try {
                switch (message.command) {
                    case "fetch": {
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
