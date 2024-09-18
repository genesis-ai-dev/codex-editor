import * as vscode from "vscode";
import { Dictionary, DictionaryEntry } from "codex-types";
import { getNonce } from "./utilities/getNonce";
import { DictionaryPostMessages, DictionaryReceiveMessages } from "../../../types";

export class DictionaryEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "codex.dictionaryEditor";

    constructor(private readonly context: vscode.ExtensionContext) { }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new DictionaryEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            DictionaryEditorProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        const updateWebview = () => {
            const dictionaryContent = this.getDocumentAsJson(document);
            webviewPanel.webview.postMessage({
                command: "providerTellsWebviewToUpdateData",
                data: dictionaryContent,
            } as DictionaryReceiveMessages);
        };

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage(async (e: DictionaryPostMessages) => {
            switch (e.command) {
                case "webviewTellsProviderToUpdateData":
                    console.log("updateData received in DictionaryEditorProvider", e.data);
                    this.updateTextDocument(document, e.data);
                    return;
                case "webviewAsksProviderToConfirmRemove": {
                    console.log("confirmRemove received in DictionaryEditorProvider", e.count);
                    const confirmed = await vscode.window.showInformationMessage(
                        `Are you sure you want to remove ${e.count} item${e.count > 1 ? 's' : ''}?`,
                        { modal: true },
                        "Yes",
                        "No",
                    );
                    if (confirmed === "Yes") {
                        webviewPanel.webview.postMessage({
                            command: "providerTellsWebviewRemoveConfirmed",
                        } as DictionaryReceiveMessages);
                    }
                    break;
                }
            }
        });

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, "src", "assets", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, "src", "assets", "vscode.css"));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css"));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, "webviews", "codex-webviews", "dist", "EditableReactTable", "index.js"));

        const nonce = getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Dictionary Editor</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private getDocumentAsJson(document: vscode.TextDocument): Dictionary {
        const text = document.getText();
        if (text.trim().length === 0) {
            return { id: "", label: "", entries: [], metadata: {} };
        }

        try {
            return JSON.parse(text);
        } catch {
            throw new Error("Could not get document as json. Content is not valid json");
        }
    }

    private updateTextDocument(document: vscode.TextDocument, dictionary: Dictionary) {
        const edit = new vscode.WorkspaceEdit();

        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(dictionary, null, 2)
        );

        return vscode.workspace.applyEdit(edit);
    }
}