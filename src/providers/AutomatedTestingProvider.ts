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
        switch (message.command) {
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
                try {
                    const history = await vscode.commands.executeCommand(
                        "codex-testing.getTestHistory"
                    );
                    if (this._view) {
                        this._view.webview.postMessage({ command: "historyData", data: history });
                    }
                } catch (e) {
                    console.error("Failed to load history:", e);
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
                    const data = await vscode.commands.executeCommand(
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
                    const data = await vscode.commands.executeCommand(
                        "codex-testing.loadTest",
                        path
                    );
                    if (this._view && data?.results) {
                        const cellIds = data.results.map((r: any) => r.cellId).join(", ");
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
        }
    }
}


