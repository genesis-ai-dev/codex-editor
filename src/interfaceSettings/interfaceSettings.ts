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
        const cellsPerPage = config.get<number>("cellsPerPage", 50);
        const useSubdivisionNumberLabels = config.get<boolean>(
            "useSubdivisionNumberLabels",
            false
        );

        panel.webview.postMessage({
            command: "init",
            data: {
                highlightSearchResults,
                cellsPerPage,
                useSubdivisionNumberLabels,
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

            case "updateCellsPerPage": {
                // Clamp to the range declared in package.json so invalid input
                // cannot corrupt pagination. Pull bounds from the schema-defined
                // minimum/maximum rather than hardcoding them in multiple places.
                const raw = Number(message.value);
                if (!Number.isFinite(raw)) break;
                const clamped = Math.max(5, Math.min(200, Math.round(raw)));
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                await config.update(
                    "cellsPerPage",
                    clamped,
                    vscode.ConfigurationTarget.Workspace
                );
                break;
            }

            case "updateUseSubdivisionNumberLabels": {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                await config.update(
                    "useSubdivisionNumberLabels",
                    Boolean(message.value),
                    vscode.ConfigurationTarget.Workspace
                );
                break;
            }
        }
    });

    // Keep the panel in sync when settings change from elsewhere (e.g. the
    // VS Code Settings UI). Disposed together with the panel below.
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (
            e.affectsConfiguration("codex-editor-extension.highlightSearchResults") ||
            e.affectsConfiguration("codex-editor-extension.cellsPerPage") ||
            e.affectsConfiguration("codex-editor-extension.useSubdivisionNumberLabels")
        ) {
            sendInit();
        }
    });

    panel.onDidDispose(() => {
        configListener.dispose();
    });
}
