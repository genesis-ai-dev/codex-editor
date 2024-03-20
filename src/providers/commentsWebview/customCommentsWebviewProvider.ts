import * as vscode from "vscode";
import { initializeStateStore } from "../../stateStore";
import {
    CommentPostMessages,
    NotebookCommentThread,
    VerseRefGlobalState,
} from "../../../types";
import {
    FileHandler,
    getCommentsFromFile,
    writeSerializedData,
} from "../../utils/fileUtils";

const abortController: AbortController | null = null;

const loadWebviewHtml = (
    webviewView: vscode.WebviewView,
    extensionUri: vscode.Uri,
) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css"),
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css"),
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "CommentsView",
            "index.js",
        ),
    );
    const styleUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "CommentsView",
            "index.css",
        ),
    );
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css",
        ),
    );
    function getNonce() {
        let text = "";
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(
                Math.floor(Math.random() * possible.length),
            );
        }
        return text;
    }
    const nonce = getNonce();
    const html = /*html*/ `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <!--
      Use a content security policy to only allow loading images from https or from our extension directory,
      and only allow scripts that have a specific nonce.
    -->
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${
        webviewView.webview.cspSource
    }; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${codiconsUri}" rel="stylesheet" />
    <script nonce="${nonce}">
      const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
    </script>
    </head>
    <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;

    webviewView.webview.html = html;
};

const sendCommentsToWebview = async (webviewView: vscode.WebviewView) => {
    console.log("sendCommentsToWebview was called");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log({ workspaceFolders });
    const filePath = workspaceFolders
        ? vscode.Uri.joinPath(workspaceFolders[0].uri, "notebook-comments.json")
              .fsPath
        : "";
    try {
        const uri = vscode.Uri.file(filePath);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        webviewView.webview.postMessage({
            command: "commentsFromWorkspace",
            content: fileContent,
        } as CommentPostMessages);
    } catch (error) {
        console.error("Error reading file:", error);
        vscode.window.showErrorMessage(`Error reading file: ${filePath}`);
    }
};

export class CustomWebviewProvider {
    _context: vscode.ExtensionContext;
    selectionChangeListener: any;
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener("verseRef", (value) => {
                if (value) {
                    webviewView.webview.postMessage({
                        command: "reload",
                        data: { verseRef: value.verseRef, uri: value.uri },
                    } as CommentPostMessages);
                }
            });
            webviewView.onDidDispose(() => {
                disposeFunction();
            });
        });

        loadWebviewHtml(webviewView, this._context.extensionUri);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                sendCommentsToWebview(webviewView);
                // webviewView.webview.postMessage({ command: "reload" });
            }
        });
        if (webviewView.visible) {
            sendCommentsToWebview(webviewView);
        }

        // vscode.window.onDidChangeActiveTextEditor(() => {
        //     // When the active editor changes, remove the old listener and add a new one
        //     if (this.selectionChangeListener) {
        //         this.selectionChangeListener.dispose();
        //     }

        //     sendCommentsToWebview(webviewView);
        // });

        // TODO: find out if the above code was needed. Find out why comments are not loading sometime at first
        // Find out why new comments are not being created
        // create a system of share types so message posting is easier to deal with.
        const findUriForVerseRef = async (
            verseRef: string,
        ): Promise<string | null> => {
            let uri: string = "";
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const draftsFolderUri = workspaceFolders
                ? vscode.Uri.joinPath(workspaceFolders[0].uri, "drafts")
                : undefined;
            if (draftsFolderUri) {
                const codexFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(
                        draftsFolderUri,
                        "target/*.codex",
                    ),
                );
                for (const file of codexFiles) {
                    const document =
                        await vscode.workspace.openTextDocument(file);
                    const text = document.getText();
                    if (text.includes(verseRef)) {
                        uri = file.toString();
                        initializeStateStore().then(({ updateStoreState }) => {
                            updateStoreState({
                                key: "verseRef",
                                value: {
                                    verseRef,
                                    uri,
                                },
                            });
                        });
                        break;
                    }
                }
            }
            return uri;
        };
        const commentsFileName = "notebook-comments.json";

        const serializeCommentsToDisk = async (
            existingCommentsThreads: NotebookCommentThread[],
            newCommentThread: NotebookCommentThread,
        ) => {
            const threadIndex = existingCommentsThreads.findIndex(
                (thread) => thread.id === newCommentThread.id,
            );
            if (threadIndex !== -1) {
                newCommentThread.comments.forEach((newComment) => {
                    const existingCommentIndex = existingCommentsThreads[
                        threadIndex
                    ].comments.findIndex(
                        (existingComment) =>
                            existingComment.id === newComment.id,
                    );
                    if (existingCommentIndex !== -1) {
                        existingCommentsThreads[threadIndex].comments[
                            existingCommentIndex
                        ] = newComment;
                    } else {
                        existingCommentsThreads[threadIndex].comments.push(
                            newComment,
                        );
                    }
                });
                existingCommentsThreads[threadIndex].threadTitle =
                    newCommentThread.threadTitle;
                existingCommentsThreads[threadIndex].deleted =
                    newCommentThread.deleted;
            } else {
                existingCommentsThreads.push(newCommentThread);
            }
            await writeSerializedData(
                JSON.stringify(existingCommentsThreads, null, 4),
                commentsFileName,
            );
        };
        webviewView.webview.onDidReceiveMessage(
            async (message: CommentPostMessages) => {
                console.log({ message }, "onDidReceiveMessage");
                try {
                    switch (message.command) {
                        case "updateCommentThread": {
                            const existingCommentsThreads =
                                await getCommentsFromFile(commentsFileName);

                            // NOTE: When the panel fist load the verseRef defaults to GEn 1:1 but there is no way for the webview to know the uri
                            if (!message.commentThread.uri) {
                                const uriForVerseRef = await findUriForVerseRef(
                                    message.commentThread.verseRef,
                                );
                                if (!uriForVerseRef) {
                                    vscode.window.showInformationMessage(
                                        `No file found with the verse reference: ${message.commentThread.verseRef}`,
                                    );
                                    return;
                                }
                                message.commentThread.uri = uriForVerseRef;
                                await serializeCommentsToDisk(
                                    existingCommentsThreads,
                                    message.commentThread,
                                );
                            } else {
                                await serializeCommentsToDisk(
                                    existingCommentsThreads,
                                    message.commentThread,
                                );
                            }
                            sendCommentsToWebview(webviewView);
                            break;
                        }
                        case "deleteCommentThread": {
                            const commentThreadId = message.commentThreadId;
                            const existingCommentsThreads =
                                await getCommentsFromFile(commentsFileName);
                            const indexOfCommentToMarkAsDeleted =
                                existingCommentsThreads.findIndex(
                                    (commentThread) =>
                                        commentThread.id === commentThreadId,
                                );
                            const commentThreadToMarkAsDeleted =
                                existingCommentsThreads[
                                    indexOfCommentToMarkAsDeleted
                                ];
                            await serializeCommentsToDisk(
                                existingCommentsThreads,
                                {
                                    ...commentThreadToMarkAsDeleted,
                                    deleted: true,
                                    comments: [],
                                },
                            );
                            sendCommentsToWebview(webviewView);
                            break;
                        }
                        case "deleteComment": {
                            const commentId = message.args.commentId;
                            const commentThreadId =
                                message.args.commentThreadId;
                            const existingCommentsThreads =
                                await getCommentsFromFile(commentsFileName);
                            const indexOfCommentToMarkAsDeleted =
                                existingCommentsThreads.findIndex(
                                    (commentThread) =>
                                        commentThread.id === commentThreadId,
                                );
                            const commentThreadToMarkAsDeleted =
                                existingCommentsThreads[
                                    indexOfCommentToMarkAsDeleted
                                ];
                            const commentToMarkAsDeleted =
                                existingCommentsThreads[
                                    indexOfCommentToMarkAsDeleted
                                ].comments.find(
                                    (comment) => comment.id === commentId,
                                );
                            if (commentToMarkAsDeleted) {
                                await serializeCommentsToDisk(
                                    existingCommentsThreads,
                                    {
                                        ...commentThreadToMarkAsDeleted,
                                        comments: [
                                            {
                                                ...commentToMarkAsDeleted,
                                                deleted: true,
                                            },
                                        ],
                                    },
                                );
                            }
                            sendCommentsToWebview(webviewView);
                            break;
                        }
                        case "fetchComments": {
                            sendCommentsToWebview(webviewView);
                            break;
                        }
                        case "getCurrentVerseRef": {
                            initializeStateStore().then(({ getStoreState }) => {
                                getStoreState("verseRef").then((value) => {
                                    if (value) {
                                        webviewView.webview.postMessage({
                                            command: "reload",
                                            data: {
                                                verseRef: value.verseRef,
                                                uri: value.uri,
                                            },
                                        } as CommentPostMessages);
                                    }
                                });
                            });
                            break;
                        }
                        default:
                            break;
                    }
                } catch (error) {
                    console.error("Error:", error);
                    vscode.window.showErrorMessage("Service access failed.");
                }
            },
        );
    }
}

export function registerCommentsWebviewProvider(
    context: vscode.ExtensionContext,
) {
    const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "comments-sidebar",
            new CustomWebviewProvider(context),
        ),
    );
    item.show();
}
