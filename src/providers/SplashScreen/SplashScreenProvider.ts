import * as vscode from "vscode";
import { ActivationTiming } from "../../extension";

export class SplashScreenProvider {
    public static readonly viewType = "codex-splash-screen";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _timings: ActivationTiming[] = [];
    private _activationStart: number = 0;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public dispose() {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    public async show(activationStart: number) {
        this._activationStart = activationStart;

        // If the panel is already showing, just reveal it
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // Create a new panel
        this._panel = vscode.window.createWebviewPanel(
            SplashScreenProvider.viewType,
            "Codex Editor",
            {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            },
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        // Set webview options
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        // Make the panel stay on top
        this._panel.reveal(vscode.ViewColumn.One, true);

        // Maximize editor and hide tab bar after splash is shown
        await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");

        // Set the initial HTML content
        this._updateWebview();

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "animationComplete":
                    this._panel?.dispose();
                    break;
                case "close":
                    this._panel?.dispose();
                    break;
            }
        });
    }

    public updateTimings(timings: ActivationTiming[]) {
        this._timings = timings;
        if (this._panel) {
            // Send message to the webview to update timings
            this._panel.webview.postMessage({
                command: "update",
                timings,
            });
        }
    }

    public markComplete() {
        if (this._panel) {
            // Send message to the webview that loading is complete
            this._panel.webview.postMessage({
                command: "complete",
            });
        }
    }

    public close() {
        this._panel?.dispose();
    }

    public get panel(): vscode.WebviewPanel | undefined {
        return this._panel;
    }

    private _updateWebview() {
        if (!this._panel) return;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel!.webview;

        // Get path to the SplashScreen webview built files
        // The file is in webviews/codex-webviews/dist/SplashScreen/
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "SplashScreen",
                "index.js"
            )
        );

        // No separate CSS file is needed as Vite injects it into JS by default

        // Send initial timing data
        const initialState = {
            timings: this._timings,
        };

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Codex Editor Loading</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    width: 100vw;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                
                #root {
                    height: 100%;
                    width: 100%;
                }
            </style>
        </head>
        <body>
            <div id="root"></div>
            <script>
                // Initialize with timing data
                window.initialState = ${JSON.stringify(initialState)};
                
                // Setup communication with extension
                const vscode = acquireVsCodeApi();
                
                // Listen for messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message) {
                        // Dispatch custom event to React app
                        const customEvent = new CustomEvent('vscode-message', { detail: message });
                        document.getElementById('root').dispatchEvent(customEvent);
                    }
                });
                
                // Forward animation complete messages to extension
                window.addEventListener('animation-complete', () => {
                    vscode.postMessage({ command: 'animationComplete' });
                });
            </script>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}
