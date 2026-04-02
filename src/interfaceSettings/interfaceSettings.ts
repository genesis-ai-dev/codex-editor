import * as vscode from "vscode";
import { applyTextDisplaySettings } from "../utils/textDisplaySettingsUtils";

const HIGHLIGHT_SEARCH_RESULTS_KEY = "codex-editor-extension.highlightSearchResults";

export async function openInterfaceSettings() {
    const panel = vscode.window.createWebviewPanel(
        "interfaceSettingsEditor",
        "Interface Settings",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    const extensionUri = vscode.extensions.getExtension(
        "project-accelerate.codex-editor-extension"
    )!.extensionUri;

    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "InterfaceSettings",
            "index.js"
        )
    );
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "node_modules",
            "@vscode",
            "codicons",
            "dist",
            "codicon.css"
        )
    );

    const nonce = Math.random().toString(36).slice(2);

    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    panel.webview.html = `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${codiconsUri}" rel="stylesheet">
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;

    const sendInit = () => {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        const highlightSearchResults = config.get<boolean>("highlightSearchResults", true);

        panel.webview.postMessage({
            command: "init",
            data: {
                highlightSearchResults,
            },
        });
    };

    sendInit();

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "webviewReady":
                sendInit();
                break;

            case "applyTextDisplaySettings":
                try {
                    await applyTextDisplaySettings(message.data);
                } catch (error) {
                    console.error("Error applying text display settings:", error);
                    vscode.window.showErrorMessage(
                        `Failed to apply text display settings: ${error}`
                    );
                }
                break;

            case "updateHighlightSearchResults": {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                await config.update(
                    "highlightSearchResults",
                    message.value,
                    vscode.ConfigurationTarget.Workspace
                );
                break;
            }
        }
    });
}
