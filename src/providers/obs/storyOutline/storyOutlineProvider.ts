import * as vscode from "vscode";

import { VIEW_TYPES, getNonce, getUri } from "../utilities";
import { MessageType } from "../CreateProject/types";
import { initializeStateStore } from "../../../stateStore";

export class StoryOutlineProvider implements vscode.WebviewViewProvider {
    private _webviewView: vscode.WebviewView | undefined;
    private _context: vscode.ExtensionContext | undefined;
    private stateStore:
        | Awaited<ReturnType<typeof initializeStateStore>>
        | undefined;

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new StoryOutlineProvider(context);
        const providerRegistration = vscode.window.registerWebviewViewProvider(
            StoryOutlineProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    private static readonly viewType = "scribe-vsc.obs-outline";

    constructor(private readonly context: vscode.ExtensionContext) {
        this._context = context;
        this._registerCommands();
        initializeStateStore().then((stateStore) => {
            this.stateStore = stateStore;
        });
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
                    case MessageType.openStory: {
                        if (!vscode.workspace.workspaceFolders?.length) {
                            console.error("No workspace opened");
                            return;
                        }

                        if (!(e.payload as Record<string, any>).storyNumber) {
                            console.error("No story number provided");
                            return;
                        }
                        const storyURI = vscode.Uri.joinPath(
                            vscode.workspace?.workspaceFolders?.[0].uri,
                            "ingredients",
                            `${
                                (e.payload as Record<string, any>)?.storyNumber
                            }.md`,
                        );
                        await vscode.commands.executeCommand(
                            "vscode.openWith",
                            storyURI,
                            VIEW_TYPES.EDITOR,
                            {
                                preserveFocus: true,
                                preview: false,
                                viewColumn: vscode.ViewColumn.One,
                            },
                        );
                        await this._context?.workspaceState?.update(
                            "currentStoryId",
                            (e.payload as Record<string, any>)?.storyNumber,
                        );

                        if (!this.stateStore) {
                            this.stateStore = await initializeStateStore();
                        }

                        this.stateStore?.updateStoreState({
                            key: "obsRef",
                            value: {
                                storyId: (e.payload as Record<string, any>)
                                    ?.storyNumber,
                                paragraph: "1",
                            },
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
            "StoriesOutline.js",
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
