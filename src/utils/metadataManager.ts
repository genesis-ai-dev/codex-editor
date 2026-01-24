import * as vscode from "vscode";
import { addProjectMetadataEdit } from "./editMapUtils";

/**
 * Thread-safe metadata manager that prevents conflicts between extensions
 * when modifying metadata.json files.
 */

interface MetadataLock {
    extensionId: string;
    timestamp: number;
    pid: number;
}

interface ProjectMetadata {
    meta?: {
        requiredExtensions?: {
            codexEditor?: string;
            frontierAuthentication?: string;
        };
        [key: string]: unknown;
    };
    edits?: any[];
    chatSystemMessage?: string;
    [key: string]: unknown;
}

interface MetadataUpdateOptions {
    retryCount?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    author?: string;
}

export class MetadataManager {
    private static readonly LOCK_TIMEOUT_MS = 30000; // 30 seconds
    private static readonly MAX_RETRIES = 5;
    private static readonly RETRY_DELAY_MS = 100;
    private static readonly EXTENSION_ID = "project-accelerate.codex-editor-extension";
    
    /**
     * Track pending write operations to ensure they complete before critical operations
     * Key: workspace path, Value: Set of promises for pending writes
     */
    private static pendingWrites = new Map<string, Set<Promise<any>>>();

    /**
     * Register a pending write operation
     * This can be called by other modules to track their write operations
     */
    static registerPendingWrite(workspacePath: string, writePromise: Promise<any>): void {
        if (!this.pendingWrites.has(workspacePath)) {
            this.pendingWrites.set(workspacePath, new Set());
        }
        const writes = this.pendingWrites.get(workspacePath)!;
        writes.add(writePromise);
        
        // Auto-cleanup when the write completes
        writePromise.finally(() => {
            writes.delete(writePromise);
            if (writes.size === 0) {
                this.pendingWrites.delete(workspacePath);
            }
        });
    }

    /**
     * Wait for all pending write operations to complete for a given workspace
     * Call this before switching folders or closing a project
     * @param workspacePath - The workspace path to wait for (optional, waits for all if not provided)
     * @param timeoutMs - Maximum time to wait (default 10 seconds)
     */
    static async waitForPendingWrites(workspacePath?: string, timeoutMs: number = 10000): Promise<void> {
        const startTime = Date.now();
        
        const getRelevantWrites = () => {
            if (workspacePath) {
                const writes = this.pendingWrites.get(workspacePath);
                return writes ? Array.from(writes) : [];
            }
            // Wait for all pending writes across all workspaces
            const allWrites: Promise<any>[] = [];
            for (const writes of this.pendingWrites.values()) {
                allWrites.push(...writes);
            }
            return allWrites;
        };

        let writes = getRelevantWrites();
        while (writes.length > 0) {
            if (Date.now() - startTime > timeoutMs) {
                console.warn(`[MetadataManager] Timeout waiting for ${writes.length} pending write(s)`);
                break;
            }
            
            try {
                await Promise.race([
                    Promise.allSettled(writes),
                    this.sleep(100) // Check periodically for new writes
                ]);
            } catch {
                // Continue waiting even if individual writes fail
            }
            
            writes = getRelevantWrites();
        }
    }

    /**
     * Check if there are any pending writes for a workspace
     */
    static hasPendingWrites(workspacePath?: string): boolean {
        if (workspacePath) {
            const writes = this.pendingWrites.get(workspacePath);
            return writes ? writes.size > 0 : false;
        }
        return this.pendingWrites.size > 0;
    }

    /**
     * Safely update metadata.json with atomic operations and conflict prevention
     */
    static async safeUpdateMetadata<T = ProjectMetadata>(
        workspaceUri: vscode.Uri,
        updateFunction: (metadata: T) => T | Promise<T>,
        options: MetadataUpdateOptions = {}
    ): Promise<{ success: boolean; metadata?: T; error?: string; }> {
        // Create a promise that will be resolved when the update completes
        // This allows waitForPendingWrites to track this operation
        const updatePromise = this.safeUpdateMetadataInternal<T>(workspaceUri, updateFunction, options);
        
        // Register this write operation
        this.registerPendingWrite(workspaceUri.fsPath, updatePromise);
        
        return updatePromise;
    }

    /**
     * Internal implementation of safeUpdateMetadata
     */
    private static async safeUpdateMetadataInternal<T = ProjectMetadata>(
        workspaceUri: vscode.Uri,
        updateFunction: (metadata: T) => T | Promise<T>,
        options: MetadataUpdateOptions = {}
    ): Promise<{ success: boolean; metadata?: T; error?: string; }> {
        const {
            retryCount = this.MAX_RETRIES,
            retryDelayMs = this.RETRY_DELAY_MS,
            timeoutMs = this.LOCK_TIMEOUT_MS
        } = options;

        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
        const lockPath = vscode.Uri.joinPath(workspaceUri, ".metadata.lock");

        for (let attempt = 0; attempt < retryCount; attempt++) {
            try {
                // Step 1: Acquire lock
                const lockAcquired = await this.acquireLock(lockPath, timeoutMs);
                if (!lockAcquired) {
                    if (attempt === retryCount - 1) {
                        return { success: false, error: "Failed to acquire metadata lock after all retries" };
                    }
                    await this.sleep(retryDelayMs * (attempt + 1)); // Exponential backoff
                    continue;
                }

                try {
                    // Step 2: Read current metadata with conflict detection
                    const readResult = await this.safeReadMetadataInternal<T>(metadataPath);
                    if (!readResult.success) {
                        return { success: false, error: readResult.error };
                    }

                    // Step 3: Apply updates
                    const originalMetadata = readResult.metadata!;
                    // Ensure edits array exists if author is provided
                    if (options.author && originalMetadata && typeof originalMetadata === 'object') {
                        const metadataObj = originalMetadata as any;
                        if (!metadataObj.edits) {
                            metadataObj.edits = [];
                        }
                    }
                    const updatedMetadata = await updateFunction(originalMetadata);

                    // Step 4: Write back with atomic operation
                    const writeResult = await this.atomicWriteMetadata(metadataPath, updatedMetadata);
                    if (!writeResult.success) {
                        return { success: false, error: writeResult.error };
                    }

                    return { success: true, metadata: updatedMetadata };

                } finally {
                    // Step 5: Always release lock
                    await this.releaseLock(lockPath);
                }

            } catch (error) {
                console.warn(`[MetadataManager] Attempt ${attempt + 1} failed:`, error);
                if (attempt === retryCount - 1) {
                    return {
                        success: false,
                        error: `All ${retryCount} attempts failed. Last error: ${(error as Error).message}`
                    };
                }
                await this.sleep(retryDelayMs * (attempt + 1));
            }
        }

        return { success: false, error: "Unexpected error in metadata update" };
    }

    /**
     * Safely read metadata with validation (private method for internal use)
     */
    private static async safeReadMetadataInternal<T>(
        metadataPath: vscode.Uri
    ): Promise<{ success: boolean; metadata?: T; error?: string; }> {
        try {
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const text = new TextDecoder().decode(content);

            // Validate JSON structure
            let metadata: T;
            try {
                metadata = JSON.parse(text);
            } catch (parseError) {
                return {
                    success: false,
                    error: `Invalid JSON in metadata.json: ${(parseError as Error).message}`
                };
            }

            return { success: true, metadata };

        } catch (error) {
            if ((error as any).code === 'FileNotFound') {
                // Create empty metadata if file doesn't exist
                const emptyMetadata = {} as T;
                return { success: true, metadata: emptyMetadata };
            }
            return {
                success: false,
                error: `Failed to read metadata.json: ${(error as Error).message}`
            };
        }
    }

    /**
     * Ensure metadata.json integrity before critical operations (like folder switches)
     * This validates that metadata.json exists, is valid, and cleans up any orphaned temp files.
     * Call this before operations that might interrupt ongoing writes (e.g., vscode.openFolder).
     */
    static async ensureMetadataIntegrity(workspaceUri: vscode.Uri): Promise<{ success: boolean; recovered?: boolean; error?: string; }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
        const backupPath = vscode.Uri.joinPath(workspaceUri, ".metadata.json.backup");

        try {
            // First, cleanup any orphaned temp files
            await this.cleanupOrphanedTempFiles(workspaceUri);

            // Check if metadata.json exists and is valid
            try {
                const content = await vscode.workspace.fs.readFile(metadataPath);
                const text = new TextDecoder().decode(content);
                
                if (!text.trim()) {
                    throw new Error("File is empty");
                }
                
                JSON.parse(text); // Validate JSON
                return { success: true, recovered: false };
            } catch {
                // metadata.json is missing or invalid - try recovery
                const recovered = await this.recoverMetadataFromTempFiles(workspaceUri, metadataPath, backupPath);
                if (recovered) {
                    console.log("[MetadataManager] Recovered metadata.json during integrity check");
                    return { success: true, recovered: true };
                }
                return { 
                    success: false, 
                    error: "metadata.json is missing or corrupted and could not be recovered" 
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Integrity check failed: ${(error as Error).message}`
            };
        }
    }

    /**
     * Safely open a folder, ensuring metadata integrity in the current workspace first.
     * This is a wrapper around vscode.openFolder that ensures any pending metadata writes
     * are completed before switching folders.
     * 
     * @param targetUri - The folder to open
     * @param currentWorkspaceUri - Optional current workspace Uri to check integrity on
     * @param newWindow - Whether to open in new window (default: false for same window)
     */
    static async safeOpenFolder(
        targetUri: vscode.Uri,
        currentWorkspaceUri?: vscode.Uri,
        newWindow: boolean = false
    ): Promise<void> {
        // CRITICAL: Wait for all pending write operations to complete before switching folders
        // This prevents interrupted atomic writes from leaving orphaned temp files
        if (currentWorkspaceUri) {
            if (this.hasPendingWrites(currentWorkspaceUri.fsPath)) {
                console.log("[MetadataManager] Waiting for pending writes before folder switch...");
                await this.waitForPendingWrites(currentWorkspaceUri.fsPath, 10000);
            }
        } else {
            // Wait for ALL pending writes if no specific workspace provided
            if (this.hasPendingWrites()) {
                console.log("[MetadataManager] Waiting for all pending writes before folder switch...");
                await this.waitForPendingWrites(undefined, 10000);
            }
        }

        // If we have a current workspace, ensure its metadata integrity before switching
        if (currentWorkspaceUri) {
            try {
                const result = await this.ensureMetadataIntegrity(currentWorkspaceUri);
                if (!result.success) {
                    console.warn("[MetadataManager] Metadata integrity check failed before folder switch:", result.error);
                }
                if (result.recovered) {
                    console.log("[MetadataManager] Recovered metadata.json before folder switch");
                }
            } catch (error) {
                console.warn("[MetadataManager] Error during pre-switch integrity check:", error);
            }
        }

        // Also check the target folder if it's a Codex project
        try {
            const targetMetadataPath = vscode.Uri.joinPath(targetUri, "metadata.json");
            await vscode.workspace.fs.stat(targetMetadataPath);
            // Target has metadata.json, ensure its integrity
            const result = await this.ensureMetadataIntegrity(targetUri);
            if (!result.success) {
                console.warn("[MetadataManager] Target metadata integrity check failed:", result.error);
            }
            if (result.recovered) {
                console.log("[MetadataManager] Recovered metadata.json in target folder before opening");
            }
        } catch {
            // Target doesn't have metadata.json or we can't check - that's fine
        }

        // Now safely open the folder
        await vscode.commands.executeCommand("vscode.openFolder", targetUri, newWindow);
    }

    /**
     * Atomic write operation with backup and rollback
     */
    private static async atomicWriteMetadata<T>(
        metadataPath: vscode.Uri,
        metadata: T
    ): Promise<{ success: boolean; error?: string; }> {
        const workspaceUri = vscode.Uri.joinPath(metadataPath, "..");
        const backupPath = vscode.Uri.joinPath(workspaceUri, ".metadata.json.backup");

        try {
            // Step 1: Create backup of existing file
            try {
                const existingContent = await vscode.workspace.fs.readFile(metadataPath);
                await vscode.workspace.fs.writeFile(backupPath, existingContent);
            } catch (error) {
                // File might not exist, which is fine
                if ((error as any).code !== 'FileNotFound') {
                    console.warn("[MetadataManager] Failed to create backup:", error);
                }
            }

            // Step 2: Validate JSON before writing
            const jsonContent = JSON.stringify(metadata, null, 4);
            try {
                JSON.parse(jsonContent); // Validate JSON is valid
            } catch (parseError) {
                return {
                    success: false,
                    error: `Invalid JSON generated: ${(parseError as Error).message}`
                };
            }

            // Step 3: Write directly to metadata.json
            const encoded = new TextEncoder().encode(jsonContent);
            await vscode.workspace.fs.writeFile(metadataPath, encoded);

            // Step 4: Verify write was successful - VS Code may use internal atomic writes
            // that can leave orphaned temp files if interrupted
            const writeVerified = await this.verifyWriteSuccess(metadataPath, workspaceUri);
            if (!writeVerified) {
                // Attempt recovery from temp files
                const recovered = await this.recoverMetadataFromTempFiles(workspaceUri, metadataPath, backupPath);
                if (!recovered) {
                    return {
                        success: false,
                        error: "Write verification failed - metadata.json may not have been written correctly"
                    };
                }
                console.log("[MetadataManager] Recovered metadata.json after write verification failure");
            }

            // Step 5: Cleanup backup after successful write
            await this.cleanupFile(backupPath);

            // Step 6: Cleanup any orphaned temp files from VS Code's internal atomic writes
            await this.cleanupOrphanedTempFiles(workspaceUri);

            return { success: true };

        } catch (error) {
            // Rollback on failure
            try {
                // Restore from backup if it exists
                const backupContent = await vscode.workspace.fs.readFile(backupPath);
                await vscode.workspace.fs.writeFile(metadataPath, backupContent);
                await this.cleanupFile(backupPath);
                console.log("[MetadataManager] Successfully restored from backup");
            } catch (restoreError) {
                console.warn("[MetadataManager] Failed to restore from backup:", restoreError);
            }

            return {
                success: false,
                error: `Failed to write metadata: ${(error as Error).message}`
            };
        }
    }

    /**
     * Acquire exclusive lock on metadata file
     */
    private static async acquireLock(
        lockPath: vscode.Uri,
        timeoutMs: number
    ): Promise<boolean> {
        const startTime = Date.now();
        const uniqueId = `${Math.random().toString(36).substring(2, 9)}`;
        const lockData: MetadataLock = {
            extensionId: this.EXTENSION_ID,
            timestamp: startTime,
            pid: process.pid
        };

        // Use a unique temp file for atomic locking
        const tempLockPath = lockPath.with({ path: lockPath.path + `.${uniqueId}.tmp` });

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Try to create lock file exclusively using atomic rename strategy
                // 1. Write to unique temp file
                const lockContent = JSON.stringify(lockData);
                const encoded = new TextEncoder().encode(lockContent);
                await vscode.workspace.fs.writeFile(tempLockPath, encoded);

                // 2. Try to rename temp to lock (fails if lock exists)
                try {
                    await vscode.workspace.fs.rename(tempLockPath, lockPath, { overwrite: false });
                    return true;
                } catch (renameError: any) {
                    // Rename failed (likely lock exists), clean up temp file
                    await this.cleanupFile(tempLockPath);
                    
                    if (renameError.code !== 'EntryExists' && renameError.code !== 'FileExists') {
                        console.warn(`[MetadataManager] Atomic rename failed: ${renameError.message}`);
                    }
                    throw new Error('Lock file already exists');
                }

            } catch (error) {
                // Lock exists, check if it's stale
                try {
                    const existingContent = await vscode.workspace.fs.readFile(lockPath);
                    const existingLock: MetadataLock = JSON.parse(new TextDecoder().decode(existingContent));

                    // Check if lock is stale (older than timeout)
                    if (Date.now() - existingLock.timestamp > this.LOCK_TIMEOUT_MS) {
                        console.log(`[MetadataManager] Removing stale lock from ${existingLock.extensionId}`);
                        await this.cleanupFile(lockPath);
                        continue; // Try to acquire again
                    }

                } catch (lockReadError) {
                    // Corrupted lock file, remove it
                    console.warn("[MetadataManager] Removing corrupted lock file");
                    await this.cleanupFile(lockPath);
                    continue;
                }

                // Wait a bit before retrying
                await this.sleep(50);
            }
        }

        return false;
    }

    /**
     * Release the metadata lock
     */
    private static async releaseLock(lockPath: vscode.Uri): Promise<void> {
        await this.cleanupFile(lockPath);
    }

    /**
     * Utility to safely delete a file
     */
    private static async cleanupFile(filePath: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.delete(filePath);
        } catch (error) {
            // File might not exist, which is fine
            if ((error as any).code !== 'FileNotFound') {
                console.warn(`[MetadataManager] Failed to cleanup file ${filePath.fsPath}:`, error);
            }
        }
    }

    /**
     * Utility sleep function
     */
    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Convenience method specifically for extension version updates
     */
    static async updateExtensionVersions(
        workspaceUri: vscode.Uri,
        versions: {
            codexEditor?: string;
            frontierAuthentication?: string;
        }
    ): Promise<{ success: boolean; error?: string; }> {
        const result = await this.safeUpdateMetadata<ProjectMetadata>(
            workspaceUri,
            (metadata) => {
                // Ensure meta section exists
                if (!metadata.meta) {
                    metadata.meta = {};
                }

                // Ensure requiredExtensions section exists
                if (!metadata.meta.requiredExtensions) {
                    metadata.meta.requiredExtensions = {};
                }

                // Update only the provided versions
                if (versions.codexEditor !== undefined) {
                    metadata.meta.requiredExtensions.codexEditor = versions.codexEditor;
                }
                if (versions.frontierAuthentication !== undefined) {
                    metadata.meta.requiredExtensions.frontierAuthentication = versions.frontierAuthentication;
                }

                return metadata;
            }
        );

        return { success: result.success, error: result.error };
    }

    /**
     * Convenience method to read current extension versions
     */
    static async getExtensionVersions(
        workspaceUri: vscode.Uri
    ): Promise<{
        success: boolean;
        versions?: { codexEditor?: string; frontierAuthentication?: string; };
        error?: string;
    }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
        const result = await this.safeReadMetadataInternal<ProjectMetadata>(metadataPath);

        if (!result.success) {
            return { success: false, error: result.error };
        }

        const versions = result.metadata?.meta?.requiredExtensions || {};
        return {
            success: true,
            versions: {
                codexEditor: versions.codexEditor,
                frontierAuthentication: versions.frontierAuthentication
            }
        };
    }

    /**
     * Get the current extension version from VS Code
     */
    static getCurrentExtensionVersion(extensionId: string): string {
        const extension = vscode.extensions.getExtension(extensionId);
        return extension?.packageJSON.version || "unknown";
    }

    /**
     * Get chatSystemMessage from metadata.json
     */
    static async getChatSystemMessage(workspaceFolderUri?: vscode.Uri): Promise<string> {
        const workspaceFolder = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            // Can't generate without a workspace folder to save to
            return "This is a chat between a helpful Bible translation assistant and a Bible translator...";
        }

        const result = await this.safeReadMetadata<ProjectMetadata>(workspaceFolder);

        // If metadata.json exists and has chatSystemMessage, return it
        if (result.success && result.metadata) {
            const chatSystemMessage = (result.metadata as any).chatSystemMessage as string | undefined;
            if (chatSystemMessage) {
                return chatSystemMessage;
            }
        }

        // Try to generate chatSystemMessage if it doesn't exist
        // First try to get languages from metadata.json if it exists
        let sourceLanguage: { refName: string; } | undefined;
        let targetLanguage: { refName: string; } | undefined;

        if (result.success && result.metadata) {
            const metadata = result.metadata as any;
            sourceLanguage = metadata.languages?.find(
                (l: any) => l.projectStatus === "source"
            );
            targetLanguage = metadata.languages?.find(
                (l: any) => l.projectStatus === "target"
            );
        }

        // If languages not found in metadata.json, try workspace configuration
        if (!sourceLanguage || !targetLanguage) {
            try {
                const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
                const configSourceLanguage = projectConfig.get("sourceLanguage") as { refName: string; } | undefined;
                const configTargetLanguage = projectConfig.get("targetLanguage") as { refName: string; } | undefined;

                if (configSourceLanguage?.refName) {
                    sourceLanguage = configSourceLanguage;
                }
                if (configTargetLanguage?.refName) {
                    targetLanguage = configTargetLanguage;
                }
            } catch (error) {
                console.debug("[MetadataManager] Error reading languages from workspace config:", error);
            }
        }

        // Generate chatSystemMessage if we have both languages
        if (sourceLanguage?.refName && targetLanguage?.refName) {
            try {
                const { generateChatSystemMessage } = await import("../copilotSettings/copilotSettings");
                const generatedValue = await generateChatSystemMessage(
                    sourceLanguage,
                    targetLanguage,
                    workspaceFolder
                );

                if (generatedValue) {
                    // Save the generated value to metadata.json (will create it if it doesn't exist)
                    const saveResult = await this.setChatSystemMessage(generatedValue, workspaceFolder);
                    if (saveResult.success) {
                        return generatedValue;
                    }
                }
            } catch (error) {
                // Don't fail if generation fails - just log and continue to default
                console.debug("[MetadataManager] Error attempting to generate chatSystemMessage:", error);
            }
        }

        // Fallback to default message
        return "This is a chat between a helpful Bible translation assistant and a Bible translator...";
    }

    /**
     * Set chatSystemMessage in metadata.json with edit tracking
     */
    static async setChatSystemMessage(
        value: string,
        workspaceFolderUri?: vscode.Uri,
        author?: string
    ): Promise<{ success: boolean; error?: string; }> {
        const workspaceFolder = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            return { success: false, error: "No workspace folder found" };
        }

        // Get author if not provided
        let currentAuthor = author;
        if (!currentAuthor) {
            try {
                const { getAuthApi } = await import("../extension");
                const authApi = await getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                if (userInfo?.username) {
                    currentAuthor = userInfo.username;
                }
            } catch (error) {
                // Silent fallback
            }
            currentAuthor = currentAuthor || "unknown";
        }

        const result = await this.safeUpdateMetadata<ProjectMetadata>(
            workspaceFolder,
            (metadata) => {
                const originalChatSystemMessage = (metadata as any).chatSystemMessage;

                // Update the value
                (metadata as any).chatSystemMessage = value;

                // Track edit if value changed
                if (originalChatSystemMessage !== value) {
                    if (!metadata.edits) {
                        metadata.edits = [];
                    }
                    addProjectMetadataEdit(metadata, ["chatSystemMessage"], value, currentAuthor);
                }

                return metadata;
            },
            { author: currentAuthor }
        );

        return { success: result.success, error: result.error };
    }

    /**
     * Safely read metadata without locking (read-only operation)
     * Checks for locks and retries if file is being written
     * Also recovers from orphaned temp files if metadata.json is missing
     */
    static async safeReadMetadata<T = ProjectMetadata>(
        workspaceUri: vscode.Uri
    ): Promise<{ success: boolean; metadata?: T; error?: string; }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
        const lockPath = vscode.Uri.joinPath(workspaceUri, ".metadata.lock");
        const backupPath = vscode.Uri.joinPath(workspaceUri, ".metadata.json.backup");
        const maxRetries = 5;
        const retryDelayMs = 100;

        // First, check if metadata.json exists - if not, try to recover from temp files or backup
        try {
            await vscode.workspace.fs.stat(metadataPath);
        } catch {
            // metadata.json doesn't exist - try to recover
            const recovered = await this.recoverMetadataFromTempFiles(workspaceUri, metadataPath, backupPath);
            if (!recovered) {
                return {
                    success: false,
                    error: "metadata.json not found and no recovery possible"
                };
            }
            console.log("[MetadataManager] Successfully recovered metadata.json from temp/backup files");
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Check if lock exists - if so, wait and retry
                try {
                    await vscode.workspace.fs.stat(lockPath);
                    // Lock exists, wait and retry
                    if (attempt < maxRetries - 1) {
                        await this.sleep(retryDelayMs * (attempt + 1));
                        continue;
                    }
                } catch (lockError) {
                    // Lock doesn't exist, proceed with read
                    if ((lockError as any).code !== 'FileNotFound') {
                        // Unexpected error checking lock, but continue anyway
                    }
                }

                const content = await vscode.workspace.fs.readFile(metadataPath);
                const text = new TextDecoder().decode(content);

                // Check for empty file (which would cause "Unexpected end of JSON input")
                if (!text.trim()) {
                    // File is empty, check if lock exists and retry
                    try {
                        await vscode.workspace.fs.stat(lockPath);
                        // Lock exists, file is being written, retry
                        if (attempt < maxRetries - 1) {
                            await this.sleep(retryDelayMs * (attempt + 1));
                            continue;
                        }
                    } catch {
                        // Lock doesn't exist, file is genuinely empty
                    }
                    return {
                        success: false,
                        error: `Invalid JSON in metadata.json: File is empty`
                    };
                }

                // Validate JSON structure
                let metadata: T;
                try {
                    metadata = JSON.parse(text);
                } catch (parseError) {
                    // Invalid JSON - check if lock exists (file might be mid-write)
                    try {
                        await vscode.workspace.fs.stat(lockPath);
                        // Lock exists, file is being written, retry
                        if (attempt < maxRetries - 1) {
                            await this.sleep(retryDelayMs * (attempt + 1));
                            continue;
                        }
                    } catch {
                        // Lock doesn't exist, JSON is genuinely invalid
                    }
                    return {
                        success: false,
                        error: `Invalid JSON in metadata.json: ${(parseError as Error).message}`
                    };
                }

                return { success: true, metadata };

            } catch (error) {
                if ((error as any).code === 'FileNotFound') {
                    // Create empty metadata if file doesn't exist
                    const emptyMetadata = {} as T;
                    return { success: true, metadata: emptyMetadata };
                }
                // For other errors, retry if lock exists
                try {
                    await vscode.workspace.fs.stat(lockPath);
                    if (attempt < maxRetries - 1) {
                        await this.sleep(retryDelayMs * (attempt + 1));
                        continue;
                    }
                } catch {
                    // Lock doesn't exist, return error
                }
                return {
                    success: false,
                    error: `Failed to read metadata.json: ${(error as Error).message}`
                };
            }
        }

        return {
            success: false,
            error: `Failed to read metadata.json after ${maxRetries} attempts (file may be locked)`
        };
    }

    /**
     * Verify that metadata.json was written successfully
     * VS Code's workspace.fs.writeFile may use internal atomic writes that can fail silently
     */
    private static async verifyWriteSuccess(
        metadataPath: vscode.Uri,
        workspaceUri: vscode.Uri
    ): Promise<boolean> {
        try {
            // Small delay to allow any async file system operations to complete
            await this.sleep(50);
            
            // Check if metadata.json exists and is readable
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const text = new TextDecoder().decode(content);
            
            // Verify it's valid JSON
            JSON.parse(text);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Cleanup any orphaned temp files from VS Code's internal atomic writes
     * Pattern: .metadata.json.<timestamp>-<random>.tmp
     */
    private static async cleanupOrphanedTempFiles(workspaceUri: vscode.Uri): Promise<void> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
            const tempFiles = entries.filter(([name, type]) => 
                type === vscode.FileType.File && 
                name.startsWith(".metadata.json.") && 
                name.endsWith(".tmp")
            );

            for (const [name] of tempFiles) {
                try {
                    const tempPath = vscode.Uri.joinPath(workspaceUri, name);
                    await this.cleanupFile(tempPath);
                    console.log(`[MetadataManager] Cleaned up orphaned temp file: ${name}`);
                } catch {
                    // Best effort cleanup
                }
            }

            // Also cleanup stale lock files (older than 30 seconds)
            const lockPath = vscode.Uri.joinPath(workspaceUri, ".metadata.lock");
            try {
                const lockContent = await vscode.workspace.fs.readFile(lockPath);
                const lockData = JSON.parse(new TextDecoder().decode(lockContent));
                if (lockData.timestamp && Date.now() - lockData.timestamp > 30000) {
                    await this.cleanupFile(lockPath);
                    console.log("[MetadataManager] Cleaned up stale lock file");
                }
            } catch {
                // Lock doesn't exist or can't be read - that's fine
            }

            // Cleanup orphaned backup file if metadata.json exists and is valid
            // This handles cases where backup cleanup failed after a successful write
            const backupPath = vscode.Uri.joinPath(workspaceUri, ".metadata.json.backup");
            try {
                // Only cleanup backup if metadata.json exists and is valid
                const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
                const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
                const metadataText = new TextDecoder().decode(metadataContent);
                JSON.parse(metadataText); // Validate JSON
                
                // metadata.json is valid, safe to delete backup
                await this.cleanupFile(backupPath);
                console.log("[MetadataManager] Cleaned up orphaned backup file");
            } catch {
                // Either metadata.json doesn't exist/invalid, or backup doesn't exist - that's fine
                // We don't want to delete the backup if metadata.json is missing (it might be needed for recovery)
            }
        } catch {
            // Best effort cleanup
        }
    }

    /**
     * Attempt to recover metadata.json from orphaned temp files or backup
     * This handles cases where atomic write was interrupted (e.g., VS Code folder switch)
     */
    private static async recoverMetadataFromTempFiles(
        workspaceUri: vscode.Uri,
        metadataPath: vscode.Uri,
        backupPath: vscode.Uri
    ): Promise<boolean> {
        try {
            // List files in the workspace directory to find orphaned temp files
            const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
            
            // Look for temp files matching pattern: .metadata.json.<timestamp>-<random>.tmp
            const tempFiles = entries
                .filter(([name, type]) => 
                    type === vscode.FileType.File && 
                    name.startsWith(".metadata.json.") && 
                    name.endsWith(".tmp")
                )
                .map(([name]) => ({
                    name,
                    path: vscode.Uri.joinPath(workspaceUri, name),
                    // Extract timestamp from filename for sorting
                    timestamp: parseInt(name.split(".")[2]?.split("-")[0] || "0", 10)
                }))
                .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

            // Try to recover from the most recent temp file
            for (const tempFile of tempFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(tempFile.path);
                    const text = new TextDecoder().decode(content);
                    
                    // Validate it's valid JSON
                    JSON.parse(text);
                    
                    // Valid JSON - copy to metadata.json
                    await vscode.workspace.fs.writeFile(metadataPath, content);
                    
                    // Cleanup temp file
                    await this.cleanupFile(tempFile.path);
                    
                    console.log(`[MetadataManager] Recovered metadata.json from ${tempFile.name}`);
                    return true;
                } catch {
                    // This temp file is invalid, try next one
                    console.warn(`[MetadataManager] Temp file ${tempFile.name} is invalid, trying next...`);
                }
            }

            // No valid temp files found, try backup
            try {
                const backupContent = await vscode.workspace.fs.readFile(backupPath);
                const text = new TextDecoder().decode(backupContent);
                
                // Validate it's valid JSON
                JSON.parse(text);
                
                // Valid backup - copy to metadata.json
                await vscode.workspace.fs.writeFile(metadataPath, backupContent);
                
                console.log("[MetadataManager] Recovered metadata.json from backup");
                return true;
            } catch {
                // Backup doesn't exist or is invalid
            }

            // Cleanup any orphaned temp files and lock file
            for (const tempFile of tempFiles) {
                await this.cleanupFile(tempFile.path);
            }
            const lockPath = vscode.Uri.joinPath(workspaceUri, ".metadata.lock");
            await this.cleanupFile(lockPath);

            return false;
        } catch (error) {
            console.error("[MetadataManager] Error during temp file recovery:", error);
            return false;
        }
    }
}
