import * as vscode from "vscode";
import { CommentPostMessages, CellIdGlobalState, NotebookCommentThread, NotebookComment } from "../../../types";
import { initializeStateStore } from "../../stateStore";
import { getCommentsFromFile, writeSerializedData } from "../../utils/fileUtils";
import { CommentsMigrator } from "../../utils/commentsMigrationUtils";
import { Uri, window, workspace } from "vscode";
import { BaseWebviewProvider, GlobalProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
import { getAuthApi } from "../../extension";

const DEBUG_COMMENTS_WEBVIEW_PROVIDER = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_COMMENTS_WEBVIEW_PROVIDER) {
        console.log(`[CommentsWebviewProvider] ${message}`, ...args);
    }
}

export class CustomWebviewProvider extends BaseWebviewProvider {
    selectionChangeListener: any;
    commentsFilePath: Uri | undefined;
    private lastSentComments: string = "";
    private authApi = getAuthApi();
    private isAuthenticated = false;
    private stateStoreListener?: () => void; // Add state store listener cleanup function

    // In-memory comment cache (like .codex files)
    private _inMemoryComments: NotebookCommentThread[] = [];
    private _isDirty: boolean = false;
    private _pendingChanges: Set<string> = new Set(); // Track which threads have pending changes
    private _isInitialized: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.initializeAuthState();
        this.setupStateStoreListener(); // Initialize state store listener
    }

    protected getWebviewId(): string {
        return "comments-sidebar";
    }

    /**
 * Handle external file changes, potentially merging with unsaved local changes
 */
    private async handleExternalFileChange(): Promise<void> {
        if (!this.commentsFilePath) {
            console.warn("[CommentsProvider] Cannot handle external change - file path not initialized");
            return;
        }

        if (this._isDirty && this._pendingChanges.size > 0) {
            debug("[CommentsProvider] External change detected with local unsaved changes, merging...");

            // Save our current changes with merge (this will handle the conflict)
            await this.saveCommentsWithMerge();

            // Optional: Show subtle notification about merge
            // vscode.window.showInformationMessage("Comments updated from external changes and merged with your local changes.", { modal: false });
        } else {
            debug("[CommentsProvider] External change detected with no local changes, reloading...");

            // No local changes, safe to reload from file
            await this.loadCommentsIntoMemory();

            // Optional: Show subtle notification about update
            // vscode.window.showInformationMessage("Comments updated from external changes.", { modal: false });
        }
    }

    /**
     * Load comments from file into in-memory cache (like .codex files)
     */
    private async loadCommentsIntoMemory(): Promise<void> {
        if (!this.commentsFilePath) {
            console.warn("[CommentsProvider] Cannot load comments - file path not initialized");
            return;
        }

        try {
            const existingComments = await getCommentsFromFile(".project/comments.json");
            this._inMemoryComments = [...existingComments];
            this._isDirty = false;
            this._pendingChanges.clear();
            this._isInitialized = true;

        } catch (error) {
            debug("[CommentsProvider] No existing comments file, starting with empty cache");
            this._inMemoryComments = [];
            this._isDirty = false;
            this._pendingChanges.clear();
            this._isInitialized = true;
        }
    }

    /**
     * Save in-memory comments to file with merge (like .codex files)
     */
    private async saveCommentsWithMerge(): Promise<void> {
        if (!this._isDirty || !this.commentsFilePath) {
            return; // No changes to save
        }

        try {
            // Read current file content (may have changed from other users)
            let currentFileContent: string;
            try {
                const fileContentUint8Array = await workspace.fs.readFile(this.commentsFilePath);
                currentFileContent = new TextDecoder().decode(fileContentUint8Array);
            } catch (error) {
                // File doesn't exist, use empty array
                currentFileContent = "[]";
            }

            // Prepare our in-memory content for merge
            const ourContent = CommentsMigrator.formatCommentsForStorage(this._inMemoryComments);

            // Use existing merge logic to combine our changes with current file
            const { resolveCommentThreadsConflict } = await import("../../projectManager/utils/merge/resolvers");
            const mergedContent = await resolveCommentThreadsConflict(ourContent, currentFileContent);

            // Write merged result
            await workspace.fs.writeFile(this.commentsFilePath, new TextEncoder().encode(mergedContent));

            // Update our in-memory cache with the merged result (to stay in sync)
            const mergedComments = JSON.parse(mergedContent);
            this._inMemoryComments = mergedComments;

            this._isDirty = false;
            this._pendingChanges.clear();


        } catch (error) {
            console.error("[CommentsProvider] Error saving comments with merge:", error);
            throw error;
        }
    }

    /**
     * Update a comment thread in memory (marks as dirty)
     */
    private updateCommentThreadInMemory(newThread: NotebookCommentThread): void {
        const threadIndex = this._inMemoryComments.findIndex(thread => thread.id === newThread.id);

        if (threadIndex !== -1) {
            // Update existing thread
            this._inMemoryComments[threadIndex] = {
                ...this._inMemoryComments[threadIndex],
                ...newThread,
                comments: newThread.comments || this._inMemoryComments[threadIndex].comments,
            };
        } else {
            // Add new thread
            this._inMemoryComments.push(newThread);
        }

        this._isDirty = true;
        this._pendingChanges.add(newThread.id);

    }

    /**
     * Delete a comment thread from memory (marks as dirty)
     */
    private deleteCommentThreadFromMemory(threadId: string): void {
        const threadIndex = this._inMemoryComments.findIndex(thread => thread.id === threadId);

        if (threadIndex !== -1) {
            this._inMemoryComments.splice(threadIndex, 1);
            this._isDirty = true;
            this._pendingChanges.add(threadId);

        }
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
            debug("[CommentsProvider] Initializing auth state...");
            if (this.authApi) {
                const authStatus = this.authApi.getAuthStatus();
                this.isAuthenticated = authStatus.isAuthenticated;
                debug("[CommentsProvider] Auth API found, isAuthenticated:", this.isAuthenticated);
            } else {
                this.isAuthenticated = false;
                debug("[CommentsProvider] No auth API found, setting isAuthenticated to false");
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

        debug("[CommentsProvider] Comments file path:", this.commentsFilePath.fsPath);

        try {
            // First ensure the .project directory exists
            try {
                await vscode.workspace.fs.stat(projectDir);
                debug("[CommentsProvider] .project directory exists");
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    debug("[CommentsProvider] Creating .project directory");
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
                debug("[CommentsProvider] Comments file exists");

                // Note: Data repair is handled at startup and during sync when comments.json is changed
                // See SyncManager and extension.ts for targeted repair logic
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    debug("[CommentsProvider] Creating comments file");
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
        debug("[CommentsProvider] sendCurrentUserInfo called, isAuthenticated:", this.isAuthenticated, "authApi exists:", !!this.authApi);

        if (this.isAuthenticated && this.authApi) {
            try {
                const user = await this.authApi.getUserInfo();
                debug("[CommentsProvider] Got user info:", user ? { username: user.username, email: user.email } : "null");

                if (user) {
                    const message = {
                        command: "updateUserInfo",
                        userInfo: {
                            username: user.username,
                            email: user.email || "",
                        },
                    } as CommentPostMessages;
                    debug("[CommentsProvider] Sending authenticated user message:", message);
                    const sent = safePostMessageToView(webviewView, message);
                    debug("[CommentsProvider] Message send result:", sent);
                } else {
                    // Send unauthenticated state
                    const message = {
                        command: "updateUserInfo",
                    } as CommentPostMessages;
                    debug("[CommentsProvider] User is null, sending unauthenticated message:", message);
                    const sent = safePostMessageToView(webviewView, message);
                    debug("[CommentsProvider] Message send result:", sent);
                }
            } catch (error) {
                console.error("[CommentsProvider] Failed to get user info:", error);
                // Send unauthenticated state on error
                const message = {
                    command: "updateUserInfo",
                } as CommentPostMessages;
                debug("[CommentsProvider] Error getting user, sending unauthenticated message:", message);
                const sent = safePostMessageToView(webviewView, message);
                debug("[CommentsProvider] Message send result:", sent);
            }
        } else {
            // Send unauthenticated state
            const message = {
                command: "updateUserInfo",
            } as CommentPostMessages;
            debug("[CommentsProvider] Not authenticated or no authApi, sending unauthenticated message:", message);
            const sent = safePostMessageToView(webviewView, message);
            debug("[CommentsProvider] Message send result:", sent);
        }
    }

    private async setupStateStoreListener() {
        try {
            const { storeListener } = await initializeStateStore();

            // Set up listener for cellId changes
            this.stateStoreListener = storeListener(
                "cellId",
                (value: CellIdGlobalState | undefined) => {
                    debug("[CommentsProvider] Cell ID change detected:", value);
                    if (value && this._view) {
                        // Send reload message to webview with new cell ID and globalReferences
                        safePostMessageToView(this._view, {
                            command: "reload",
                            data: {
                                cellId: value.cellId,
                                globalReferences: value.globalReferences,
                                uri: value.uri,
                            },
                        } as CommentPostMessages);
                    }
                }
            );
            debug("[CommentsProvider] State store listener initialized successfully");
        } catch (error) {
            console.error("[CommentsProvider] Failed to initialize state store listener:", error);
        }
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        debug("[CommentsProvider] onWebviewResolved called");

        // Initialize everything asynchronously
        this.initializeWebview(webviewView).catch(error => {
            console.error("[CommentsProvider] Error in initializeWebview:", error);
        });

        // Watch for changes to comments file
        const commentsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], ".project/comments.json")
        );

        commentsWatcher.onDidChange(async () => {
            try {
                debug("[CommentsProvider] Comments file changed externally, handling...");

                // Handle external change with potential conflict resolution
                await this.handleExternalFileChange();

                // Send updated comments to webview with live update flag
                await this.sendCommentsToWebview(webviewView, true);

                // Notify all other providers that comments have changed
                GlobalProvider.getInstance().postMessageToAllProviders({
                    command: "commentsUpdated",
                    destination: "provider",
                    content: {
                        type: "commentsFileChanged",
                        timestamp: new Date().toISOString(),
                    }
                });

                debug("[CommentsProvider] Successfully handled external comments file change and notified all providers");
            } catch (error) {
                console.error("[CommentsProvider] Error handling external comments file change:", error);
                // Still try to send whatever we have in memory
                this.sendCommentsToWebview(webviewView);
            }
        });

        // Watch for legacy file-comments.json and trigger migration immediately
        const legacyCommentsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], "file-comments.json")
        );

        legacyCommentsWatcher.onDidCreate(async () => {
            try {
                debug("[CommentsProvider] Legacy comments file created, migrating...");
                await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders![0].uri);

                // Reload cache to pick up migrated comments
                await this.loadCommentsIntoMemory();

                // Refresh the webview to show migrated content
                this.sendCommentsToWebview(webviewView);
                debug("[CommentsProvider] Successfully migrated legacy comments");
            } catch (error) {
                console.error("[CommentsProvider] Error migrating legacy comments on create:", error);
                // Silent fallback - still try to send what we have
                this.sendCommentsToWebview(webviewView);
            }
        });

        legacyCommentsWatcher.onDidChange(async () => {
            try {
                debug("[CommentsProvider] Legacy comments file changed, migrating...");
                await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders![0].uri);

                // Reload cache to pick up migrated comments
                await this.loadCommentsIntoMemory();

                // Refresh the webview to show migrated content
                this.sendCommentsToWebview(webviewView);
                debug("[CommentsProvider] Successfully migrated legacy comments");
            } catch (error) {
                console.error("[CommentsProvider] Error migrating legacy comments on change:", error);
                // Silent fallback - still try to send what we have
                this.sendCommentsToWebview(webviewView);
            }
        });

        this._context.subscriptions.push(commentsWatcher, legacyCommentsWatcher);

        // Clean up state store listener when webview is disposed
        webviewView.onDidDispose(() => {
            if (this.stateStoreListener) {
                this.stateStoreListener();
                this.stateStoreListener = undefined;
                debug("[CommentsProvider] State store listener disposed");
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
            debug("[CommentsProvider] Comments file path not initialized, initializing now...");
            await this.initializeCommentsFile();
        }

        if (!this.commentsFilePath) {
            console.error("[CommentsProvider] Failed to initialize comments file path");
            return;
        }

        // Load comments into memory if not already initialized
        if (!this._isInitialized) {
            await this.loadCommentsIntoMemory();
        }



        try {
            switch (message.command) {
                case "updateCommentThread": {
                    // Validate that cellId has a URI
                    if (!message.commentThread.cellId.uri) {
                        console.error("[CommentsProvider] No URI found in cellId:", message.commentThread.cellId);
                        vscode.window.showInformationMessage(
                            `No file found with the cellId: ${message.commentThread.cellId}`
                        );
                        return;
                    }

                    // Convert to relative paths before storing in memory
                    const threadWithRelativePaths = this.convertThreadToRelativePaths(message.commentThread);

                    // Update in memory (marks as dirty)
                    this.updateCommentThreadInMemory(threadWithRelativePaths);

                    // Auto-save after each change (like immediate save, but with merge protection)
                    await this.saveCommentsWithMerge();

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteCommentThread": {
                    const commentThreadId = message.commentThreadId;
                    const threadIndex = this._inMemoryComments.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const threadToDelete = this._inMemoryComments[threadIndex];

                        // Update the thread with deletion event instead of removing it
                        const updatedThread = {
                            ...threadToDelete,
                            deletionEvent: [
                                ...(threadToDelete.deletionEvent || []),
                                {
                                    timestamp: Date.now(),
                                    author: { name: await this.getCurrentUsername() },
                                    deleted: true
                                }
                            ],
                            comments: [],
                        };

                        this.updateCommentThreadInMemory(updatedThread);
                    }

                    // Auto-save after each change
                    await this.saveCommentsWithMerge();

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "deleteComment": {
                    const commentId = message.args.commentId;
                    const commentThreadId = message.args.commentThreadId;
                    const threadIndex = this._inMemoryComments.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = this._inMemoryComments[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: true } : comment
                        );

                        this.updateCommentThreadInMemory({
                            ...thread,
                            comments: updatedComments,
                        });
                    }

                    // Auto-save after each change
                    await this.saveCommentsWithMerge();

                    this.sendCommentsToWebview(this._view!);
                    break;
                }
                case "undoCommentDeletion": {
                    const commentId = message.args.commentId;
                    const commentThreadId = message.args.commentThreadId;
                    const threadIndex = this._inMemoryComments.findIndex(
                        (commentThread: NotebookCommentThread) => commentThread.id === commentThreadId
                    );

                    if (threadIndex !== -1) {
                        const thread = this._inMemoryComments[threadIndex];
                        const updatedComments = thread.comments.map((comment: any) =>
                            comment.id === commentId ? { ...comment, deleted: false } : comment
                        );

                        this.updateCommentThreadInMemory({
                            ...thread,
                            comments: updatedComments,
                        });
                    }

                    // Auto-save after each change
                    await this.saveCommentsWithMerge();

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
                                        cellId: value.cellId,
                                        globalReferences: value.globalReferences,
                                        uri: value.uri,
                                    },
                                } as CommentPostMessages);
                            }
                        });
                    });
                    break;
                }
                case "reload": {
                    // Send reload message to the webview with optional cellId and uri
                    if (message.data) {
                        safePostMessageToView(this._view, {
                            command: "reload",
                            data: message.data,
                        } as CommentPostMessages);
                    }
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
            debug("[CommentsProvider] Failed to parse thread title date:", threadTitle, error);
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
            debug("[CommentsProvider] Could not convert to relative path:", uri);
            return uri;
        } catch (error) {
            debug("[CommentsProvider] Error converting to relative path:", uri, error);
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

    private async sendCommentsToWebview(webviewView: vscode.WebviewView, isLiveUpdate: boolean = false) {
        // Load comments into memory if not already initialized
        if (!this._isInitialized && this.commentsFilePath) {
            await this.loadCommentsIntoMemory();
        }

        try {
            // Send in-memory comments to webview (no file reading needed)
            const content = CommentsMigrator.formatCommentsForStorage(this._inMemoryComments);

            safePostMessageToView(webviewView, {
                command: "commentsFromWorkspace",
                content: content,
                isLiveUpdate: isLiveUpdate, // Flag to indicate this is from external file change
            } as CommentPostMessages);

            this.lastSentComments = content;

        } catch (error) {
            console.error("[CommentsProvider] Error sending comments to webview:", error);
            // Fallback to empty array
            safePostMessageToView(webviewView, {
                command: "commentsFromWorkspace",
                content: "[]",
                isLiveUpdate: isLiveUpdate,
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
                data: {
                    cellId: cellId.cellId,
                    globalReferences: cellId.globalReferences,
                },
            } as CommentPostMessages);
        }
    }

}


