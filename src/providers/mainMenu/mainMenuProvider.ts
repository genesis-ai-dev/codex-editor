import * as vscode from "vscode";
import * as path from "path";

export interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

export interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId: string;
    description?: string;
}

export class MainMenuProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "codex-editor.mainMenu";
    private _view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];

    // Define the menu structure here
    private menuConfig: MenuSection[] = [
        {
            title: "Navigation",
            buttons: [
                {
                    id: "navigation",
                    label: "Your Translations",
                    icon: "compass",
                    viewId: "codex-editor.navigation",
                    description: "Browse and open files in your project",
                },
            ],
        },
        {
            title: "Tools",
            buttons: [
                {
                    id: "project-manager",
                    label: "Project Settings",
                    icon: "settings",
                    viewId: "project-manager-sidebar",
                    description: "Manage your translation project",
                },
                {
                    id: "parallel-passages",
                    label: "Parallel Passages",
                    icon: "eye",
                    viewId: "parallel-passages-sidebar",
                    description: "Compare passages across texts",
                },
               // removed semantic view for now as it needs complete redo
            ],
        },
        {
            title: "Communication",
            buttons: [
                // {
                //     id: "translator-copilot",
                //     label: "Translator's Copilot",
                //     icon: "comment-discussion",
                //     viewId: "genesis-translator-sidebar",
                //     description: "AI assistance for translation",
                // },
                {
                    id: "comments",
                    label: "Comments",
                    icon: "note",
                    viewId: "comments-sidebar",
                    description: "View and manage comments",
                },
            ],
        },
    ];

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        // Set up the HTML content
        webviewView.webview.html = await this.getHtmlForWebview(webviewView);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "focusView":
                    try {
                        // Focus the requested view
                        await vscode.commands.executeCommand(`${message.viewId}.focus`);
                    } catch (error) {
                        console.error("Error focusing view:", error);
                        vscode.window.showErrorMessage(`Error focusing view: ${error}`);
                    }
                    break;
                case "webviewReady":
                    this.sendMenuConfigToWebview();
                    break;
            }
        });

        // Send the menu configuration to the webview
        this.sendMenuConfigToWebview();
    }

    private sendMenuConfigToWebview(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: "updateMenu",
                menuConfig: this.menuConfig,
            });
        }
    }

    private async getHtmlForWebview(webviewView: vscode.WebviewView): Promise<string> {
        const styleResetUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const scriptUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "MainMenu",
                "index.js"
            )
        );
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const nonce = this.getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                    img-src ${webviewView.webview.cspSource} https: data:;
                    style-src ${webviewView.webview.cspSource} 'unsafe-inline';
                    script-src 'nonce-${nonce}';
                    font-src ${webviewView.webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Codex Main Menu</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private getNonce(): string {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public dispose(): void {
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
