import * as vscode from "vscode";
import { getDownloadedResourcesFromProjectConfig } from "../obs/resources/functions/projectConfig";
import { MessageType } from "../obs/CreateProject/types";
import { getNonce, getUri } from "../obs/utilities";
import { ResourcesProvider } from "../obs/resources/resourcesProvider";

export class DownloadedResourcesProvider implements vscode.WebviewViewProvider {
    private _webviewView: vscode.WebviewView | undefined;
    private _context: vscode.ExtensionContext | undefined;

    private resourcesProvider: ResourcesProvider;

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new DownloadedResourcesProvider(context);
        const providerRegistration = vscode.window.registerWebviewViewProvider(
            DownloadedResourcesProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    private static readonly viewType = "codex.downloaded-resources";

    constructor(private readonly context: vscode.ExtensionContext) {
        this._context = context;
        this.resourcesProvider = new ResourcesProvider(context);
    }

    public async resolveWebviewView(
        webviewPanel: vscode.WebviewView,
        ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this._getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
        );

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                switch (e.type) {
                    case MessageType.OPEN_RESOURCE:
                        console.log("Opening resource: ", e.payload);
                        this.resourcesProvider._openResource(
                            (e.payload as any)?.resource as any,
                        );
                        break;

                    case MessageType.SYNC_DOWNLOADED_RESOURCES:
                        await this.resourcesProvider
                            .syncDownloadedResources(this._webviewView)
                            .then(() => {
                                console.log(
                                    "Downloaded resources synced! From the action!",
                                );
                            });
                        break;
                    default:
                        break;
                }
            },
        );

        this._webviewView = webviewPanel;
    }

    public revive(panel: vscode.WebviewView) {
        this._webviewView = panel;
    }

    private _getWebviewContent(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
    ) {
        // The CSS file from the React build output

        const stylesUri = getUri(webview, extensionUri, [
            "webviews",
            "obs",
            "build",
            "assets",
            "index.css",
        ]);
        // The View JS file from the React build output
        const scriptUri = getUri(webview, extensionUri, [
            "webviews",
            "obs",
            "build",
            "assets",
            "views",
            "DownloadedResources.js",
        ]);

        const codiconsUri = getUri(webview, extensionUri, [
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css",
        ]);

        const nonce = getNonce();

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <!-- <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"> -->
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <link href="${codiconsUri}" rel="stylesheet" />
          <title>Sidebar vscode obs Resources</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }
}
