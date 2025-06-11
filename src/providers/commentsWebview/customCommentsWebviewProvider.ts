import * as vscode from "vscode";
import { CommentPostMessages, CellIdGlobalState, NotebookCommentThread } from "../../../types";
import { initializeStateStore } from "../../stateStore";
import { getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { Uri, window, workspace } from "vscode";
import { BaseWebviewProvider } from "../../globalProvider";
import { getAuthApi } from "../../extension";

export class CustomWebviewProvider extends BaseWebviewProvider {
    selectionChangeListener: any;
    commentsFilePath: Uri | undefined;
    private lastSentComments: string = "";
    private authApi = getAuthApi();
    private isAuthenticated = false;

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.initializeAuthState();
    }

    protected getWebviewId(): string {
        return "comments-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["CommentsView", "index.js"];
    }

    private async initializeAuthState() {
        try {
            if (this.authApi) {
                const authStatus = this.authApi.getAuthStatus();
                this.isAuthenticated = authStatus.isAuthenticated;
            } else {
                this.isAuthenticated = false;
            }
        } catch (error) {
            console.error("Failed to check authentication status:", error);
            this.isAuthenticated = false;
        }
    }

    private async initializeCommentsFile() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            console.error("No workspace folder found");
            return;
        }
        this.commentsFilePath = vscode.Uri.joinPath(folders[0].uri, ".project", "comments.json");

        // Create comments file if it doesn't exist
        try {
            await vscode.workspace.fs.stat(this.commentsFilePath);
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                await vscode.workspace.fs.writeFile(this.commentsFilePath, new TextEncoder().encode("[]"));
            }
        }
    }

    private async sendCurrentUserInfo(webviewView: vscode.WebviewView) {
        if (this.isAuthenticated && this.authApi) {
            try {
                const user = await this.authApi.getUserInfo();
                if (user) {
                    webviewView.webview.postMessage({
                        command: "updateUser",
                        user: {
                            id: user.username,
                            name: user.username,
                            avatar: null,
                        },
                    } as CommentPostMessages);
                }
            } catch (error) {
                console.error("Failed to get user info:", error);
            }
        }
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        // Initialize everything asynchronously
        this.initializeWebview(webviewView);

        // Watch for changes to comments file
        const commentsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], ".project/comments.json")
        );

        commentsWatcher.onDidChange(async () => {
            const newContent = await this.readCommentsFile();
            if (newContent !== this.lastSentComments) {
                this.sendCommentsToWebview(webviewView);
            }
        });

        this._context.subscriptions.push(commentsWatcher);
    }

    private async initializeWebview(webviewView: vscode.WebviewView): Promise<void> {
        try {
            // Ensure comments file exists before trying to read it
            await this.initializeCommentsFile();
            
            // Now safely initialize other components
            await this.sendCurrentUserInfo(webviewView);
            await this.sendCommentsToWebview(webviewView);
            await this.sendCurrentCellId(webviewView);
        } catch (error) {
            console.error("Error initializing comments webview:", error);
        }
    }

    private async readCommentsFile(): Promise<string> {
        if (!this.commentsFilePath) return "[]";
        try {
            const fileContentUint8Array = await workspace.fs.readFile(this.commentsFilePath);
            return new TextDecoder().decode(fileContentUint8Array);
        } catch {
            return "[]";
        }
    }

    protected async handleMessage(message: CommentPostMessages): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            console.error("No workspace folder found");
            return;
        }
        const workspaceRoot = folders[0].uri;
        const commentsFileName = vscode.Uri.joinPath(
            workspaceRoot,
            ".project",
            "comments.json"
        );

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
                commentsFileName.fsPath
            );
        };

        try {
            switch (message.command) {
                case "updateCommentThread": {
                    const existingCommentsThreads = await getCommentsFromFile(commentsFileName.fsPath);

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
                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteCommentThread": {
                    const commentThreadId = message.commentThreadId;
                    const existingCommentsThreads = await getCommentsFromFile(commentsFileName.fsPath);
                    const indexOfCommentToMarkAsDeleted = existingCommentsThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );
                    const commentThreadToMarkAsDeleted =
                        existingCommentsThreads[indexOfCommentToMarkAsDeleted];
                    await serializeCommentsToDisk(existingCommentsThreads, {
                        ...commentThreadToMarkAsDeleted,
                        deleted: true,
                        comments: [],
                    });
                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteComment": {
                    const commentId = message.args.commentId;
                    const commentThreadId = message.args.commentThreadId;
                    const existingCommentsThreads = await getCommentsFromFile(commentsFileName.fsPath);
                    const threadIndex = existingCommentsThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = existingCommentsThreads[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: true } : comment
                        );

                        await serializeCommentsToDisk(existingCommentsThreads, {
                            ...thread,
                            comments: updatedComments,
                        });
                    }

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "undoCommentDeletion": {
                    const commentId = message.args.commentId;
                    const commentThreadId = message.args.commentThreadId;
                    const existingCommentsThreads = await getCommentsFromFile(commentsFileName.fsPath);
                    const threadIndex = existingCommentsThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = existingCommentsThreads[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: false } : comment
                        );

                        await serializeCommentsToDisk(existingCommentsThreads, {
                            ...thread,
                            comments: updatedComments,
                        });
                    }

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "fetchComments": {
                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "getCurrentCellId": {
                    initializeStateStore().then(({ getStoreState }) => {
                        getStoreState("cellId").then((value: CellIdGlobalState | undefined) => {
                            if (value) {
                                this._view!.webview.postMessage({
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
                default:
                    break;
            }
        } catch (error) {
            console.error("Error:", error);
        }
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
            // If file doesn't exist, send empty comments array instead of showing error
            console.log("Comments file not found, sending empty comments array");
            webviewView.webview.postMessage({
                command: "commentsFromWorkspace",
                content: "[]",
            } as CommentPostMessages);
            this.lastSentComments = "[]";
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


