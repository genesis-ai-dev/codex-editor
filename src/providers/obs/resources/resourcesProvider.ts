import * as vscode from "vscode";
import { MessageType } from "../CreateProject/types";
import { downloadResource } from "./functions/download";
import {
    addDownloadedResourceToProjectConfig,
    getDownloadedResourcesFromProjectConfig,
} from "./functions/projectConfig";
import {
    openBible,
    openOBS,
    openObsTn,
    openObsTq,
    openObsTwl,
    openTn,
    openTnAcademy,
    openTq,
    openTranslationHelper,
    openTw,
    openTwl,
} from "./functions/openResource";
import { getUri } from "../CreateProject/utilities/getUri";
import { getNonce } from "../CreateProject/utilities/getNonce";
import { DownloadedResource, OpenResource } from "./types";

export class ResourcesProvider implements vscode.WebviewViewProvider {
    private _webviewView: vscode.WebviewView | undefined;
    private _context: vscode.ExtensionContext | undefined;
    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new ResourcesProvider(context);
        const providerRegistration = vscode.window.registerWebviewViewProvider(
            ResourcesProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    public static async initProjectResources(context: vscode.ExtensionContext) {
        const resources = await getDownloadedResourcesFromProjectConfig();
        context.workspaceState.update("downloadedResources", resources);
    }

    private static readonly viewType = "scribe-vsc.obs-resources";

    constructor(private readonly context: vscode.ExtensionContext) {
        this._context = context;
        this._registerCommands();
    }

    public async resolveWebviewView(
        webviewPanel: vscode.WebviewView,
        ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this._getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
        );

        const disposable = vscode.window.tabGroups.onDidChangeTabs((e) => {
            this.syncDownloadedResources();
        });

        this._context?.subscriptions.push(disposable);

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                switch (e.type) {
                    case MessageType.DOWNLOAD_RESOURCE: {
                        const context = this._context;
                        if (!context) {
                            console.error(
                                "No workspace opened and no context found!",
                            );
                            return;
                        }

                        const downloadResourceResult = await downloadResource(
                            (e.payload as any)?.resource as any,
                        );

                        const downloadedResourcesInfo = Array.isArray(
                            downloadResourceResult,
                        )
                            ? downloadResourceResult
                            : [downloadResourceResult];

                        for (const downloadedResourceInfo of downloadedResourcesInfo) {
                            const localPath: string =
                                downloadedResourceInfo?.folder.path.replace(
                                    vscode.workspace.workspaceFolders?.[0].uri
                                        .path + "/",
                                    "",
                                ) ?? "";

                            if (!downloadedResourceInfo) {
                                vscode.window.showErrorMessage(
                                    "Failed to download resource!",
                                );
                                return;
                            }
                            const downloadedResource: DownloadedResource = {
                                name:
                                    downloadedResourceInfo?.resource.name ?? "",
                                id: downloadedResourceInfo?.resource.id ?? "",
                                localPath: localPath,
                                type:
                                    downloadedResourceInfo?.resourceType ?? "",
                                remoteUrl:
                                    downloadedResourceInfo?.resource.url ?? "",
                                version:
                                    downloadedResourceInfo?.resource.release
                                        .tag_name,
                            };

                            await addDownloadedResourceToProjectConfig(
                                downloadedResource,
                            );

                            const allDownloadedResources =
                                (context?.workspaceState.get(
                                    "downloadedResources",
                                ) ?? []) as DownloadedResource[];

                            const newDownloadedResources: DownloadedResource[] =
                                [...allDownloadedResources, downloadedResource];

                            await context.workspaceState.update(
                                "downloadedResources",
                                newDownloadedResources,
                            );
                        }

                        await this.syncDownloadedResources();
                        break;
                    }
                    case MessageType.OPEN_RESOURCE:
                        this._openResource((e.payload as any)?.resource as any);
                        break;

                    case MessageType.SYNC_DOWNLOADED_RESOURCES:
                        await this.syncDownloadedResources();
                        break;
                    default:
                        break;
                }
            },
        );
        this.syncDownloadedResources();

        this._webviewView = webviewPanel;
    }

    public revive(panel: vscode.WebviewView) {
        this._webviewView = panel;
    }

    private async _registerCommands() {
        const commands: {
            command: string;
            title: string;
            handler: (...args: any[]) => any;
        }[] = [];

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
            "Resources.js",
        ]);

        const codiconsUri = getUri(webview, extensionUri, [
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css",
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
          <link href="${codiconsUri}" rel="stylesheet" />
          <title>Sidebar vscode obs Resources</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }

    public async _openResource(resource: DownloadedResource) {
        const openResources = (this._context?.workspaceState.get(
            "openResources",
            [],
        ) ?? []) as OpenResource[];
        // open resource
        let newViewCol: vscode.ViewColumn | undefined =
            vscode.ViewColumn.Beside;

        switch (resource.type) {
            case "obs":
                newViewCol = (await openOBS(this.context, resource))
                    ?.viewColumn;
                break;
            case "bible":
                newViewCol = (await openBible(this.context, resource))
                    ?.viewColumn;
                break;
            case "tn": {
                newViewCol = (await openTn(this.context, resource))?.viewColumn;
                break;
            }
            case "tw": {
                await openTw(this._context!, resource);
                break;
            }
            case "twl": {
                await openTwl(this._context!, resource);
                break;
            }
            case "tq": {
                await openTq(this._context!, resource);
                break;
            }
            case "ta": {
                await openTnAcademy(resource);
                break;
            }
            case "obs-tn": {
                await openObsTn(this._context!, resource);
                break;
            }
            case "obs-tq": {
                await openObsTq(this._context!, resource);
                break;
            }
            case "obs-twl": {
                await openObsTwl(this._context!, resource);
                break;
            }
            default:
                newViewCol = (await openTranslationHelper(resource))
                    ?.viewColumn;
                break;
        }

        const newResources = [
            ...openResources,
            { ...resource, viewColumn: newViewCol },
        ];
        // save to workspace state
        await this._context?.workspaceState.update(
            "openResources",
            newResources,
        );

        const updatedResources = (this._context?.workspaceState.get(
            "openResources",
            [],
        ) ?? []) as OpenResource[];

        return {
            viewColumn: newViewCol,
        };
    }

    syncDownloadedResources = async (webviewPanel = this._webviewView) => {
        const context = this._context;
        if (!context) {
            console.error("No workspace opened and no context found!");
            return;
        }
        const downloadedResources = (context?.workspaceState.get(
            "downloadedResources",
        ) ?? []) as DownloadedResource[];

        if (!webviewPanel?.webview) {
            return;
        }

        await ResourcesProvider.initProjectResources(context);

        await webviewPanel?.webview.postMessage({
            type: MessageType.SYNC_DOWNLOADED_RESOURCES,
            payload: { downloadedResources },
        });
    };
}
