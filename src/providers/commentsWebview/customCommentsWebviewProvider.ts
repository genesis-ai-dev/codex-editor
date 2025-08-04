import * as vscode from "vscode";
import { CommentPostMessages, CellIdGlobalState, NotebookCommentThread, NotebookComment } from "../../../types";
import { initializeStateStore } from "../../stateStore";
import { getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { CommentsMigrator } from "../../utils/commentsMigrationUtils";
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
    private stateStoreListener?: () => void; // Add state store listener cleanup function

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.initializeAuthState();
        this.setupStateStoreListener(); // Initialize state store listener
    }

    protected getWebviewId(): string {
        return "comments-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["CommentsView", "index.js"];
    }

    private async getCurrentUsername(): Promise<string> {
        try {
            if (this.authApi && this.isAuthenticated) {
                const user = await this.authApi.getUserInfo();
                return user?.username || 'Unknown';
            }
        } catch (error) {
            console.error("[CommentsProvider] Error getting user info:", error);
        }
        return 'Unknown';
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
            console.error("[CommentsProvider] No workspace folder found");
            return;
        }

        const projectDir = vscode.Uri.joinPath(folders[0].uri, ".project");
        this.commentsFilePath = vscode.Uri.joinPath(projectDir, "comments.json");

        console.log("[CommentsProvider] Comments file path:", this.commentsFilePath.fsPath);

        try {
            // First ensure the .project directory exists
            try {
                await vscode.workspace.fs.stat(projectDir);
                console.log("[CommentsProvider] .project directory exists");
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    console.log("[CommentsProvider] Creating .project directory");
                    await vscode.workspace.fs.createDirectory(projectDir);
                } else {
                    throw error;
                }
            }

            // Check for and migrate legacy file-comments.json if it exists
            await CommentsMigrator.migrateProjectComments(folders[0].uri);

            // Then check/create comments file
            try {
                await vscode.workspace.fs.stat(this.commentsFilePath);
                console.log("[CommentsProvider] Comments file exists");
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    console.log("[CommentsProvider] Creating comments file");
                    await vscode.workspace.fs.writeFile(this.commentsFilePath, new TextEncoder().encode(CommentsMigrator.formatCommentsForStorage([])));
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.error("[CommentsProvider] Error initializing comments file:", error);
            throw error;
        }
    }

    // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
    // Legacy migration methods moved to CommentsMigrator utility class
    // ============= END MIGRATION CLEANUP =============

    private async sendCurrentUserInfo(webviewView: vscode.WebviewView) {
        // Refresh auth state before sending
        await this.initializeAuthState();
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

    private async setupStateStoreListener() {
        try {
            const { storeListener } = await initializeStateStore();

            // Set up listener for cellId changes
            this.stateStoreListener = storeListener(
                "cellId",
                (value: CellIdGlobalState | undefined) => {
                    console.log("[CommentsProvider] Cell ID change detected:", value);
                    if (value?.cellId && value?.uri && this._view) {
                        // Send reload message to webview with new cell ID
                        safePostMessageToView(this._view, {
                            command: "reload",
                            data: {
                                cellId: value.cellId,
                                uri: value.uri,
                            },
                        } as CommentPostMessages);
                    }
                }
            );
            console.log("[CommentsProvider] State store listener initialized successfully");
        } catch (error) {
            console.error("[CommentsProvider] Failed to initialize state store listener:", error);
        }
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        console.log("[CommentsProvider] onWebviewResolved called");

        // Initialize everything asynchronously
        this.initializeWebview(webviewView).catch(error => {
            console.error("[CommentsProvider] Error in initializeWebview:", error);
        });

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

        // Watch for legacy file-comments.json and trigger migration immediately
        const legacyCommentsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], "file-comments.json")
        );

        legacyCommentsWatcher.onDidCreate(async () => {
            try {
                await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders![0].uri);
                // Refresh the webview to show migrated content
                this.sendCommentsToWebview(webviewView);
            } catch (error) {
                // Silent fallback
            }
        });

        legacyCommentsWatcher.onDidChange(async () => {
            try {
                await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders![0].uri);
                // Refresh the webview to show migrated content
                this.sendCommentsToWebview(webviewView);
            } catch (error) {
                // Silent fallback
            }
        });

        this._context.subscriptions.push(commentsWatcher, legacyCommentsWatcher);

        // Clean up state store listener when webview is disposed
        webviewView.onDidDispose(() => {
            if (this.stateStoreListener) {
                this.stateStoreListener();
                this.stateStoreListener = undefined;
                console.log("[CommentsProvider] State store listener disposed");
            }
        });
    }

    private async initializeWebview(webviewView: vscode.WebviewView): Promise<void> {
        try {
            // Ensure comments file exists before trying to read it
            await this.initializeCommentsFile();

            // Give the webview a moment to fully load before sending messages
            await new Promise(resolve => setTimeout(resolve, 100));

            // Now safely initialize other components
            await this.sendCurrentUserInfo(webviewView);
            await this.sendCommentsToWebview(webviewView);
            await this.sendCurrentCellId(webviewView);
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
        // Ensure comments file is initialized
        if (!this.commentsFilePath) {
            console.log("[CommentsProvider] Comments file path not initialized, initializing now...");
            await this.initializeCommentsFile();
        }

        if (!this.commentsFilePath) {
            console.error("[CommentsProvider] Failed to initialize comments file path");
            return;
        }

        console.log("[CommentsProvider] Using comments file path:", this.commentsFilePath.fsPath);

        const serializeCommentsToDisk = async (
            existingCommentsThreads: NotebookCommentThread[],
            newCommentThread: NotebookCommentThread
        ) => {
            try {
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
                    CommentsMigrator.formatCommentsForStorage(existingCommentsThreads),
                    this.commentsFilePath!.fsPath
                );
            } catch (error) {
                console.error("[CommentsProvider] Error serializing comments to disk:", error);
                throw error;
            }
        };

        try {
            switch (message.command) {
                case "updateCommentThread": {
                    const existingCommentsThreads = await getCommentsFromFile(this.commentsFilePath!.fsPath);

                    // Migrate existing comments if needed before merging
                    const migratedExistingThreads = this.migrateCommentsIfNeeded(existingCommentsThreads);

                    // Validate that cellId has a URI
                    if (!message.commentThread.cellId.uri) {
                        console.error("[CommentsProvider] No URI found in cellId:", message.commentThread.cellId);
                        vscode.window.showInformationMessage(
                            `No file found with the cellId: ${message.commentThread.cellId}`
                        );
                        return;
                    }

                    // Convert to relative paths before saving
                    const threadWithRelativePaths = this.convertThreadToRelativePaths(message.commentThread);
                    await serializeCommentsToDisk(
                        migratedExistingThreads,
                        threadWithRelativePaths
                    );
                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteCommentThread": {
                    const commentThreadId = message.commentThreadId;
                    const existingCommentsThreads = await getCommentsFromFile(this.commentsFilePath!.fsPath);
                    // Migrate existing comments if needed before updating
                    const migratedExistingThreads = this.migrateCommentsIfNeeded(existingCommentsThreads);
                    const indexOfCommentToMarkAsDeleted = migratedExistingThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );
                    const commentThreadToMarkAsDeleted =
                        migratedExistingThreads[indexOfCommentToMarkAsDeleted];
                    await serializeCommentsToDisk(migratedExistingThreads, {
                        ...commentThreadToMarkAsDeleted,
                        deletionEvent: [{
                            timestamp: Date.now(),
                            author: { name: await this.getCurrentUsername() },
                            deleted: true
                        }],
                        comments: [],
                    });
                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteComment": {
                    const commentId = message.args.commentId;
                    const commentThreadId = message.args.commentThreadId;
                    const existingCommentsThreads = await getCommentsFromFile(this.commentsFilePath!.fsPath);
                    // Migrate existing comments if needed before updating
                    const migratedExistingThreads = this.migrateCommentsIfNeeded(existingCommentsThreads);
                    const threadIndex = migratedExistingThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = migratedExistingThreads[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: true } : comment
                        );

                        await serializeCommentsToDisk(migratedExistingThreads, {
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
                    const existingCommentsThreads = await getCommentsFromFile(this.commentsFilePath!.fsPath);
                    // Migrate existing comments if needed before updating
                    const migratedExistingThreads = this.migrateCommentsIfNeeded(existingCommentsThreads);
                    const threadIndex = migratedExistingThreads.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = migratedExistingThreads[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: false } : comment
                        );

                        await serializeCommentsToDisk(migratedExistingThreads, {
                            ...thread,
                            comments: updatedComments,
                        });
                    }

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "fetchComments": {
                    this.sendCommentsToWebview(this._view!);
                    // Also send user info in case initialization hasn't completed
                    await this.sendCurrentUserInfo(this._view!);
                    break;
                }
                case "getCurrentCellId": {
                    // Also send user info in case initialization hasn't completed
                    await this.sendCurrentUserInfo(this._view!);

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

    private generateCommentId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private threadTitleToTimestamp(threadTitle: string): number | null {
        try {
            // Parse date string like "7/28/2025, 1:34:46 PM"
            const date = new Date(threadTitle);
            if (!isNaN(date.getTime())) {
                return date.getTime();
            }
        } catch (error) {
            console.log("[CommentsProvider] Failed to parse thread title date:", threadTitle, error);
        }
        return null;
    }

    private migrateComment(comment: any, threadTitle?: string, commentIndex: number = 0): NotebookComment {
        // If already has string ID and timestamp, it's already migrated
        if (typeof comment.id === 'string' && typeof comment.timestamp === 'number') {
            return comment as NotebookComment;
        }

        // Generate unique ID
        const newId = this.generateCommentId();

        // Calculate timestamp
        let timestamp: number;
        if (comment.timestamp) {
            timestamp = comment.timestamp;
        } else if (threadTitle) {
            const baseTimestamp = this.threadTitleToTimestamp(threadTitle);
            if (baseTimestamp) {
                // Add 5ms * (index + 1) to space out comments
                timestamp = baseTimestamp + (5 * (commentIndex + 1));
            } else {
                // Fallback to current time minus some offset
                timestamp = Date.now() - (1000 * 60 * 60 * 24) - (5 * (commentIndex + 1));
            }
        } else {
            // Ultimate fallback
            timestamp = Date.now() - (1000 * 60 * 60 * 24) - (5 * (commentIndex + 1));
        }

        return {
            id: newId,
            timestamp,
            body: comment.body,
            mode: comment.mode || 1,
            deleted: comment.deleted || false,
            author: comment.author || { name: "Unknown" }
        };
    }

    private convertToRelativePath(uri: string | undefined): string | undefined {
        if (!uri) return uri;

        try {
            // First decode any URL encoding
            const decodedUri = decodeURIComponent(uri);

            // Extract the path from the file:/// URI
            let filePath = decodedUri;
            if (filePath.startsWith('file:///')) {
                filePath = filePath.substring(8);

                // On Windows, we might have a drive letter like C:
                // Remove the drive portion to get to the actual path
                if (/^[a-zA-Z]:/.test(filePath)) {
                    filePath = filePath.substring(2);
                }
            }

            // Find the project folder name in the path
            // We look for the pattern /.codex-projects/PROJECT_NAME/ or just /PROJECT_NAME/
            const pathParts = filePath.split('/');

            // Find where .codex-projects appears or where we transition to project content
            let projectStartIndex = -1;
            for (let i = 0; i < pathParts.length; i++) {
                if (pathParts[i] === '.codex-projects' && i + 1 < pathParts.length) {
                    // Skip .codex-projects and the project name
                    projectStartIndex = i + 2;
                    break;
                } else if (pathParts[i] === 'files' || pathParts[i] === '.project') {
                    // We found project content, so the previous part was likely the project name
                    projectStartIndex = i;
                    break;
                }
            }

            if (projectStartIndex > 0 && projectStartIndex < pathParts.length) {
                // Return the relative path from the project root
                return pathParts.slice(projectStartIndex).join('/');
            }

            // If we couldn't parse it properly, return the original
            console.log("[CommentsProvider] Could not convert to relative path:", uri);
            return uri;
        } catch (error) {
            console.log("[CommentsProvider] Error converting to relative path:", uri, error);
            return uri;
        }
    }

    private convertThreadToRelativePaths(thread: NotebookCommentThread): NotebookCommentThread {
        return {
            ...thread,
            cellId: thread.cellId ? {
                ...thread.cellId,
                uri: this.convertToRelativePath(thread.cellId.uri) || thread.cellId.uri
            } : thread.cellId
        };
    }

    private migrateCommentsIfNeeded(threads: any[]): NotebookCommentThread[] {
        // Check if ANY comment needs migration (missing timestamp or has numeric ID)
        const needsMigration = threads.some(thread =>
            thread.comments && thread.comments.some((comment: any) =>
                typeof comment.timestamp !== 'number' || typeof comment.id === 'number'
            )
        );

        // Also check if any thread has version field, legacy uri field, contextValue fields, encoded URIs, absolute paths, old deleted/resolved fields, or missing new fields
        const needsCleanup = threads.some(thread =>
            thread.version !== undefined ||
            thread.uri !== undefined || // Remove legacy uri field
            thread.deleted !== undefined ||    // Old boolean field - should be deletionEvent array
            thread.resolved !== undefined ||  // Old boolean field - should be resolvedEvent array
            thread.deletionEvent === undefined ||  // Missing new array field
            thread.resolvedEvent === undefined || // Missing new array field
            (thread.cellId?.uri && (thread.cellId.uri.includes('%') || thread.cellId.uri.startsWith('file://'))) ||
            (thread.comments && thread.comments.some((comment: any) => comment.contextValue !== undefined)) // Check for contextValue
        );

        if (!needsMigration && !needsCleanup) {
            return threads;
        }

        return threads.map(thread => {
            // Check if this specific thread needs migration
            const threadNeedsMigration = thread.comments.some((comment: any) =>
                typeof comment.timestamp !== 'number' || typeof comment.id === 'number'
            );

            let result = { ...thread };

            // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
            // Remove legacy fields if they exist
            delete result.version;
            delete result.uri; // Remove redundant uri field

            // Migrate deleted/resolved from boolean to event arrays if needed
            if (!('deletionEvent' in result)) {
                if (typeof result.deleted === 'boolean') {
                    if (result.deleted && result.comments && result.comments.length > 0) {
                        const latestComment = result.comments.reduce((latest: any, comment: any) =>
                            comment.timestamp > latest.timestamp ? comment : latest
                        );
                        result.deletionEvent = [{
                            timestamp: latestComment.timestamp + 5,
                            author: { name: latestComment.author.name },
                            deleted: true
                        }];
                    } else {
                        result.deletionEvent = [];
                    }
                    delete result.deleted; // Remove old boolean field
                } else {
                    result.deletionEvent = [];
                }
            }
            if (!('resolvedEvent' in result)) {
                if (typeof result.resolved === 'boolean') {
                    if (result.resolved && result.comments && result.comments.length > 0) {
                        const latestComment = result.comments.reduce((latest: any, comment: any) =>
                            comment.timestamp > latest.timestamp ? comment : latest
                        );
                        result.resolvedEvent = [{
                            timestamp: latestComment.timestamp + 5,
                            author: { name: latestComment.author.name },
                            resolved: true
                        }];
                    } else {
                        result.resolvedEvent = [];
                    }
                    delete result.resolved; // Remove old boolean field
                } else {
                    result.resolvedEvent = [];
                }
            }

            // Clean up legacy contextValue from all comments
            if (result.comments) {
                result.comments.forEach((comment: any) => {
                    delete comment.contextValue;
                });
            }
            // ============= END MIGRATION CLEANUP =============

            if (threadNeedsMigration) {
                result.comments = thread.comments.map((comment: any, index: number) =>
                    this.migrateComment(comment, thread.threadTitle, index)
                );
            }

            // Convert to relative paths
            result = this.convertThreadToRelativePaths(result);

            return result;
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

            // Parse and migrate if needed
            let comments = JSON.parse(fileContent);
            const migratedComments = this.migrateCommentsIfNeeded(comments);

            // If migration happened, save the migrated version
            if (migratedComments !== comments) {
                const migratedContent = CommentsMigrator.formatCommentsForStorage(migratedComments);
                await writeSerializedData(migratedContent, this.commentsFilePath.fsPath);
                console.log("[CommentsProvider] Saved migrated comments to disk");

                safePostMessageToView(webviewView, {
                    command: "commentsFromWorkspace",
                    content: migratedContent,
                } as CommentPostMessages);

                this.lastSentComments = migratedContent;
            } else {
                safePostMessageToView(webviewView, {
                    command: "commentsFromWorkspace",
                    content: fileContent,
                } as CommentPostMessages);

                this.lastSentComments = fileContent;
            }
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

    private async getCurrentUserName(): Promise<string> {
        try {
            // First try authenticated user
            if (this.isAuthenticated && this.authApi) {
                const user = await this.authApi.getUserInfo();
                if (user && user.username) {
                    return user.username;
                }
            }

            // Try git username
            const gitUsername = vscode.workspace.getConfiguration("git").get<string>("username");
            if (gitUsername) return gitUsername;

            // Try VS Code authentication
            const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
            if (session && session.account) {
                return session.account.label;
            }
        } catch (error) {
            // Silent fallback
        }

        // Fallback
        return "unknown";
    }
}


