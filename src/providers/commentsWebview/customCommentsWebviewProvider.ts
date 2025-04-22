import * as vscode from "vscode";
import { CommentPostMessages, NotebookCommentThread, CellIdGlobalState } from "../../../types";
import { FileHandler, getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { initializeStateStore } from "../../stateStore";
import { workspace, Uri, window } from "vscode";
import { getAuthApi } from "../../extension";
import { getProjectOverview } from "../../projectManager/utils/projectUtils";

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
    private lastSentComments: string = "";
    private authApi = getAuthApi();
    private isAuthenticated = false;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.initializeCommentsFile();
        this.initializeAuthState();
    }

    private async initializeAuthState() {
        if (this.authApi) {
            try {
                this.isAuthenticated = await this.authApi.getAuthStatus().isAuthenticated;
            } catch (error) {
                console.error("Error checking authentication:", error);
            }
        }
    }

    private async initializeCommentsFile() {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            console.error("No workspace folder found. Unable to initialize comments file.");
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

    private async sendCurrentUserInfo(webviewView: vscode.WebviewView) {
        try {
            const projectOverview = await getProjectOverview();
            if (!projectOverview || !projectOverview.isAuthenticated) {
                throw new Error("Not authenticated or no project overview available");
            }
            webviewView.webview.postMessage({
                command: "updateUserInfo",
                userInfo: {
                    username: projectOverview.userName,
                    email: projectOverview.userEmail,
                },
            } as CommentPostMessages);
        } catch (error) {
            console.error("Error getting user info:", error);
            // Fallback to a default user if we can't get the info
            webviewView.webview.postMessage({
                command: "updateUserInfo",
                userInfo: {
                    username: "vscode",
                    email: "",
                },
            } as CommentPostMessages);
        }
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        // Set up auth status change listener
        if (this.authApi) {
            this.authApi.onAuthStatusChanged(async (status) => {
                this.isAuthenticated = status.isAuthenticated;
                if (webviewView.visible) {
                    await this.sendCurrentUserInfo(webviewView);
                }
            });
        }

        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener(
                "cellId",
                (value: CellIdGlobalState | undefined) => {
                    if (value) {
                        webviewView.webview.postMessage({
                            command: "reload",
                            data: { cellId: value.cellId },
                        } as CommentPostMessages);
                    }
                }
            );
            webviewView.onDidDispose(() => {
                disposeFunction();
            });
        });

        loadWebviewHtml(webviewView, this._context.extensionUri);

        // Send initial data when the webview becomes visible
        webviewView.onDidChangeVisibility(async () => {
            if (webviewView.visible) {
                await this.sendCommentsToWebview(webviewView);
                await this.sendCurrentCellId(webviewView);
                await this.sendCurrentUserInfo(webviewView);
            }
        });

        // Send initial data if the webview is already visible
        if (webviewView.visible) {
            this.sendCommentsToWebview(webviewView);
            this.sendCurrentCellId(webviewView);
            this.sendCurrentUserInfo(webviewView);
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
                // Update existing thread
                existingCommentsThreads[threadIndex] = {
                    ...existingCommentsThreads[threadIndex],
                    ...newCommentThread,
                    comments:
                        newCommentThread.comments || existingCommentsThreads[threadIndex].comments,
                };
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
                        const threadIndex = existingCommentsThreads.findIndex(
                            (commentThread) => commentThread.id === commentThreadId
                        );

                        if (threadIndex !== -1) {
                            const thread = existingCommentsThreads[threadIndex];
                            const updatedComments = thread.comments.map((comment) =>
                                comment.id === commentId ? { ...comment, deleted: true } : comment
                            );

                            await serializeCommentsToDisk(existingCommentsThreads, {
                                ...thread,
                                comments: updatedComments,
                            });
                        }

                        this.sendCommentsToWebview(webviewView);
                        break;
                    }
                    case "undoCommentDeletion": {
                        const commentId = message.args.commentId;
                        const commentThreadId = message.args.commentThreadId;
                        const existingCommentsThreads = await getCommentsFromFile(commentsFileName);
                        const threadIndex = existingCommentsThreads.findIndex(
                            (commentThread) => commentThread.id === commentThreadId
                        );

                        if (threadIndex !== -1) {
                            const thread = existingCommentsThreads[threadIndex];
                            const updatedComments = thread.comments.map((comment) =>
                                comment.id === commentId ? { ...comment, deleted: false } : comment
                            );

                            await serializeCommentsToDisk(existingCommentsThreads, {
                                ...thread,
                                comments: updatedComments,
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
                                            cellId: value.cellId, // Extract just the cellId string
                                            uri: value.uri,
                                        },
                                    } as CommentPostMessages);
                                }
                            });
                        });
                        break;
                    }
                    case "navigateToMainMenu": {
                        try {
                            await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                        } catch (error) {
                            console.error("Error navigating to main menu:", error);
                        }
                        break;
                    }
                    default:
                        break;
                }
            } catch (error) {
                console.error("Error:", error);
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

            this.lastSentComments = fileContent;
        } catch (error) {
            console.error("Error reading comments file:", error);
            window.showErrorMessage(`Error reading comments file: ${this.commentsFilePath.fsPath}`);
        }
    }

    private async sendCurrentCellId(webviewView: vscode.WebviewView) {
        const { getStoreState } = await initializeStateStore();
        const cellId = (await getStoreState("cellId")) as CellIdGlobalState | undefined;
        if (cellId) {
            webviewView.webview.postMessage({
                command: "reload",
                data: { cellId: cellId.cellId },
            } as CommentPostMessages);
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
