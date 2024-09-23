import * as vscode from "vscode";
import { DownloadedResource } from "../obs/resources/types";
import { getNonce, getUri } from "../obs/utilities";
import { MessageType } from "../obs/CreateProject/types";
import { initializeStateStore } from "../../stateStore";
import { getStoryData } from "./utils";

export class ObsResourceProvider {
    static instance: ObsResourceProvider;
    webview?: vscode.WebviewPanel;
    resource: DownloadedResource;
    context: vscode.ExtensionContext;
    stateStore?: Awaited<ReturnType<typeof initializeStateStore>>;

    constructor(context: vscode.ExtensionContext, resource: DownloadedResource) {
        this.resource = resource;
        this.context = context;
        initializeStateStore().then((stateStore) => {
            this.stateStore = stateStore;
        });
    }

    async startWebview(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside) {
        if (!this.stateStore) {
            this.stateStore = await initializeStateStore();
            console.log("stateStore", this.stateStore);
        }

        const panel = vscode.window.createWebviewPanel(
            "codex.obsResource",
            "OBS - " + this.resource.name,
            viewColumn,
            {
                enableScripts: true,
                localResourceRoots: [this.context.extensionUri],
            }
        );
        this.webview = panel;

        panel.webview.html = this._getWebviewContent(panel.webview, this.context.extensionUri);

        panel.webview.onDidReceiveMessage(async (e: { type: MessageType; payload: unknown }) => {
            switch (e.type) {
                default:
                    break;
            }
        });

        const onDidChangeViewState = panel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.visible) {
                const obsRef = (await this.stateStore?.getStoreState("obsRef")) ?? {
                    storyId: "01",
                    paragraph: "1",
                };

                const storyData = await getStoryData(this.resource, obsRef);

                e.webviewPanel.webview.postMessage({
                    type: "update",
                    payload: {
                        doc: storyData,
                        isReadonly: true, // if the document is in the resources folder, it's readonly
                    },
                });
            }
        });

        const verseRefListenerDisposeFunction = this.stateStore?.storeListener(
            "obsRef",
            async (value) => {
                if (value) {
                    const storyData = await getStoryData(this.resource, value);

                    this.webview?.webview.postMessage({
                        type: "update",
                        payload: {
                            doc: storyData,
                            isReadonly: true, // if the document is in the resources folder, it's readonly
                        },
                    });
                }
            }
        );
        panel.onDidDispose(() => {
            onDidChangeViewState.dispose();
            verseRefListenerDisposeFunction?.();
        });

        return {
            viewColumn: panel.viewColumn,
        };
    }

    private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
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
            "Editor.js",
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
          <title>Hello World</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }
}
