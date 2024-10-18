import * as vscode from "vscode";
import { CommentPostMessages, NotebookCommentThread, CellIdGlobalState } from "../../../types";
import { FileHandler, getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { initializeStateStore } from "../../stateStore";
import { workspace, Uri, window } from "vscode";

const abortController: AbortController | null = null;

const loadWebviewHtml = (webviewView: vscode.WebviewView, extensionUri: vscode.Uri) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css")
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "CommentsView",
            "index.js"
        )
    );
    // const styleUri = webviewView.webview.asWebviewUri(
    //   vscode.Uri.joinPath(
    //     extensionUri,
    //     "webviews",
    //     "codex-webviews",
    //     "dist",
    //     "CommentsView",
    //     "index.css"
    //   )
    // );
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );
    function getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
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

export class CustomWebviewProvider {
    _context: vscode.ExtensionContext;
    selectionChangeListener: any;
    commentsFilePath: Uri | undefined;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.initializeCommentsFile();
    }

    private async initializeCommentsFile() {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            window.showErrorMessage(
                "No workspace folder found. Unable to initialize comments file."
            );
            return;
        }

        this.commentsFilePath = Uri.joinPath(workspaceFolders[0].uri, "file-comments.json");

        try {
            await workspace.fs.stat(this.commentsFilePath);
        } catch (error) {
            // File doesn't exist, create it with an empty array
            await workspace.fs.writeFile(this.commentsFilePath, new TextEncoder().encode("[]"));
            console.log("Comments file created successfully.");
        }
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener(
                "cellId",
                (value: CellIdGlobalState | undefined) => {
                    if (value) {
                        webviewView.webview.postMessage({
                            command: "reload",
                            data: { cellId: value },
                        } as CommentPostMessages);
                    }
                }
            );
            webviewView.onDidDispose(() => {
                disposeFunction();
            });
        });

        loadWebviewHtml(webviewView, this._context.extensionUri);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.sendCommentsToWebview(webviewView);
                // webviewView.webview.postMessage({ command: "reload" });
            }
        });
        if (webviewView.visible) {
            this.sendCommentsToWebview(webviewView);
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

        const commentsFileName = "file-comments.json";

        const serializeCommentsToDisk = async (
            existingCommentsThreads: NotebookCommentThread[],
            newCommentThread: NotebookCommentThread
        ) => {
            const threadIndex = existingCommentsThreads.findIndex(
                (thread) => thread.id === newCommentThread.id
            );
            if (threadIndex !== -1) {
                newCommentThread.comments.forEach((newComment) => {
                    const existingCommentIndex = existingCommentsThreads[
                        threadIndex
                    ].comments.findIndex((existingComment) => existingComment.id === newComment.id);
                    if (existingCommentIndex !== -1) {
                        existingCommentsThreads[threadIndex].comments[existingCommentIndex] =
                            newComment;
                    } else {
                        existingCommentsThreads[threadIndex].comments.push(newComment);
                    }
                });
                existingCommentsThreads[threadIndex].threadTitle = newCommentThread.threadTitle;
                existingCommentsThreads[threadIndex].deleted = newCommentThread.deleted;
            } else {
                existingCommentsThreads.push(newCommentThread);
            }
            await writeSerializedData(
                JSON.stringify(existingCommentsThreads, null, 4),
                commentsFileName
            );
        };
        webviewView.webview.onDidReceiveMessage(async (message: CommentPostMessages) => {
            console.log({ message }, "onDidReceiveMessage");
            try {
                switch (message.command) {
                    case "updateCommentThread": {
                        const existingCommentsThreads = await getCommentsFromFile(commentsFileName);

                        // NOTE: When the panel fist load the cellId defaults to null but there is no way for the webview to know the uri
                        if (!message.commentThread.uri) {
                            const uriForCellId = message.commentThread.cellId.uri;
                            if (!uriForCellId) {
                                vscode.window.showInformationMessage(
                                    `No file found with the cellId: ${message.commentThread.cellId}`
                                );
                                return;
                            }
                            message.commentThread.uri = uriForCellId;
                            await serializeCommentsToDisk(
                                existingCommentsThreads,
                                message.commentThread
                            );
                        } else {
                            await serializeCommentsToDisk(
                                existingCommentsThreads,
                                message.commentThread
                            );
                        }
                        this.sendCommentsToWebview(webviewView);
                        break;
                    }
                    case "deleteCommentThread": {
                        const commentThreadId = message.commentThreadId;
                        const existingCommentsThreads = await getCommentsFromFile(commentsFileName);
                        const indexOfCommentToMarkAsDeleted = existingCommentsThreads.findIndex(
                            (commentThread) => commentThread.id === commentThreadId
                        );
                        const commentThreadToMarkAsDeleted =
                            existingCommentsThreads[indexOfCommentToMarkAsDeleted];
                        await serializeCommentsToDisk(existingCommentsThreads, {
                            ...commentThreadToMarkAsDeleted,
                            deleted: true,
                            comments: [],
                        });
                        this.sendCommentsToWebview(webviewView);
                        break;
                    }
                    case "deleteComment": {
                        const commentId = message.args.commentId;
                        const commentThreadId = message.args.commentThreadId;
                        const existingCommentsThreads = await getCommentsFromFile(commentsFileName);
                        const indexOfCommentToMarkAsDeleted = existingCommentsThreads.findIndex(
                            (commentThread) => commentThread.id === commentThreadId
                        );
                        const commentThreadToMarkAsDeleted =
                            existingCommentsThreads[indexOfCommentToMarkAsDeleted];
                        const commentToMarkAsDeleted = existingCommentsThreads[
                            indexOfCommentToMarkAsDeleted
                        ].comments.find((comment) => comment.id === commentId);
                        if (commentToMarkAsDeleted) {
                            await serializeCommentsToDisk(existingCommentsThreads, {
                                ...commentThreadToMarkAsDeleted,
                                comments: [
                                    {
                                        ...commentToMarkAsDeleted,
                                        deleted: true,
                                    },
                                ],
                            });
                        }
                        this.sendCommentsToWebview(webviewView);
                        break;
                    }
                    case "fetchComments": {
                        this.sendCommentsToWebview(webviewView);
                        break;
                    }
                    case "getCurrentCellId": {
                        initializeStateStore().then(({ getStoreState }) => {
                            getStoreState("cellId").then((value: CellIdGlobalState | undefined) => {
                                if (value) {
                                    webviewView.webview.postMessage({
                                        command: "reload",
                                        data: {
                                            cellId: value,
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
        });
    }

    private async sendCommentsToWebview(webviewView: vscode.WebviewView) {
        if (!this.commentsFilePath) {
            console.error("Comments file path not initialized");
            return;
        }

        try {
            const fileContentUint8Array = await workspace.fs.readFile(this.commentsFilePath);
            const fileContent = new TextDecoder().decode(fileContentUint8Array);
            webviewView.webview.postMessage({
                command: "commentsFromWorkspace",
                content: fileContent,
            } as CommentPostMessages);
        } catch (error) {
            console.error("Error reading comments file:", error);
            window.showErrorMessage(`Error reading comments file: ${this.commentsFilePath.fsPath}`);
        }
    }
}

export function registerCommentsWebviewProvider(context: vscode.ExtensionContext) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "comments-sidebar",
            new CustomWebviewProvider(context)
        )
    );
    item.show();
}
