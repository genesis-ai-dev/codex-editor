import * as vscode from "vscode";
import { DownloadedResource } from "../obs/resources/types";
import { getNonce, getUri } from "../obs/utilities";
import { MessageType } from "../obs/CreateProject/types";
import { TranslationWord, getAllTranslationWordsOfResource } from "./utils";

export class TranslationWordsProvider {
    static instance: TranslationWordsProvider;
    webview?: vscode.WebviewPanel;
    resource: DownloadedResource;
    context: vscode.ExtensionContext;
    allTranslationWords: TranslationWord[] = [];

    constructor(
        context: vscode.ExtensionContext,
        resource: DownloadedResource,
    ) {
        this.resource = resource;
        this.context = context;
        getAllTranslationWordsOfResource(resource.name)
            .then((words) => {
                this.allTranslationWords = words ?? [];
            })
            .catch((e) => {
                console.error(e);
                vscode.window.showErrorMessage(
                    "Failed to get translation words of Resource. Please try again.",
                );
            });
    }

    async startWebview(
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
    ) {
        const panel = vscode.window.createWebviewPanel(
            "codex.translationWordsViewer",
            "Translation Words -" + this.resource.name,
            viewColumn,
            {
                enableScripts: true,
            },
        );
        this.webview = panel;

        const twWordsResult = await getAllTranslationWordsOfResource(
            this.resource.name,
        );

        this.allTranslationWords = twWordsResult ?? [];

        panel.webview.html = this._getWebviewContent(
            panel.webview,
            this.context.extensionUri,
        );

        panel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                switch (e.type) {
                    case MessageType.SEARCH_TW: {
                        const query = (e.payload as Record<string, any>)
                            ?.query as string;

                        if (!query) {
                            return;
                        }

                        const words = this.allTranslationWords.filter((word) =>
                            word.name
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                        );

                        panel.webview.postMessage({
                            type: "update-tw",
                            payload: { translationWords: words },
                        });

                        return;
                    }
                    case MessageType.GET_TW_CONTENT: {
                        const translationWord: {
                            path: string;
                        } = (e.payload as Record<string, any>)?.translationWord;

                        console.log(translationWord, e.payload);

                        if (!translationWord) {
                            return;
                        }

                        const path = translationWord.path;

                        if (!path) {
                            return;
                        }

                        const content = await vscode.workspace.fs.readFile(
                            vscode.Uri.file(path),
                        );

                        panel.webview.postMessage({
                            type: "update-tw-content",
                            payload: {
                                content: content.toString(),
                            },
                        });
                    }
                }
            },
        );

        panel.webview.postMessage({
            type: "update-tw",
            payload: { translationWords: this.allTranslationWords },
        });

        panel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.active) {
                panel.webview.postMessage({
                    type: "update-tw",
                    payload: { translationWords: this.allTranslationWords },
                });
                const initialTranslationWord = this.allTranslationWords[0];

                const content = await vscode.workspace.fs.readFile(
                    vscode.Uri.file(initialTranslationWord.path),
                );
                panel.webview.postMessage({
                    type: "update-tw-content",
                    payload: {
                        content: content.toString(),
                    },
                });
            }
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
            "TranslationWords.js",
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
