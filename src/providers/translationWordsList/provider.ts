import * as vscode from "vscode";
import { DownloadedResource } from "../obs/resources/types";
import { getNonce, getUri } from "../obs/utilities";
import { MessageType } from "../obs/CreateProject/types";
import { getVerseTranslationWordsList } from "./utils";
import { initializeStateStore } from "../../stateStore";

export class TranslationWordsListProvider {
    static instance: TranslationWordsListProvider;
    webview?: vscode.WebviewPanel;
    resource: DownloadedResource;
    context: vscode.ExtensionContext;
    stateStore?: Awaited<ReturnType<typeof initializeStateStore>>;

    constructor(
        context: vscode.ExtensionContext,
        resource: DownloadedResource,
    ) {
        this.resource = resource;
        this.context = context;
        initializeStateStore().then((stateStore) => {
            this.stateStore = stateStore;
        });
    }

    async startWebview(
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
    ) {
        if (!this.stateStore) {
            this.stateStore = await initializeStateStore();
            console.log("stateStore", this.stateStore);
        }
        const panel = vscode.window.createWebviewPanel(
            "codex.translationWordsViewer",
            "Translation Words -" + this.resource.name,
            viewColumn,
            {
                enableScripts: true,
                localResourceRoots: [this.context.extensionUri],
            },
        );
        this.webview = panel;

        panel.webview.html = this._getWebviewContent(
            panel.webview,
            this.context.extensionUri,
        );

        panel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                switch (e.type) {
                    case MessageType.GET_TW_CONTENT: {
                        try {
                            const translationWord: {
                                path: string;
                            } = (e.payload as Record<string, any>)
                                ?.translationWord;

                            if (!translationWord) {
                                return;
                            }

                            const path = translationWord.path;

                            if (!path) {
                                return;
                            }

                            try {
                                const content =
                                    await vscode.workspace.fs.readFile(
                                        vscode.Uri.file(path),
                                    );
                                panel.webview.postMessage({
                                    type: "update-tw-content",
                                    payload: {
                                        content: content.toString(),
                                    },
                                });
                            } catch (e: any) {
                                panel.webview.postMessage({
                                    type: "update-tw-content",
                                    payload: {
                                        error: e?.message,
                                        content: null,
                                    },
                                });
                            }
                        } catch (error: any) {
                            vscode.window.showErrorMessage(
                                "Unable to read the given translation word: " +
                                    error?.message,
                            );
                            panel.webview.postMessage({
                                type: "update-tw-content",
                                payload: {
                                    error: "Not found",
                                },
                            });
                        }
                        break;
                    }
                    default: {
                        break;
                    }
                }
            },
        );

        // TODO: Add global state to keep track of the current verseRef
        const verseRefListenerDisposeFunction = this.stateStore?.storeListener(
            "verseRef",
            async (value) => {
                console.log("state update: verseRef ---------> ", value);
                if (value) {
                    const wordsList = await getVerseTranslationWordsList(
                        this.resource,
                        value?.verseRef ?? "GEN 1:1",
                    );

                    panel.webview.postMessage({
                        type: "update-twl",
                        payload: {
                            wordsList: wordsList,
                        },
                    });
                }
            },
        );
        const onDidChangeViewState = panel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.visible) {
                try {
                    const verseRefStore =
                        await this.stateStore?.getStoreState("verseRef");
                    const wordsList = await getVerseTranslationWordsList(
                        this.resource,
                        verseRefStore?.verseRef ?? "GEN 1:1",
                    );

                    panel.webview.postMessage({
                        type: "update-twl",
                        payload: {
                            wordsList: wordsList,
                        },
                    });
                } catch (error: any) {
                    vscode.window.showErrorMessage(
                        "Unable to get the translation words list: " +
                            error?.message,
                    );

                    panel.webview.postMessage({
                        type: "update-twl",
                        payload: {
                            error: "Not found",
                        },
                    });
                }
            }
        });

        panel.onDidDispose(() => {
            onDidChangeViewState.dispose();
            verseRefListenerDisposeFunction?.();
        });

        return {
            viewColumn: panel.viewColumn,
        };
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
            "TranslationWordsList.js",
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
          <title>Translation Words Webview</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }
}
