import * as vscode from "vscode";
import {
    ProjectStandard,
    StandardViolation,
    ProjectStandardsWebviewMessage,
    ProjectStandardsProviderMessage,
} from "../../../types";
import {
    loadStandards,
    addStandard,
    updateStandard,
    deleteStandard,
    toggleStandard,
    isStandardTypeSupported,
} from "../services/standardsStorage";
import {
    scanForViolations,
    scanAllStandards,
    getViolationCounts,
    testRegexPattern,
    generateRegexFromExamples,
    clearViolationCache,
    clearAllViolationCaches,
} from "../services/standardsEngine";
import { jumpToViolationCell } from "../utils/cellNavigation";
import { getWebviewHtml } from "../../utils/webviewTemplate";

export class ProjectStandardsProvider implements vscode.Disposable {
    public static readonly viewType = "codex-editor.projectStandards";
    private _panel?: vscode.WebviewPanel;
    private _standards: ProjectStandard[] = [];
    private _violationCounts: Record<string, number> = {};
    private _focusModeEnabled = false;
    private _disposables: vscode.Disposable[] = [];
    private _isScanning = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) { }

    dispose(): void {
        this._panel?.dispose();
        this._panel = undefined;

        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    /**
     * Show the Project Standards panel.
     * Creates a new panel if one doesn't exist, otherwise reveals the existing one.
     */
    public async show(): Promise<void> {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            ProjectStandardsProvider.viewType,
            "Project Standards",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, "webviews", "codex-webviews", "dist"),
                    vscode.Uri.joinPath(this._extensionUri, "src", "assets"),
                    vscode.Uri.joinPath(this._extensionUri, "node_modules", "@vscode", "codicons", "dist"),
                ],
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, this._disposables);

        // Set up message handling
        this._panel.webview.onDidReceiveMessage(
            (message: ProjectStandardsWebviewMessage) => this._handleMessage(message),
            null,
            this._disposables
        );

        // Set webview HTML
        this._panel.webview.html = this._getHtmlForWebview();

        // Load initial data
        await this._loadAndSendStandards();
    }

    /**
     * Handle messages from the webview.
     */
    private async _handleMessage(message: ProjectStandardsWebviewMessage): Promise<void> {
        try {
            switch (message.command) {
                case "getStandards":
                    await this._loadAndSendStandards();
                    break;

                case "scanStandards":
                    await this._scanAllStandards();
                    break;

                case "getViolations":
                    await this._getViolationsForStandard(message.standardId);
                    break;

                case "createStandard":
                    await this._createStandard(message.standard);
                    break;

                case "updateStandard":
                    await this._updateStandard(message.standard);
                    break;

                case "deleteStandard":
                    await this._deleteStandard(message.standardId);
                    break;

                case "toggleStandard":
                    await this._toggleStandard(message.standardId, message.enabled);
                    break;

                case "toggleFocusMode":
                    this._toggleFocusMode(message.enabled);
                    break;

                case "jumpToCell":
                    await this._jumpToCell(message.violation);
                    break;

                case "generateRegex":
                    await this._generateRegex(message.description, message.examples);
                    break;

                case "testRegex":
                    await this._testRegex(message.pattern);
                    break;

                default:
                    console.warn("[ProjectStandardsProvider] Unknown message:", message);
            }
        } catch (error) {
            console.error("[ProjectStandardsProvider] Error handling message:", error);
            this._sendMessage({
                type: "error",
                message: (error as Error).message,
            });
        }
    }

    /**
     * Load standards from storage and send to webview.
     */
    private async _loadAndSendStandards(): Promise<void> {
        this._standards = await loadStandards(this._context.workspaceState);

        this._sendMessage({
            type: "standardsLoaded",
            standards: this._standards,
        });

        // Also send current focus mode state
        this._sendMessage({
            type: "focusModeChanged",
            enabled: this._focusModeEnabled,
        });
    }

    /**
     * Scan all standards for violations.
     */
    private async _scanAllStandards(): Promise<void> {
        if (this._isScanning) {
            return;
        }

        this._isScanning = true;

        try {
            const enabledStandards = this._standards.filter(
                (s) => s.enabled && isStandardTypeSupported(s.standardType) && !this._focusModeEnabled
            );

            const allViolations = await scanAllStandards(
                enabledStandards,
                (processed, total, currentStandard) => {
                    this._sendMessage({
                        type: "scanProgress",
                        progress: processed,
                        total,
                    });
                }
            );

            // Build violation counts
            this._violationCounts = {};
            for (const [standardId, violations] of allViolations) {
                this._violationCounts[standardId] = violations.length;
            }

            this._sendMessage({
                type: "scanComplete",
                violationCounts: this._violationCounts,
            });
        } finally {
            this._isScanning = false;
        }
    }

    /**
     * Get violations for a specific standard.
     */
    private async _getViolationsForStandard(standardId: string): Promise<void> {
        const standard = this._standards.find((s) => s.id === standardId);

        if (!standard) {
            this._sendMessage({
                type: "error",
                message: `Standard not found: ${standardId}`,
            });
            return;
        }

        const violations = await scanForViolations(standard);

        this._sendMessage({
            type: "violationsLoaded",
            standardId,
            violations,
        });
    }

    /**
     * Create a new standard.
     */
    private async _createStandard(
        standardData: Omit<ProjectStandard, "id" | "createdAt" | "updatedAt">
    ): Promise<void> {
        const newStandard = await addStandard(this._context.workspaceState, standardData);
        this._standards.push(newStandard);

        // Rescan to get violation count for new standard
        if (newStandard.enabled && isStandardTypeSupported(newStandard.standardType)) {
            const violations = await scanForViolations(newStandard);
            this._violationCounts[newStandard.id] = violations.length;
        }

        await this._loadAndSendStandards();
        this._sendMessage({
            type: "scanComplete",
            violationCounts: this._violationCounts,
        });
    }

    /**
     * Update an existing standard.
     */
    private async _updateStandard(standard: ProjectStandard): Promise<void> {
        await updateStandard(this._context.workspaceState, standard);

        // Clear violation cache for this standard
        clearViolationCache(standard.id);

        // Update local state
        const index = this._standards.findIndex((s) => s.id === standard.id);
        if (index !== -1) {
            this._standards[index] = standard;
        }

        // Rescan if enabled
        if (standard.enabled && isStandardTypeSupported(standard.standardType)) {
            const violations = await scanForViolations(standard);
            this._violationCounts[standard.id] = violations.length;
        }

        await this._loadAndSendStandards();
        this._sendMessage({
            type: "scanComplete",
            violationCounts: this._violationCounts,
        });
    }

    /**
     * Delete a standard.
     */
    private async _deleteStandard(standardId: string): Promise<void> {
        await deleteStandard(this._context.workspaceState, standardId);

        // Clear violation cache
        clearViolationCache(standardId);
        delete this._violationCounts[standardId];

        // Update local state
        this._standards = this._standards.filter((s) => s.id !== standardId);

        await this._loadAndSendStandards();
    }

    /**
     * Toggle a standard's enabled state.
     */
    private async _toggleStandard(standardId: string, enabled: boolean): Promise<void> {
        this._standards = await toggleStandard(
            this._context.workspaceState,
            standardId,
            enabled,
            this._standards
        );

        // If enabling, scan for violations
        if (enabled) {
            const standard = this._standards.find((s) => s.id === standardId);
            if (standard && isStandardTypeSupported(standard.standardType)) {
                const violations = await scanForViolations(standard);
                this._violationCounts[standardId] = violations.length;
            }
        }

        await this._loadAndSendStandards();
        this._sendMessage({
            type: "scanComplete",
            violationCounts: this._violationCounts,
        });
    }

    /**
     * Toggle focus mode (disable all standards temporarily).
     */
    private _toggleFocusMode(enabled: boolean): void {
        this._focusModeEnabled = enabled;

        this._sendMessage({
            type: "focusModeChanged",
            enabled,
        });

        // Clear violation counts when focus mode is enabled
        if (enabled) {
            this._sendMessage({
                type: "scanComplete",
                violationCounts: {},
            });
        } else {
            // Re-scan when focus mode is disabled
            this._scanAllStandards();
        }
    }

    /**
     * Navigate to a cell with a violation.
     */
    private async _jumpToCell(violation: StandardViolation): Promise<void> {
        await jumpToViolationCell(this._context, violation);
    }

    /**
     * Generate a regex pattern from examples using LLM.
     */
    private async _generateRegex(description: string, examples: string[]): Promise<void> {
        try {
            const pattern = await generateRegexFromExamples(description, examples);

            this._sendMessage({
                type: "regexGenerated",
                pattern,
            });
        } catch (error) {
            this._sendMessage({
                type: "regexGenerated",
                pattern: "",
                error: (error as Error).message,
            });
        }
    }

    /**
     * Test a regex pattern against cells.
     */
    private async _testRegex(pattern: string): Promise<void> {
        try {
            const { matches, totalCount } = await testRegexPattern(pattern, 10);

            this._sendMessage({
                type: "regexTestResult",
                matches: matches.map((m) => m.matchText),
                matchCount: totalCount,
            });
        } catch (error) {
            this._sendMessage({
                type: "error",
                message: (error as Error).message,
            });
        }
    }

    /**
     * Send a message to the webview.
     */
    private _sendMessage(message: ProjectStandardsProviderMessage): void {
        if (this._panel) {
            this._panel.webview.postMessage(message);
        }
    }

    /**
     * Generate the HTML for the webview.
     */
    private _getHtmlForWebview(): string {
        return getWebviewHtml(this._panel!.webview, this._context, {
            title: "Project Standards",
            scriptPath: ["ProjectStandards", "index.js"],
        });
    }
}

// Singleton instance for global access
let globalProvider: ProjectStandardsProvider | null = null;

/**
 * Get or create the global Project Standards provider.
 */
export function getProjectStandardsProvider(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
): ProjectStandardsProvider {
    if (!globalProvider) {
        globalProvider = new ProjectStandardsProvider(extensionUri, context);
    }
    return globalProvider;
}

/**
 * Show the Project Standards panel.
 */
export async function showProjectStandardsPanel(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<void> {
    const provider = getProjectStandardsProvider(extensionUri, context);
    await provider.show();
}

/**
 * Dispose the global provider.
 */
export function disposeProjectStandardsProvider(): void {
    if (globalProvider) {
        globalProvider.dispose();
        globalProvider = null;
    }
}
