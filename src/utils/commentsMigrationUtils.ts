import * as vscode from "vscode";
import { NotebookCommentThread, NotebookComment } from "../../types";
import { writeSerializedData } from "./fileUtils";

/**
 * Centralized comments migration utilities
 * Handles migration from file-comments.json to .project/comments.json
 */

export class CommentsMigrator {

    /**
 * Ensures consistent JSON formatting for minimal git diffs
 * IMPORTANT: Does NOT reorder existing threads to preserve git history
 */
    static formatCommentsForStorage(comments: NotebookCommentThread[]): string {
        // DO NOT sort threads - preserve existing order to minimize git diffs
        // Only ensure consistent key ordering within each thread
        const orderedThreads = comments.map(thread => {
            const orderedThread: any = {
                id: thread.id,
                canReply: thread.canReply,
                cellId: {
                    cellId: thread.cellId.cellId,
                    uri: thread.cellId.uri
                },
                collapsibleState: thread.collapsibleState,
                threadTitle: thread.threadTitle
            };

            // Always include deletionEvent (empty array if none)
            orderedThread.deletionEvent = thread.deletionEvent
                ? thread.deletionEvent.map(event => ({
                    timestamp: event.timestamp,
                    author: {
                        name: event.author.name
                    },
                    valid: event.valid
                }))
                : [];

            // Always include resolvedEvent (empty array if none)
            orderedThread.resolvedEvent = thread.resolvedEvent
                ? thread.resolvedEvent.map(event => ({
                    timestamp: event.timestamp,
                    author: {
                        name: event.author.name
                    },
                    valid: event.valid
                }))
                : [];

            orderedThread.comments = thread.comments
                .slice() // Create a copy to avoid mutating the original
                .sort((a, b) => a.timestamp - b.timestamp) // Sort comments by timestamp
                .map(comment => ({
                    id: comment.id,
                    timestamp: comment.timestamp,
                    body: comment.body,
                    mode: comment.mode,
                    author: {
                        name: comment.author.name
                    },
                    deleted: comment.deleted
                }));

            return orderedThread;
        });

        return JSON.stringify(orderedThreads, null, 4);
    }

    /**
     * Main migration function that can be called from any context
     */
    static async migrateProjectComments(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const projectDir = vscode.Uri.joinPath(workspaceUri, ".project");
            const legacyFilePath = vscode.Uri.joinPath(workspaceUri, "file-comments.json");
            const newCommentsFilePath = vscode.Uri.joinPath(projectDir, "comments.json");

            // Check if legacy file exists
            let legacyExists = false;
            try {
                await vscode.workspace.fs.stat(legacyFilePath);
                legacyExists = true;
            } catch (error) {
                // Legacy file doesn't exist - but we might still need to migrate comments.json
            }

            // Check if comments.json exists and needs migration
            let commentsExists = false;
            let commentsNeedsMigration = false;
            try {
                await vscode.workspace.fs.stat(newCommentsFilePath);
                commentsExists = true;

                // Check if the existing comments.json needs migration
                const existingFileContent = await vscode.workspace.fs.readFile(newCommentsFilePath);
                const existingComments = JSON.parse(new TextDecoder().decode(existingFileContent));
                commentsNeedsMigration = CommentsMigrator.needsStructuralMigration(existingComments);
            } catch (error) {
                // Comments file doesn't exist yet
            }

            // If neither legacy file exists nor comments.json needs migration, nothing to do
            if (!legacyExists && !commentsNeedsMigration) {
                return false;
            }

            const migrationActions: string[] = [];

            if (legacyExists) {
                migrationActions.push("file-comments.json migration");
            }
            if (commentsNeedsMigration) {
                migrationActions.push("comments.json structure migration");
            }

            console.log(`[CommentsMigrator] Starting migration: ${migrationActions.join(" + ")}`);

            // Ensure .project directory exists
            try {
                await vscode.workspace.fs.stat(projectDir);
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    await vscode.workspace.fs.createDirectory(projectDir);
                } else {
                    throw error;
                }
            }

            // Read existing comments.json if it exists
            let existingComments: any[] = [];
            if (commentsExists) {
                try {
                    const existingFileContent = await vscode.workspace.fs.readFile(newCommentsFilePath);
                    existingComments = JSON.parse(new TextDecoder().decode(existingFileContent));
                } catch (error) {
                    console.error("[CommentsMigrator] Error reading existing comments.json:", error);
                    existingComments = [];
                }
            }

            // Handle legacy file-comments.json migration
            let legacyComments: any[] = [];
            if (legacyExists) {
                const legacyFileContent = await vscode.workspace.fs.readFile(legacyFilePath);
                const fileContentString = new TextDecoder().decode(legacyFileContent).trim();

                // Handle empty files
                if (!fileContentString) {
                    console.log("[CommentsMigrator] Legacy file-comments.json is completely empty, deleting");
                    await vscode.workspace.fs.delete(legacyFilePath);
                } else {
                    try {
                        const parsedLegacyComments = JSON.parse(fileContentString);
                        if (Array.isArray(parsedLegacyComments) && parsedLegacyComments.length > 0) {
                            legacyComments = parsedLegacyComments;
                            console.log(`[CommentsMigrator] Found ${legacyComments.length} threads in file-comments.json`);
                        } else {
                            console.log("[CommentsMigrator] Legacy file-comments.json is empty array, deleting");
                        }
                        // Delete legacy file regardless of content
                        await vscode.workspace.fs.delete(legacyFilePath);
                    } catch (parseError) {
                        console.error("[CommentsMigrator] Legacy file-comments.json contains invalid JSON, deleting", parseError);
                        await vscode.workspace.fs.delete(legacyFilePath);
                    }
                }
            }

            // Combine existing comments with legacy comments and migrate structure
            let allComments = [...existingComments];
            if (legacyComments.length > 0) {
                allComments = CommentsMigrator.mergeLegacyCommentsWithEnhancedDeduplication(existingComments, legacyComments);
            }

            // Apply structural migration to all comments (existing + legacy)
            const migratedComments = await CommentsMigrator.migrateCommentsStructure(allComments);

            // Write migrated comments
            const migratedContent = CommentsMigrator.formatCommentsForStorage(migratedComments);
            await vscode.workspace.fs.writeFile(newCommentsFilePath, new TextEncoder().encode(migratedContent));


            return true;

        } catch (error) {
            console.error("[CommentsMigrator] Error during migration:", error);
            return false;
        }
    }

    /**
     * Enhanced deduplication that compares user, body, AND cellId to prevent massive duplicates
     */
    private static mergeLegacyCommentsWithEnhancedDeduplication(existingComments: any[], legacyComments: any[]): any[] {
        const threadMap = new Map<string, any>();

        // Add existing comments first
        existingComments.forEach(thread => {
            threadMap.set(thread.id, thread);
        });

        // Process and add legacy comments with enhanced deduplication
        legacyComments.forEach(legacyThread => {
            // Clean and migrate the legacy thread
            const migratedThread = CommentsMigrator.migrateSingleThread(legacyThread);

            // Check if thread with same ID already exists
            const existingThread = threadMap.get(migratedThread.id);
            if (existingThread) {
                // Merge comments from legacy thread into existing thread with enhanced deduplication
                const mergedComments = CommentsMigrator.mergeCommentsWithEnhancedDeduplication(
                    existingThread.comments,
                    migratedThread.comments,
                    migratedThread.cellId
                );
                existingThread.comments = mergedComments;
                console.log(`[CommentsMigrator] Merged legacy comments into existing thread ${migratedThread.id}`);
            } else {
                // Add new thread
                threadMap.set(migratedThread.id, migratedThread);
                console.log(`[CommentsMigrator] Added new thread from legacy file: ${migratedThread.id}`);
            }
        });

        return Array.from(threadMap.values());
    }

    /**
     * Enhanced comment deduplication - uses ID for modern comments and content for legacy comments
     */
    private static mergeCommentsWithEnhancedDeduplication(existingComments: any[], legacyComments: any[], cellId: any): any[] {
        const commentMap = new Map<string, any>();
        const seenContentSignatures = new Set<string>();

        // Helper function to create content signature for legacy comment deduplication
        const getContentSignature = (comment: any): string => {
            return `${comment.body}|${comment.author?.name || 'Unknown'}`;
        };

        // Add existing comments first
        existingComments.forEach(comment => {
            commentMap.set(comment.id, comment);
            // Track content signature for legacy deduplication
            const signature = getContentSignature(comment);
            seenContentSignatures.add(signature);
            console.log(`[CommentsMigrator] Added existing comment with ID: ${comment.id}`);
        });

        // Add legacy comments with proper deduplication
        legacyComments.forEach(comment => {
            // First check if exact ID already exists (for modern comments)
            if (commentMap.has(comment.id)) {
                console.log(`[CommentsMigrator] Skipping comment with duplicate ID: ${comment.id}`);
                return;
            }

            // For potential legacy comments, check content signature
            const signature = getContentSignature(comment);
            if (seenContentSignatures.has(signature)) {
                console.log(`[CommentsMigrator] Skipping comment with duplicate content: ${signature}`);
                return;
            }

            // Add the comment (unique by both ID and content)
            commentMap.set(comment.id, comment);
            seenContentSignatures.add(signature);
            console.log(`[CommentsMigrator] Added legacy comment with ID: ${comment.id}`);
        });

        // Sort comments by timestamp
        return Array.from(commentMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Creates an enhanced deduplication key that includes cellId context
     * Note: This method is now used only for legacy migration scenarios
     */
    private static createCommentDeduplicationKey(comment: any, cellId: any): string {
        const body = comment.body || '';
        const author = comment.author?.name || 'Unknown';
        const cell = cellId?.cellId || 'unknown-cell';
        const uri = cellId?.uri || 'unknown-uri';

        // Include cell context in deduplication to prevent cross-cell duplicate detection
        return `${body}|${author}|${cell}|${uri}`;
    }

    /**
     * Migrates a single thread from legacy format to new format
     */
    private static migrateSingleThread(thread: any): NotebookCommentThread {
        let result = { ...thread };

        // Remove legacy fields
        delete result.version;
        delete result.uri; // Remove redundant uri field

        // Migrate comments if needed
        if (result.comments) {
            result.comments = result.comments.map((comment: any, index: number) => {
                delete comment.contextValue; // Remove legacy contextValue
                return CommentsMigrator.migrateComment(comment, thread.threadTitle, index);
            });
        }

        // Convert URIs to relative paths
        result = CommentsMigrator.convertThreadToRelativePaths(result);

        return result;
    }

    /**
     * Migrates a single comment from legacy format to new format
     */
    private static migrateComment(comment: any, threadTitle?: string, commentIndex: number = 0): NotebookComment {
        // If already has string ID and timestamp, it's already migrated
        if (typeof comment.id === 'string' && typeof comment.timestamp === 'number') {
            return comment as NotebookComment;
        }

        // Generate unique ID
        const newId = CommentsMigrator.generateCommentId();

        // Calculate timestamp
        let timestamp: number;
        if (comment.timestamp) {
            timestamp = comment.timestamp;
        } else if (threadTitle) {
            const baseTimestamp = CommentsMigrator.threadTitleToTimestamp(threadTitle);
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

    /**
     * Generates a unique comment ID
     */
    private static generateCommentId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
 * Gets the timestamp from a thread, using the last comment's timestamp or current time
 */
    private static getThreadTimestamp(thread: any): number {
        // Try to get timestamp from last comment
        if (thread.comments && Array.isArray(thread.comments) && thread.comments.length > 0) {
            const lastComment = thread.comments[thread.comments.length - 1];
            if (lastComment.timestamp && typeof lastComment.timestamp === 'number') {
                return lastComment.timestamp;
            }
        }

        // Fallback to current time
        return Date.now();
    }

    /**
     * Gets the current user name from git config or VS Code settings
     */
    private static async getCurrentUser(): Promise<string> {
        try {
            // Try git username first
            const gitUsername = vscode.workspace.getConfiguration("git").get<string>("username");
            if (gitUsername) return gitUsername;

            // Try VS Code authentication session
            try {
                const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
                if (session && session.account) {
                    return session.account.label;
                }
            } catch (e) {
                // Auth provider might not be available
            }
        } catch (error) {
            // Silent fallback
        }

        // Fallback
        return "unknown";
    }

    /**
 * Determines if a comment was recently migrated from legacy format
 */
    private static isLegacyComment(comment: any): boolean {
        // Check if it still has numeric ID (definitely legacy)
        if (typeof comment.id === 'number') {
            return true;
        }

        // For timestamp-based IDs, check the relationship between ID timestamp and comment timestamp
        if (typeof comment.id === 'string' && comment.id.includes('-')) {
            const idTimestamp = parseInt(comment.id.split('-')[0]);
            if (!isNaN(idTimestamp)) {
                const timeDiff = Math.abs((comment.timestamp || 0) - idTimestamp);

                // Modern comments: ID timestamp = comment timestamp (same moment)
                // Legacy comments: ID timestamp ≠ comment timestamp (calculated during migration)
                return timeDiff >= 100; // Different times = legacy migration
            }
        }

        return false;
    }

    /**
     * Converts thread title to timestamp
     */
    private static threadTitleToTimestamp(threadTitle: string): number | null {
        try {
            // Parse date string like "7/28/2025, 1:34:46 PM"
            const date = new Date(threadTitle);
            if (!isNaN(date.getTime())) {
                return date.getTime();
            }
        } catch (error) {
            console.log("[CommentsMigrator] Failed to parse thread title date:", threadTitle, error);
        }
        return null;
    }

    /**
     * Converts absolute paths to relative paths
     */
    private static convertToRelativePath(uri: string | undefined): string | undefined {
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
            console.log("[CommentsMigrator] Could not convert to relative path:", uri);
            return uri;
        } catch (error) {
            console.log("[CommentsMigrator] Error converting to relative path:", uri, error);
            return uri;
        }
    }

    /**
     * Converts thread URIs to relative paths
     */
    private static convertThreadToRelativePaths(thread: NotebookCommentThread): NotebookCommentThread {
        return {
            ...thread,
            cellId: thread.cellId ? {
                ...thread.cellId,
                uri: CommentsMigrator.convertToRelativePath(thread.cellId.uri) || thread.cellId.uri
            } : thread.cellId
        };
    }

    /**
     * Checks if migration is needed (for use in other parts of the codebase)
     */
    static async needsMigration(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            // Check for legacy file-comments.json
            const legacyFilePath = vscode.Uri.joinPath(workspaceUri, "file-comments.json");
            try {
                await vscode.workspace.fs.stat(legacyFilePath);
                return true;
            } catch (error) {
                // Legacy file doesn't exist, check if comments.json needs migration
            }

            // Check if comments.json exists and needs structural migration
            const commentsFilePath = vscode.Uri.joinPath(workspaceUri, ".project", "comments.json");
            try {
                const fileContent = await vscode.workspace.fs.readFile(commentsFilePath);
                const comments = JSON.parse(new TextDecoder().decode(fileContent));
                return CommentsMigrator.needsStructuralMigration(comments);
            } catch (error) {
                // Comments file doesn't exist or is invalid
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if comments array needs structural migration (old format detection)
     */
    static needsStructuralMigration(comments: any[]): boolean {
        if (!Array.isArray(comments) || comments.length === 0) {
            return false;
        }

        const needsMigration = comments.some(thread => {
            // Check for old thread structure or missing new fields
            if (thread.version !== undefined ||
                thread.uri !== undefined ||
                thread.deleted !== undefined ||  // Old boolean field
                thread.resolved !== undefined || // Old boolean field
                thread.deletionEvent === undefined || // Missing new field
                thread.resolvedEvent === undefined || // Missing new field
                (thread.cellId?.uri && (thread.cellId.uri.includes('%') || thread.cellId.uri.startsWith('file://')))) {
                return true;
            }

            // Check for old comment structure
            if (thread.comments && Array.isArray(thread.comments)) {
                return thread.comments.some((comment: any) =>
                    typeof comment.id === 'number' ||
                    typeof comment.timestamp !== 'number' ||
                    comment.contextValue !== undefined
                );
            }

            return false;
        });

        return needsMigration;
    }

    /**
     * Migrates the structure of all comments to the new format
     */
    static async migrateCommentsStructure(comments: any[]): Promise<NotebookCommentThread[]> {
        if (!Array.isArray(comments)) {
            return [];
        }

        return Promise.all(comments.map(async thread => {
            let result = { ...thread };

            // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
            // Remove legacy fields if they exist
            delete result.version;
            delete result.uri; // Remove redundant uri field

            // Migrate old deleted/resolved booleans to new event arrays
            if ('deleted' in result) {
                if (result.deleted === true) {
                    // Use timestamp from last comment or current time
                    const timestamp = CommentsMigrator.getThreadTimestamp(result);
                    result.deletionEvent = [{
                        timestamp,
                        author: { name: await CommentsMigrator.getCurrentUser() },
                        valid: true
                    }];
                } else {
                    // Was false, so no deletion event
                    result.deletionEvent = [];
                }
                delete result.deleted;
            } else if (!result.deletionEvent) {
                // Ensure field exists even if no old field
                result.deletionEvent = [];
            }

            if ('resolved' in result) {
                if (result.resolved === true) {
                    // Use timestamp from last comment or current time
                    const timestamp = CommentsMigrator.getThreadTimestamp(result);
                    result.resolvedEvent = [{
                        timestamp,
                        author: { name: await CommentsMigrator.getCurrentUser() },
                        valid: true
                    }];
                } else {
                    // Was false, so no resolved event
                    result.resolvedEvent = [];
                }
                delete result.resolved;
            } else if (!result.resolvedEvent) {
                // Ensure field exists even if no old field
                result.resolvedEvent = [];
            }

            // Clean up legacy contextValue from all comments
            if (result.comments && Array.isArray(result.comments)) {
                result.comments = result.comments.map((comment: any, index: number) => {
                    delete comment.contextValue; // Remove legacy contextValue
                    return CommentsMigrator.migrateComment(comment, thread.threadTitle, index);
                });
            }
            // ============= END MIGRATION CLEANUP =============

            // Convert URIs to relative paths
            result = CommentsMigrator.convertThreadToRelativePaths(result);

            return result;
        }));
    }

    /**
     * Checks if comments files are in source control
     */
    static async areCommentsFilesInSourceControl(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            // Check if we have git
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return false;
            }

            // Simple check: see if .git directory exists
            const gitDir = vscode.Uri.joinPath(workspaceUri, ".git");
            try {
                await vscode.workspace.fs.stat(gitDir);
            } catch (error) {
                return false; // No git repo
            }

            // Check if either file-comments.json or .project/comments.json exist
            // (We consider them "in source control" if they exist in a git repo)
            const legacyFile = vscode.Uri.joinPath(workspaceUri, "file-comments.json");
            const newFile = vscode.Uri.joinPath(workspaceUri, ".project", "comments.json");

            const legacyExists = await CommentsMigrator.fileExists(legacyFile);
            const newExists = await CommentsMigrator.fileExists(newFile);

            return legacyExists || newExists;
        } catch (error) {
            console.log("[CommentsMigrator] Error checking source control status:", error);
            return false;
        }
    }

    /**
     * Helper to check if a file exists
     */
    private static async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch (error) {
            return false;
        }
    }
} 