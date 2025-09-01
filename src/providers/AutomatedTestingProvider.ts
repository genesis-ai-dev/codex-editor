import * as vscode from "vscode";
import { BaseWebviewProvider } from "../globalProvider";
import { safePostMessageToView } from "../utils/webviewUtils";

export class AutomatedTestingProvider extends BaseWebviewProvider {
    public static readonly viewType = "codex-editor.automatedTesting";

    constructor(context: vscode.ExtensionContext) {
        super(context);
    }

    protected getWebviewId(): string {
        return "automated-testing-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["AutomatedTesting", "index.js"];
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        safePostMessageToView(webviewView, { command: "webviewReady" }, "AutomatedTesting");
    }

    protected async handleMessage(message: any): Promise<void> {
        console.log('[AutomatedTestingProvider] Received message:', JSON.stringify(message, null, 2));
        switch (message.command) {
            case "testConnection": {
                console.log('[AutomatedTestingProvider] Test connection received!');
                if (this._view) {
                    this._view.webview.postMessage({ command: "testConnectionResponse", data: { success: true } });
                }
                break;
            }
            case "runTest": {
                const { cellIds, count = 10, onlyValidated = false } = message.data || {};
                try {
                    const result = await vscode.commands.executeCommand(
                        "codex-testing.runTest",
                        { cellIds, count, onlyValidated }
                    );
                    if (this._view && result) {
                        this._view.webview.postMessage({ command: "testResults", data: result });
                    }
                } catch (e) {
                    console.error("Test failed:", e);
                    if (this._view) {
                        this._view.webview.postMessage({
                            command: "testResults",
                            data: { averageCHRF: 0, results: [], error: String(e) }
                        });
                    }
                }
                break;
            }
            case "getHistory": {
                console.log('[AutomatedTestingProvider] Processing getHistory command');
                try {
                    const history = await vscode.commands.executeCommand(
                        "codex-testing.getTestHistory"
                    );
                    console.log('[AutomatedTestingProvider] History data received:', JSON.stringify(history, null, 2));
                    if (this._view) {
                        this._view.webview.postMessage({ command: "historyData", data: history });
                    }
                } catch (e) {
                    console.error('[AutomatedTestingProvider] Failed to load history:', e);
                    if (this._view) {
                        this._view.webview.postMessage({ command: "historyData", data: [] });
                    }
                }
                break;
            }
            case "loadTest": {
                const { path } = message.data || {};
                if (!path) return;
                try {
                    const data: any = await vscode.commands.executeCommand(
                        "codex-testing.loadTest",
                        path
                    );
                    if (this._view) {
                        this._view.webview.postMessage({ command: "testResults", data });
                    }
                } catch (e) {
                    console.error("Failed to load test:", e);
                }
                break;
            }
            case "populateCellIds": {
                const { path } = message.data || {};
                if (!path) return;
                try {
                    const data: any = await vscode.commands.executeCommand(
                        "codex-testing.loadTest",
                        path
                    );
                    if (this._view && Array.isArray(data?.results)) {
                        const cellIds = (data.results as any[]).map((r: any) => r.cellId).join(", ");
                        this._view.webview.postMessage({ command: "cellIdsPopulated", data: { cellIds } });
                    }
                } catch (e) {
                    console.error("Failed to populate cell IDs:", e);
                }
                break;
            }
            case "reapplyConfig": {
                const { path } = message.data || {};
                if (!path) return;
                try {
                    const ok = await vscode.commands.executeCommand(
                        "codex-testing.reapplyConfigForTest",
                        path
                    );
                    if (this._view) {
                        this._view.webview.postMessage({ command: "configReapplied", data: { ok } });
                    }
                } catch (e) {
                    console.error("Failed to reapply config:", e);
                    if (this._view) {
                        this._view.webview.postMessage({ command: "configReapplied", data: { ok: false } });
                    }
                }
                break;
            }
            case "deleteTest": {
                console.log('[AutomatedTestingProvider] Processing deleteTest command');
                const { path } = message.data || {};
                console.log('[AutomatedTestingProvider] Delete path:', path);
                if (!path) {
                    console.error('[AutomatedTestingProvider] No path provided for deleteTest');
                    return;
                }
                try {
                    console.log('[AutomatedTestingProvider] Executing codex-testing.deleteTest command with path:', path);
                    const success = await vscode.commands.executeCommand(
                        "codex-testing.deleteTest",
                        path
                    );
                    console.log('[AutomatedTestingProvider] Delete command result:', success);
                    if (this._view) {
                        console.log('[AutomatedTestingProvider] Sending testDeleted response:', { success });
                        this._view.webview.postMessage({ command: "testDeleted", data: { success } });
                    }
                } catch (e) {
                    console.error('[AutomatedTestingProvider] Failed to delete test:', e);
                    if (this._view) {
                        this._view.webview.postMessage({ command: "testDeleted", data: { success: false } });
                    }
                }
                break;
            }
        }
    }
}


