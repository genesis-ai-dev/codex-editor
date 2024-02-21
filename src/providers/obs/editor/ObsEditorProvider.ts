import * as vscode from "vscode";
import { OpenResource } from "../resources/types";
import { MessageType } from "../CreateProject/types";
import { VIEW_TYPES, getNonce, getUri } from "../utilities";

export class ObsEditorProvider implements vscode.CustomTextEditorProvider {
    private _webview: vscode.Webview | undefined;
    private _context: vscode.ExtensionContext | undefined;
    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new ObsEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ObsEditorProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    static readonly viewType = VIEW_TYPES.EDITOR;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._context = context;
        this._registerCommands();
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this._getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
        );

        const context = this._context;

        function updateWebview() {
            const allResources = (context?.workspaceState.get(
                "openResources",
                [],
            ) ?? []) as OpenResource[];
            const docPath = document.uri.path;

            webviewPanel.webview.postMessage({
                type: "update",
                payload: {
                    doc: document.getText(),
                    isReadonly: docPath.includes("resources"), // if the document is in the resources folder, it's readonly
                },
            });
        }

        webviewPanel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
                updateWebview();
            }
        });

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    updateWebview();
                }
            });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                switch (e.type) {
                    case MessageType.showDialog:
                        vscode.window.showInformationMessage(
                            e.payload as string,
                        );
                        return;
                    case MessageType.save: {
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(
                            document.uri,
                            new vscode.Range(0, 0, document.lineCount, 0),
                            e.payload as string,
                        );
                        vscode.workspace.applyEdit(edit);
                        return;
                    }

                    // case MessageType.openResource:
                    //   const path = (e.payload as Record<string, unknown>)?.path;
                    //   const allResources =
                    //     this._context?.workspaceState.get("openResources", []) ?? [];
                    //   const newResources = [...allResources, path];
                    //   // save to workspace state
                    //   await this._context?.workspaceState.update(
                    //     "openResources",
                    //     newResources
                    //   );
                    //   this._openFile(path as string);
                }
            },
        );

        this._webview = webviewPanel.webview;

        updateWebview();
    }

    private async _registerCommands() {
        const commands = [
            {
                command: "scribe-vsc.helloWorld",
                title: "Hello World from vscodium scribe obs!",
                handler: () => {
                    vscode.window.showInformationMessage(
                        "Hello World from vscodium scribe obs!",
                    );
                    this._webview?.postMessage({
                        type: MessageType.showDialog,
                        payload: "Hello World from vscodium scribe obs!",
                    });
                },
            },
        ];

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
            "Editor.js",
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
          <title>Hello World</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }

    private _getExtensionFromPath(path: string) {
        const split = path.split(".");
        return split[split.length - 1];
    }

    private async _openFile(path: string) {
        const uri = vscode.Uri.file(path);
        await vscode.commands.executeCommand(
            "vscode.openWith",
            uri,
            this._getExtensionFromPath(path) === "md"
                ? VIEW_TYPES.EDITOR
                : "default",
            vscode.ViewColumn.Beside,
        );
    }
}
