import * as vscode from "vscode";
import { DownloadedResource } from "../obs/resources/types";
import { getNonce, getUri } from "../obs/utilities";
import { MessageType } from "../obs/CreateProject/types";
// import { getVerseTranslationQuestions } from "./utils";
import { initializeStateStore } from "../../stateStore";
import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { getUSFMDocument } from "./getUSFM";
import { VerseRefGlobalState } from "../../../types";

export class USFMViewerProvider {
    static instance: USFMViewerProvider;
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
            console.log("stateStore3", this.stateStore);
        }
        const panel = vscode.window.createWebviewPanel(
            "codex.usfmViewer",
            "Reference -" + this.resource.name,
            viewColumn,
            {
                enableScripts: true,
            },
        );
        this.webview = panel;
        console.log("updating webview");

        const updateWebview = async () => {
            const verseRefStore =
                await this.stateStore?.getStoreState("verseRef");
            const usfm = await getUSFMDocument(
                this.resource,
                verseRefStore?.verseRef ?? "GEN 1:1",
            );
            console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>usfm", { usfm });

            panel.webview.postMessage({
                type: "update-usfm",
                payload: {
                    usfm: usfm?.usfmString ?? "",
                    chapter: usfm?.chapter ?? 1,
                    verse: usfm?.verse ?? 1,
                    bookID: usfm?.bookID ?? "GEN",
                },
            });
        };

        // // Set initial content
        // // await updateWebview();
        try {
            await updateWebview();
        } catch (error) {
            console.error("Error updating webview:", error);
        }

        panel.webview.html = this._getWebviewContent(
            panel.webview,
            this.context.extensionUri,
        );

        panel.webview.onDidReceiveMessage(
            async (e: { type: MessageType; payload: unknown }) => {
                console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>onDidReceiveMessage");
                switch (e.type) {
                    case MessageType.GET_USFM:
                        {
                            console.log("GET_USFM", e.payload);
                        }
                        break;
                    default:
                        break;
                }
            },
        );
        const updateUSFMFromFile = async (
            verseRefStore: VerseRefGlobalState,
        ) => {
            const usfm = await getUSFMDocument(
                this.resource,
                verseRefStore?.verseRef ?? "GEN 1:1",
            );
            console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>usfm", usfm);
            panel.webview.postMessage({
                type: "update-usfm",
                payload: {
                    usfm: usfm?.usfmString ?? "",
                    chapter: usfm?.chapter ?? 1,
                    verse: usfm?.verse ?? 1,
                    bookID: usfm?.bookID ?? "GEN",
                },
            });
        };

        const onDidChangeViewState = panel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.visible) {
                const verseRefStore =
                    await this.stateStore?.getStoreState("verseRef");
                verseRefStore && updateUSFMFromFile(verseRefStore);
                // const usfm = await getUSFMDocument(
                //     this.resource,
                //     verseRefStore?.verseRef ?? "GEN 1:1",
                // );
                // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>usfm", usfm);
                // e.webviewPanel.webview.postMessage({
                //     type: "update-usfm",
                //     payload: {
                //         usfm: usfm?.usfmString ?? "",
                //         chapter: usfm?.chapter ?? 1,
                //         verse: usfm?.verse ?? 1,
                //         bookID: usfm?.bookID ?? "GEN",
                //     },
                // });
            }
        });

        const verseRefListenerDisposeFunction = this.stateStore?.storeListener(
            "verseRef",
            async (value) => {
                console.log("state update: verseRef ---------> ", value);
                if (value) {
                    updateUSFMFromFile(value);
                    // const { bookID, chapter, verse } = extractBookChapterVerse(
                    //     value.verseRef,
                    // );
                    // const usfm = await getUSFMDocument(
                    //     this.resource,
                    //     value.verseRef,
                    // );
                    // const usfmString = usfm?.usfmString;
                    // console.log("state update: usfm", usfm);
                    // panel.webview.postMessage({
                    //     type: MessageType.SCROLL_TO_CHAPTER,
                    //     payload: {
                    //         bookID,
                    //         chapter,
                    //     },
                    // });
                }
            },
        );
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
            "usfm-viewer",
            "build",
            "assets",
            "index.css",
        ]);
        // The View JS file from the React build output
        const scriptUri = getUri(webview, extensionUri, [
            "webviews",
            "usfm-viewer",
            "build",
            "assets",
            "index.js",
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
          <title>Translation Questions Webview</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }
}
