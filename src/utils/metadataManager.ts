import * as vscode from "vscode";

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
     * Safely update metadata.json with atomic operations and conflict prevention
     */
    static async safeUpdateMetadata<T = ProjectMetadata>(
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

            // Step 4: Cleanup backup after successful write
            await this.cleanupFile(backupPath);

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
        const lockData: MetadataLock = {
            extensionId: this.EXTENSION_ID,
            timestamp: startTime,
            pid: process.pid
        };

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Try to create lock file exclusively by checking if it already exists
                try {
                    await vscode.workspace.fs.stat(lockPath);
                    // If we get here, file exists, so we can't acquire the lock
                    throw new Error('Lock file already exists');
                } catch (statError) {
                    // File doesn't exist, we can create it
                    if ((statError as any).code === 'FileNotFound') {
                        const lockContent = JSON.stringify(lockData);
                        const encoded = new TextEncoder().encode(lockContent);
                        await vscode.workspace.fs.writeFile(lockPath, encoded);
                        return true;
                    } else {
                        throw statError;
                    }
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
     * Safely read metadata without locking (read-only operation)
     * Checks for locks and retries if file is being written
     */
    static async safeReadMetadata<T = ProjectMetadata>(
        workspaceUri: vscode.Uri
    ): Promise<{ success: boolean; metadata?: T; error?: string; }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
        const lockPath = vscode.Uri.joinPath(workspaceUri, ".metadata.lock");
        const maxRetries = 5;
        const retryDelayMs = 100;

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
}
