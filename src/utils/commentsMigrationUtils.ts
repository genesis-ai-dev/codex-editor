import * as vscode from "vscode";
import { NotebookCommentThread, NotebookComment } from "../../types";
import { writeSerializedData } from "./fileUtils";

const DEBUG_COMMENTS_MIGRATION = false;
const COMMENTS_CELL_ID_MIGRATION_CUTOFF_DATE = new Date("2026-02-27");
function debug(message: string, ...args: any[]): void {
    if (DEBUG_COMMENTS_MIGRATION) {
        console.log(`[CommentsMigrator] ${message}`, ...args);
    }
}
/**
 * Centralized comments migration utilities
 * Handles migration from file-comments.json to .project/comments.json
 */

export class CommentsMigrator {
    // Cache `needsMigration()` results keyed by workspace path + comments.json stat signature.
    // This avoids repeatedly reading/parsing potentially-large `.project/comments.json` during sync.
    private static needsMigrationCache = new Map<string, { commentsStatKey: string; result: boolean; }>();

    private static clearNeedsMigrationCache(workspaceUri: vscode.Uri): void {
        CommentsMigrator.needsMigrationCache.delete(workspaceUri.fsPath);
    }

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
                    uri: thread.cellId.uri,
                    ...(thread.cellId.globalReferences && thread.cellId.globalReferences.length > 0 
                        ? { globalReferences: thread.cellId.globalReferences } 
                        : {}),
                    // NOTE: Display fields (fileDisplayName, milestoneValue, cellLineNumber) are calculated at runtime
                    // and NOT persisted to JSON to keep files clean and ensure fresh data on each load.
                    // ...(thread.cellId.fileDisplayName ? { fileDisplayName: thread.cellId.fileDisplayName } : {}),
                    // ...(thread.cellId.milestoneValue ? { milestoneValue: thread.cellId.milestoneValue } : {}),
                    // ...(thread.cellId.cellLineNumber ? { cellLineNumber: thread.cellId.cellLineNumber } : {})
                },
                collapsibleState: thread.collapsibleState,
                threadTitle: thread.threadTitle
            };

            // Handle deleted/resolved migration from boolean to event arrays
            if (typeof (thread as any).deleted === 'boolean') {
                if ((thread as any).deleted && thread.comments && thread.comments.length > 0) {
                    // Find the latest comment to get timestamp and author
                    const latestComment = thread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    orderedThread.deletionEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        deleted: true
                    }];
                } else {
                    orderedThread.deletionEvent = [];
                }
            } else {
                // Already in new format or undefined
                orderedThread.deletionEvent = thread.deletionEvent || [];
            }

            if (typeof (thread as any).resolved === 'boolean') {
                if ((thread as any).resolved && thread.comments && thread.comments.length > 0) {
                    // Find the latest comment to get timestamp and author
                    const latestComment = thread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    orderedThread.resolvedEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        resolved: true
                    }];
                } else {
                    orderedThread.resolvedEvent = [];
                }
            } else {
                // Already in new format or undefined
                orderedThread.resolvedEvent = thread.resolvedEvent || [];
            }

            orderedThread.comments = thread.comments
                .slice() // Create a copy to avoid mutating the original
                // DO NOT sort comments - preserve existing order to minimize git diffs
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
                    debug("[CommentsMigrator] Legacy file-comments.json is completely empty, deleting");
                    await vscode.workspace.fs.delete(legacyFilePath);
                } else {
                    try {
                        const parsedLegacyComments = JSON.parse(fileContentString);
                        if (Array.isArray(parsedLegacyComments) && parsedLegacyComments.length > 0) {
                            legacyComments = parsedLegacyComments;
                            console.log(`[CommentsMigrator] Found ${legacyComments.length} threads in file-comments.json`);
                        } else {
                            debug("[CommentsMigrator] Legacy file-comments.json is empty array, deleting");
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

            // Ensure subsequent checks don't re-parse the old on-disk content.
            CommentsMigrator.clearNeedsMigrationCache(workspaceUri);

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

        // DO NOT sort comments - preserve existing order to minimize git diffs
        return Array.from(commentMap.values());
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
            debug("[CommentsMigrator] Failed to parse thread title date:", threadTitle, error);
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
            debug("[CommentsMigrator] Could not convert to relative path:", uri);
            return uri;
        } catch (error) {
            debug("[CommentsMigrator] Error converting to relative path:", uri, error);
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
            if (await CommentsMigrator.fileExists(legacyFilePath)) {
                return true;
            }

            // Check if comments.json exists and needs structural migration
            const commentsFilePath = vscode.Uri.joinPath(workspaceUri, ".project", "comments.json");
            try {
                const stat = await vscode.workspace.fs.stat(commentsFilePath);
                const statKey = `${stat.mtime}:${stat.size}`;

                const cacheKey = workspaceUri.fsPath;
                const cached = CommentsMigrator.needsMigrationCache.get(cacheKey);
                if (cached && cached.commentsStatKey === statKey) {
                    return cached.result;
                }

                const fileContent = await vscode.workspace.fs.readFile(commentsFilePath);
                const comments = JSON.parse(new TextDecoder().decode(fileContent));
                const result = CommentsMigrator.needsStructuralMigration(comments);
                CommentsMigrator.needsMigrationCache.set(cacheKey, { commentsStatKey: statKey, result });
                return result;
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

        console.log(`[CommentsMigrator] Checking ${comments.length} threads for migration needs`);

        const needsMigration = comments.some(thread => {
            // Check for old thread structure or missing new fields
            if (thread.version !== undefined ||
                thread.uri !== undefined ||
                thread.deleted !== undefined ||    // Old boolean field - should be deletionEvent array
                thread.resolved !== undefined ||  // Old boolean field - should be resolvedEvent array
                thread.deletionEvent === undefined ||  // Missing new array field
                thread.resolvedEvent === undefined || // Missing new array field
                (thread.cellId?.uri && (thread.cellId.uri.includes('%') || thread.cellId.uri.startsWith('file://')))) {
                return true;
            }

            // ===== CHECK FOR OLD CELL IDs =====
            // Check if cellId is in old format (not UUID)
            if (thread.cellId?.cellId && typeof thread.cellId.cellId === 'string') {
                // Quick check: UUIDs have dashes, old format like "LUK 1:1" has spaces
                if (thread.cellId.cellId.includes(' ')) {
                    console.log(`[CommentsMigrator] Found old-format cell ID: "${thread.cellId.cellId}" in thread ${thread.id}`);
                    return true;
                }
            }
            // ===== END CELL ID CHECK =====


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
        console.warn("Arried at the migrateCommentsStructure function! XXXXXXXXXXXXXXXXXXXXXXX");
        if (!Array.isArray(comments)) {
            return [];
        }

        return Promise.all(comments.map(async thread => {
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
            if (result.comments && Array.isArray(result.comments)) {
                result.comments = result.comments.map((comment: any, index: number) => {
                    delete comment.contextValue; // Remove legacy contextValue
                    return CommentsMigrator.migrateComment(comment, thread.threadTitle, index);
                });
            }
            // ============= END MIGRATION CLEANUP =============


            // ============= COMMENTS CELL ID POINTER MIGRATION =============
            result = await CommentsMigrator.migrateCellIdToUuid(result);
            // ============= END COMMENTS CELL ID POINTER MIGRATION =============


            // ============= DATA INTEGRITY REPAIR =============
            // Repair corrupted comment event data automatically
            result = CommentsMigrator.repairCommentThreadData(result);
            // ============= END DATA INTEGRITY REPAIR =============

            // Convert URIs to relative paths
            result = CommentsMigrator.convertThreadToRelativePaths(result);

            return result;
        }));
    }

    private static async migrateCellIdToUuid(thread: any): Promise<any> {
        const { generateCellIdFromHash, isUuidFormat } = await import("./uuidUtils");

        const result = { ...thread };

        if (Date.now() < COMMENTS_CELL_ID_MIGRATION_CUTOFF_DATE.getTime()) {
            // Before cutoff - migrate if needed
            if (result.cellId?.cellId && !isUuidFormat(result.cellId.cellId)) {
                const oldId = result.cellId.cellId;
                const newUuid = await generateCellIdFromHash(oldId);

                debug(`Migrating cell ID: "${oldId}" → "${newUuid}"`);

                result.cellId = {
                    ...result.cellId,
                    cellId: newUuid,
                    globalReferences: result.cellId.globalReferences || [oldId]
                };
            }
        } else {
            // Migration period has passed - show warning
            console.warn(
                "[CommentsMigrator] Cell ID migration cutoff date has passed!" + " (" +
                COMMENTS_CELL_ID_MIGRATION_CUTOFF_DATE.toISOString() + ") " +
                "This migration code should be removed if all users have updated."
            );
        }

        return result;
    }

    /**
     * Repairs corrupted comment thread data by:
     * 1. Normalizing property names (valid -> resolved)
     * 2. Removing duplicate events
     * 3. Adding missing required properties
     * 4. Validating event structure
     */
    private static repairCommentThreadData(thread: any): any {
        if (!thread) return thread;

        const threadId = thread.id || 'unknown';

        // Repair resolved events
        if (thread.resolvedEvent && Array.isArray(thread.resolvedEvent)) {
            const repairedEvents = CommentsMigrator.repairEventArray(thread.resolvedEvent, 'resolved', threadId);
            thread.resolvedEvent = repairedEvents.events;
        }

        // Repair deletion events
        if (thread.deletionEvent && Array.isArray(thread.deletionEvent)) {
            const repairedEvents = CommentsMigrator.repairEventArray(thread.deletionEvent, 'deletion', threadId);
            thread.deletionEvent = repairedEvents.events;
        }

        return thread;
    }

    /**
     * Repairs an array of comment events (resolvedEvent or deletionEvent)
     */
    private static repairEventArray(events: any[], eventType: 'resolved' | 'deletion', threadId: string): {
        events: any[];
        eventsRepaired: number;
        duplicatesRemoved: number;
        normalizedProperties: number;
    } {
        const result = {
            events: [] as any[],
            eventsRepaired: 0,
            duplicatesRemoved: 0,
            normalizedProperties: 0
        };

        const seen = new Set<string>();

        for (const event of events) {
            try {
                const repairedEvent = CommentsMigrator.repairEvent(event, eventType);

                if (repairedEvent.wasRepaired) {
                    result.eventsRepaired++;
                }
                if (repairedEvent.wasNormalized) {
                    result.normalizedProperties++;
                }

                // Check for duplicates using the same logic as merge resolvers
                const booleanState = eventType === 'deletion' ? repairedEvent.event.deleted : repairedEvent.event.resolved;
                const key = `${repairedEvent.event.timestamp}-${repairedEvent.event.author?.name || 'unknown'}-${booleanState}`;

                if (seen.has(key)) {
                    result.duplicatesRemoved++;
                    continue; // Skip duplicate
                }

                seen.add(key);
                result.events.push(repairedEvent.event);

            } catch (error) {
                console.warn(`[CommentsMigrator] Error repairing event in thread ${threadId}:`, error);
                result.eventsRepaired++;
            }
        }

        // Sort by timestamp for consistency
        result.events.sort((a, b) => a.timestamp - b.timestamp);

        return result;
    }

    /**
     * Repairs a single comment event
     */
    private static repairEvent(event: any, eventType: 'resolved' | 'deletion'): {
        event: any;
        wasRepaired: boolean;
        wasNormalized: boolean;
    } {
        const repairedEvent = { ...event };
        let wasRepaired = false;
        let wasNormalized = false;

        // Ensure timestamp exists and is valid
        if (!repairedEvent.timestamp || typeof repairedEvent.timestamp !== 'number') {
            repairedEvent.timestamp = Date.now();
            wasRepaired = true;
        }

        // Ensure author exists
        if (!repairedEvent.author || typeof repairedEvent.author.name !== 'string') {
            if (!repairedEvent.author) {
                repairedEvent.author = { name: 'unknown' };
            } else {
                repairedEvent.author.name = 'unknown';
            }
            wasRepaired = true;
        }

        // Handle event-specific properties
        if (eventType === 'resolved') {
            // Convert 'valid' to 'resolved' if it exists
            if ('valid' in repairedEvent && !('resolved' in repairedEvent)) {
                repairedEvent.resolved = repairedEvent.valid;
                delete repairedEvent.valid;
                wasNormalized = true;
            }
            // Set default resolved state if missing or invalid (safer to default to false)
            if (!('resolved' in repairedEvent) || typeof repairedEvent.resolved !== 'boolean') {
                repairedEvent.resolved = false;
                wasRepaired = true;
            }
        }

        if (eventType === 'deletion') {
            // Set default deleted state if missing or invalid (safer to default to false)
            if (!('deleted' in repairedEvent) || typeof repairedEvent.deleted !== 'boolean') {
                repairedEvent.deleted = false;
                wasRepaired = true;
            }
        }

        return {
            event: repairedEvent,
            wasRepaired,
            wasNormalized
        };
    }

    /**
 * Repairs corrupted data in an existing comments.json file
 * This runs during startup and migration to ensure data integrity
 * 
 * @param commentsFilePath Path to the comments.json file
 * @param forceRepair If true, skip the "recently modified" check (for startup/pre-sync scenarios)
 */
    static async repairExistingCommentsFile(commentsFilePath: vscode.Uri, forceRepair: boolean = false): Promise<void> {
        try {
            // Check if file was modified recently (within last 10 minutes) - don't repair if actively being edited
            // Skip this check if forceRepair is true (for startup/pre-sync scenarios)
            if (!forceRepair) {
                try {
                    const fileStat = await vscode.workspace.fs.stat(commentsFilePath);
                    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
                    if (fileStat.mtime > tenMinutesAgo) {
                        debug('[CommentsMigrator] Skipping repair - file was recently modified (may be actively edited)');
                        return;
                    }
                } catch (error) {
                    // File doesn't exist, nothing to repair
                    return;
                }
            }

            debug('[CommentsMigrator] Checking for corrupted comment data...');

            // Check if file exists before trying to read it
            try {
                await vscode.workspace.fs.stat(commentsFilePath);
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    // File doesn't exist, nothing to repair
                    return;
                } else {
                    throw error;
                }
            }

            // Read existing comments file
            const fileContent = await vscode.workspace.fs.readFile(commentsFilePath);
            let comments: any[];

            try {
                comments = JSON.parse(new TextDecoder().decode(fileContent));
            } catch (parseError) {
                console.error('[CommentsMigrator] Invalid JSON in comments file, skipping repair:', parseError);
                return;
            }

            if (!Array.isArray(comments)) {
                console.warn('[CommentsMigrator] Comments file does not contain an array, skipping repair');
                return;
            }

            let totalRepairedThreads = 0;
            let totalDuplicatesRemoved = 0;
            let totalPropertiesNormalized = 0;
            let totalEventsRepaired = 0;

            // Repair each thread
            for (let i = 0; i < comments.length; i++) {
                const thread = comments[i];
                const threadId = thread.id || `thread-${i}`;
                let threadRepaired = false;

                // Repair resolved events
                if (thread.resolvedEvent && Array.isArray(thread.resolvedEvent)) {
                    const originalCount = thread.resolvedEvent.length;
                    const repairedEvents = CommentsMigrator.repairEventArray(thread.resolvedEvent, 'resolved', threadId);
                    thread.resolvedEvent = repairedEvents.events;

                    if (repairedEvents.duplicatesRemoved > 0 || repairedEvents.normalizedProperties > 0 || repairedEvents.eventsRepaired > 0) {
                        console.log(`[CommentsMigrator] Repaired thread ${threadId}: ${originalCount} → ${repairedEvents.events.length} resolved events (removed ${repairedEvents.duplicatesRemoved} duplicates, normalized ${repairedEvents.normalizedProperties} properties, repaired ${repairedEvents.eventsRepaired} events)`);
                        threadRepaired = true;
                        totalDuplicatesRemoved += repairedEvents.duplicatesRemoved;
                        totalPropertiesNormalized += repairedEvents.normalizedProperties;
                        totalEventsRepaired += repairedEvents.eventsRepaired;
                    }
                }

                // Repair deletion events
                if (thread.deletionEvent && Array.isArray(thread.deletionEvent)) {
                    const originalCount = thread.deletionEvent.length;
                    const repairedEvents = CommentsMigrator.repairEventArray(thread.deletionEvent, 'deletion', threadId);
                    thread.deletionEvent = repairedEvents.events;

                    if (repairedEvents.duplicatesRemoved > 0 || repairedEvents.eventsRepaired > 0) {
                        console.log(`[CommentsMigrator] Repaired thread ${threadId}: ${originalCount} → ${repairedEvents.events.length} deletion events (removed ${repairedEvents.duplicatesRemoved} duplicates, repaired ${repairedEvents.eventsRepaired} events)`);
                        threadRepaired = true;
                        totalDuplicatesRemoved += repairedEvents.duplicatesRemoved;
                        totalEventsRepaired += repairedEvents.eventsRepaired;
                    }
                }

                if (threadRepaired) {
                    totalRepairedThreads++;
                }
            }

            // Only write if repairs were made
            if (totalRepairedThreads > 0) {
                const repairedContent = CommentsMigrator.formatCommentsForStorage(comments);
                await vscode.workspace.fs.writeFile(commentsFilePath, new TextEncoder().encode(repairedContent));

                console.log(`[CommentsMigrator] ✅ Repaired corrupted comment data:`);
                console.log(`  - Threads repaired: ${totalRepairedThreads}`);
                console.log(`  - Duplicates removed: ${totalDuplicatesRemoved}`);
                console.log(`  - Properties normalized: ${totalPropertiesNormalized}`);
                console.log(`  - Events repaired: ${totalEventsRepaired}`);
            } else {
                debug('[CommentsMigrator] ✅ No corrupted data found - comments file is clean');
            }

        } catch (error) {
            console.error('[CommentsMigrator] Error during comment data repair:', error);
            // Don't throw - we don't want to break the comments webview if repair fails
        }
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
            debug("[CommentsMigrator] Error checking source control status:", error);
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