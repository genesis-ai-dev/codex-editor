import * as vscode from "vscode";
import { MessageType } from "./types";
import { createObsProject } from "./functions/createObsProject";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import staticLangs from "./data/langNames.json";

export class CreateProjectProvider implements vscode.WebviewViewProvider {
    private _webviewView: vscode.WebviewView | undefined;
    private _context: vscode.ExtensionContext | undefined;
    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new CreateProjectProvider(context);
        const providerRegistration = vscode.window.registerWebviewViewProvider(
            CreateProjectProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    private static readonly viewType = "scribe-vsc.obs-create-project";

    constructor(private readonly context: vscode.ExtensionContext) {
        this._context = context;
        this._registerCommands();
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
                    case MessageType.createProject:
                        await createObsProject(e.payload as any);
                        break;
                    case MessageType.SEARCH_QUERY: {
                        const query = e.payload as string;
                        const filteredLanguages = staticLangs.filter(
                            (language) =>
                                (language.ang || language.lc)
                                    .toLowerCase()
                                    .includes(query.toLowerCase()),
                        );
                        webviewPanel.webview.postMessage({
                            type: MessageType.SEARCH_RESULTS,
                            payload: filteredLanguages,
                        });
                        break;
                    }
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

    private async _registerCommands() {
        const commands: {
            command: string;
            title: string;
            handler: (...args: any[]) => any;
        }[] = [];

        const registeredCommands = await vscode.commands.getCommands();

        commands.forEach((command) => {
            if (!registeredCommands.includes(command.command)) {
                this._context?.subscriptions.push(
                    vscode.commands.registerCommand(
                        command.command,
                        command.handler,
                    ),
                );
            }
        });
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
            "CreateProject.js",
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
          <title>Sidebar vscode obs extension</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }
}
