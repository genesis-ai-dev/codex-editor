import * as vscode from "vscode";
import { getProjectOverview } from "../../projectManager/utils/projectUtils";
import { getAuthApi } from "../../extension";
import { openSystemMessageEditor } from "../../copilotSettings/copilotSettings";
import { openProjectExportView } from "../../projectManager/projectExportView";
import { BaseWebviewProvider } from "../../globalProvider";

export interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

export interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId?: string;
    command?: string;
    description?: string;
}

export class MainMenuProvider extends BaseWebviewProvider {
    public static readonly viewType = "codex-editor.mainMenu";
    private disposables: vscode.Disposable[] = [];
    private frontierApi?: any;

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
        {
            title: "Project",
            buttons: [
                {
                    id: "copilot-settings",
                    label: "Copilot Settings",
                    icon: "settings",
                    command: "openAISettings",
                    description: "Configure AI translation assistance",
                },
                {
                    id: "export-project",
                    label: "Export Project",
                    icon: "export",
                    command: "openExportView",
                    description: "Export your translation project",
                },
                {
                    id: "publish-project",
                    label: "Publish Project",
                    icon: "cloud-upload",
                    command: "publishProject",
                    description: "Publish your project to the cloud",
                },
                {
                    id: "close-project",
                    label: "Close Project",
                    icon: "close",
                    command: "closeProject",
                    description: "Close the current project",
                },
            ],
        },
    ];

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.initializeFrontierApi();
    }

    protected getWebviewId(): string {
        return "mainMenu-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["MainMenu", "index.js"];
    }

    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
        } catch (error) {
            console.error("Error initializing Frontier API:", error);
        }
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        this.sendMenuConfigToWebview();
    }

    protected onWebviewReady(): void {
        this.sendMenuConfigToWebview();
    }

    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case "executeCommand":
                try {
                    await this.executeCommand(message.commandName);
                } catch (error) {
                    console.error("Error executing command:", error);
                    vscode.window.showErrorMessage(`Error executing command: ${error}`);
                }
                break;
        }
    }

    private async executeCommand(commandName: string): Promise<void> {
        switch (commandName) {
            case "openAISettings":
                await openSystemMessageEditor();
                break;
            case "openExportView":
                await openProjectExportView(this._context);
                break;
            case "publishProject":
                await this.publishProject();
                break;
            case "closeProject":
                await this.closeProject();
                break;
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async publishProject(): Promise<void> {
        try {
            const projectOverview = await getProjectOverview();
            const projectName = projectOverview?.projectName || "";
            const projectId = projectOverview?.projectId || "";

            if (!projectName) {
                vscode.window.showErrorMessage("No project name found");
                return;
            }

            const sanitizedName = `${projectName}-${projectId}`
                .toLowerCase()
                .replace(/[^a-z0-9._-]/g, "-")
                .replace(/^-+|-+$/g, "")
                .replace(/\.git$/i, "");

            await this.frontierApi?.publishWorkspace({
                name: sanitizedName,
                visibility: "private",
            });
        } catch (error) {
            console.error("Error publishing project:", error);
            vscode.window.showErrorMessage(`Failed to publish project: ${(error as Error).message}`);
        }
    }

    private async closeProject(): Promise<void> {
        try {
            const answer = await vscode.window.showWarningMessage(
                "Are you sure you want to close this project?",
                { modal: true },
                "Yes",
                "No"
            );

            if (answer === "Yes") {
                await vscode.commands.executeCommand("workbench.action.closeFolder");
            }
        } catch (error) {
            console.error("Error closing project:", error);
            vscode.window.showErrorMessage(
                `Failed to close project: ${(error as Error).message}`
            );
        }
    }

    private sendMenuConfigToWebview(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: "updateMenu",
                menuConfig: this.menuConfig,
            });
        }
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


