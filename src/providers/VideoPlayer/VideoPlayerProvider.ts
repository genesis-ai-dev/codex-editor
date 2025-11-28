import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
export class VideoPlayerProvider
    implements vscode.TextDocumentContentProvider, vscode.CustomTextEditorProvider
{
    public static readonly viewType = "videoPlayerProvider";
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomDocument(
        document: vscode.CustomDocument,
        cancellationToken: vscode.CancellationToken
    ): Promise<void> {}

    provideTextDocumentContent(uri: vscode.Uri): string {
        return "Video Player Provider Content";
    }
    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "updateTimeStamp":
                    console.log("updateTimeStamp", message.timeStamp);
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return getWebviewHtml(webview, this.context, {
            title: "Codex Video Player",
            scriptPath: ["VideoPlayer", "index.js"],
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}' https://static.cloudflareinsights.com; connect-src https://*.vscode-cdn.net https://*.frontierrnd.com; worker-src ${webview.cspSource}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};`
        });
    }
}
