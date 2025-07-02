import * as vscode from "vscode";
import { CommentPostMessages, CellIdGlobalState, NotebookCommentThread } from "../../../types";
import { initializeStateStore } from "../../stateStore";
import { getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { Uri, window, workspace } from "vscode";
import { BaseWebviewProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
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
            console.log("[CommentsProvider] Initializing auth state...");
            if (this.authApi) {
                const authStatus = this.authApi.getAuthStatus();
                this.isAuthenticated = authStatus.isAuthenticated;
                console.log("[CommentsProvider] Auth API found, isAuthenticated:", this.isAuthenticated);
            } else {
                this.isAuthenticated = false;
                console.log("[CommentsProvider] No auth API found, setting isAuthenticated to false");
            }
        } catch (error) {
            console.error("[CommentsProvider] Failed to check authentication status:", error);
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
        console.log("[CommentsProvider] sendCurrentUserInfo called, isAuthenticated:", this.isAuthenticated, "authApi exists:", !!this.authApi);

        if (this.isAuthenticated && this.authApi) {
            try {
                const user = await this.authApi.getUserInfo();
                console.log("[CommentsProvider] Got user info:", user ? { username: user.username, email: user.email } : "null");

                if (user) {
                    const message = {
                        command: "updateUserInfo",
                        userInfo: {
                            username: user.username,
                            email: user.email || "",
                        },
                    } as CommentPostMessages;
                    console.log("[CommentsProvider] Sending authenticated user message:", message);
                    const sent = safePostMessageToView(webviewView, message);
                    console.log("[CommentsProvider] Message send result:", sent);
                } else {
                    // Send unauthenticated state
                    const message = {
                        command: "updateUserInfo",
                    } as CommentPostMessages;
                    console.log("[CommentsProvider] User is null, sending unauthenticated message:", message);
                    const sent = safePostMessageToView(webviewView, message);
                    console.log("[CommentsProvider] Message send result:", sent);
                }
            } catch (error) {
                console.error("[CommentsProvider] Failed to get user info:", error);
                // Send unauthenticated state on error
                const message = {
                    command: "updateUserInfo",
                } as CommentPostMessages;
                console.log("[CommentsProvider] Error getting user, sending unauthenticated message:", message);
                const sent = safePostMessageToView(webviewView, message);
                console.log("[CommentsProvider] Message send result:", sent);
            }
        } else {
            // Send unauthenticated state
            const message = {
                command: "updateUserInfo",
            } as CommentPostMessages;
            console.log("[CommentsProvider] Not authenticated or no authApi, sending unauthenticated message:", message);
            const sent = safePostMessageToView(webviewView, message);
            console.log("[CommentsProvider] Message send result:", sent);
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
            console.log("[CommentsProvider] Initializing webview...");
            // Ensure comments file exists before trying to read it
            await this.initializeCommentsFile();

            // Give the webview a moment to fully load before sending messages
            console.log("[CommentsProvider] Waiting for webview to be ready...");
            await new Promise(resolve => setTimeout(resolve, 100));

            // Now safely initialize other components
            console.log("[CommentsProvider] About to send user info...");
            await this.sendCurrentUserInfo(webviewView);
            console.log("[CommentsProvider] About to send comments...");
            await this.sendCommentsToWebview(webviewView);
            console.log("[CommentsProvider] About to send cell ID...");
            await this.sendCurrentCellId(webviewView);
            console.log("[CommentsProvider] Webview initialization complete");
        } catch (error) {
            console.error("[CommentsProvider] Error initializing comments webview:", error);
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
                                safePostMessageToView(this._view, {
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

            safePostMessageToView(webviewView, {
                command: "commentsFromWorkspace",
                content: fileContent,
            } as CommentPostMessages);

            this.lastSentComments = fileContent;
        } catch (error) {
            // If file doesn't exist, send empty comments array instead of showing error
            console.log("Comments file not found, sending empty comments array");
            safePostMessageToView(webviewView, {
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
            safePostMessageToView(webviewView, {
                command: "reload",
                data: { cellId: cellId.cellId },
            } as CommentPostMessages);
        }
    }
}


