import * as vscode from "vscode";

function getNonce(): string {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CodexChunkEditorProvider
    implements vscode.CustomTextEditorProvider
{
    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        console.log("CodexChunkEditorProvider register called");
        const provider = new CodexChunkEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            CodexChunkEditorProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    private static readonly viewType = "codex.chunkEditor";

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     *
     *
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        console.log("resolveCustomTextEditor called");
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
        );

        const updateWebview = () => {
            const jsonContent = this.getDocumentAsJson(document);
            console.log({ jsonContent, document });
            webviewPanel.webview.postMessage({
                type: "update",
                content: JSON.stringify(jsonContent),
            });
        };

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    updateWebview();
                }
            });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage((e) => {
            switch (e.type) {
                case "saveMarkdown":
                    console.log("saveMarkdown message received", { e });
                    // TODO: change this to update the document one vers at a time.
                    // this.updateTextDocument(document, JSON.parse(e.content));
                    return;
                case "update":
                    console.log("update message received", { e });
                    // TODO: change this to update the document one vers at a time.
                    this.updateTextDocument(document, JSON.parse(e.content));
                    return;
                case "getContent":
                    updateWebview();
                    return;
            }
        });

        updateWebview();
    }

    /**
     * Get the static html used for the editor webviews.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        console.log("getHtmlForWebview");
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexChunkEditor",
                "index.js",
            ),
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexChunkEditor",
                "index.css",
            ),
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <link rel="stylesheet" type="text/css" href="${styleUri}">
                <title>Codex Chunk Editor</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    /**
     * Try to get a current document as json text.
     */
    private getDocumentAsJson(document: vscode.TextDocument): any {
        const text = document.getText();
        if (text.trim().length === 0) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            throw new Error(
                "Could not get document as json. Content is not valid json",
            );
        }
    }

    /**
     * Write out the json to a given document.
     */
    private updateTextDocument(document: vscode.TextDocument, json: any) {
        const edit = new vscode.WorkspaceEdit();

        // Just replace the entire document every time for this example extension.
        // A more complete extension should compute minimal edits instead.
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(json, null, 2),
        );

        return vscode.workspace.applyEdit(edit);
    }
}
