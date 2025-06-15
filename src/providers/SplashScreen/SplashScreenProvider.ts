import * as vscode from "vscode";
import { ActivationTiming } from "../../extension";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";

export interface SyncDetails {
    progress: number;
    message: string;
    currentFile?: string;
}

export class SplashScreenProvider {
    public static readonly viewType = "codex-splash-screen";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _timings: ActivationTiming[] = [];
    private _activationStart: number = 0;
    private _syncDetails?: SyncDetails;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public dispose() {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    public async show(activationStart: number) {
        this._activationStart = activationStart;
        console.log("[SplashScreen] Attempting to show splash screen...");

        // If the panel is already showing, just reveal it
        if (this._panel) {
            console.log("[SplashScreen] Panel already exists, revealing...");
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // Create and show panel immediately - don't await UI commands that might delay visibility
        console.log("[SplashScreen] Creating new webview panel...");
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
        console.log("[SplashScreen] Panel created successfully");

        // Set webview options
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        // Immediately set the HTML content and reveal the panel
        this._updateWebview();
        this._panel.reveal(vscode.ViewColumn.One, true);
        console.log("[SplashScreen] Panel revealed with preserveFocus=true");

        // Ensure the splash screen has focus and is the active view
        setTimeout(() => {
            if (this._panel) {
                this._panel.reveal(vscode.ViewColumn.One, false); // false = take focus
                console.log("[SplashScreen] Panel re-revealed with focus");
            }
        }, 50);

        // Keep the splash screen in focus by periodically checking
        const focusInterval = setInterval(() => {
            if (this._panel && this._panel.visible) {
                // Only re-focus if we're still supposed to be showing
                this._panel.reveal(vscode.ViewColumn.One, true); // true = preserve focus

                // Check if webview content is lost (white screen) and restore if needed
                if (!this._panel.webview.html || this._panel.webview.html.length < 100) {
                    console.log("[SplashScreen] Webview content lost, restoring...");
                    this._updateWebview();
                }
            } else {
                // Stop checking if panel is gone
                clearInterval(focusInterval);
            }
        }, 1000); // Check every second

        // Execute UI commands in background after splash is visible
        setTimeout(async () => {
            try {
                // Maximize editor and hide tab bar after splash is shown
                await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
                console.log("[SplashScreen] Maximized editor layout");
            } catch (error) {
                console.warn("Failed to execute maximize command:", error);
            }
        }, 100);

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            console.log("[SplashScreen] Panel disposed");
            clearInterval(focusInterval); // Clean up the interval
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
        if (this._panel && !this._panel.webview) {
            console.log("[SplashScreen] Panel exists but webview is disposed, skipping update");
            return;
        }
        if (this._panel) {
            safePostMessageToPanel(this._panel, {
                command: "update",
                timings,
            }, "SplashScreen");
        }
    }

    public updateSyncDetails(details: SyncDetails) {
        this._syncDetails = details;
        if (this._panel && !this._panel.webview) {
            console.log(
                "[SplashScreen] Panel exists but webview is disposed, skipping sync update"
            );
            return;
        }
        if (this._panel) {
            safePostMessageToPanel(this._panel, {
                command: "syncUpdate",
                syncDetails: details,
            }, "SplashScreen");
        }
    }

    public markComplete() {
        console.log("[SplashScreen] markComplete() called");
        if (this._panel) {
            // Send message to the webview that loading is complete
            safePostMessageToPanel(this._panel, {
                command: "complete",
            }, "SplashScreen");
            console.log("[SplashScreen] Sent 'complete' message to webview");
        } else {
            console.log("[SplashScreen] No panel to mark complete");
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

        return getWebviewHtml(webview, { extensionUri: this._extensionUri } as vscode.ExtensionContext, {
            title: "Codex Editor Loading",
            scriptPath: ["SplashScreen", "index.js"],
            initialData: { timings: this._timings, syncDetails: this._syncDetails },
            inlineStyles: `
                body { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; background-color: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
                #root { height: 100%; width: 100%; }
            `,
            customScript: `
                const vscode = acquireVsCodeApi();
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message) {
                        const customEvent = new CustomEvent('vscode-message', { detail: message });
                        document.getElementById('root').dispatchEvent(customEvent);
                    }
                });
                window.addEventListener('animation-complete', () => {
                    vscode.postMessage({ command: 'animationComplete' });
                });
            `
        });
    }
}
