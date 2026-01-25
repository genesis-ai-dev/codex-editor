import * as vscode from "vscode";
import { addProjectMetadataEdit } from "./editMapUtils";

/**
 * Simple metadata manager for reading and writing metadata.json.
 * 
 * DESIGN PRINCIPLES:
 * 1. Use direct writes like every other file in the codebase (no locks, backups, temp files)
 * 2. codex-editor is the SINGLE WRITER for metadata.json
 * 3. frontier-authentication delegates writes to codex-editor via commands
 * 4. This prevents the complexity that was causing metadata.json to be deleted
 */

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
    author?: string;
}

export class MetadataManager {
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
     */
    static async waitForPendingWrites(workspacePath?: string, timeoutMs: number = 10000): Promise<void> {
        const startTime = Date.now();

        const getRelevantWrites = () => {
            if (workspacePath) {
                const writes = this.pendingWrites.get(workspacePath);
                return writes ? Array.from(writes) : [];
            }
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
                    new Promise(resolve => setTimeout(resolve, 100))
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
     * Safely update metadata.json with DIRECT WRITES (like every other file)
     * No locks, no backups, no temp files - simple and reliable
     */
    static async safeUpdateMetadata<T = ProjectMetadata>(
        workspaceUri: vscode.Uri,
        updateFunction: (metadata: T) => T | Promise<T>,
        options: MetadataUpdateOptions = {}
    ): Promise<{ success: boolean; metadata?: T; error?: string }> {
        const updatePromise = this.safeUpdateMetadataInternal<T>(workspaceUri, updateFunction, options);
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
    ): Promise<{ success: boolean; metadata?: T; error?: string }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");

        try {
            // Step 1: Read current metadata
            const readResult = await this.safeReadMetadata<T>(workspaceUri);
            if (!readResult.success) {
                return { success: false, error: readResult.error };
            }

            // Step 2: Apply updates
            const originalMetadata = readResult.metadata!;
            if (options.author && originalMetadata && typeof originalMetadata === 'object') {
                const metadataObj = originalMetadata as any;
                if (!metadataObj.edits) {
                    metadataObj.edits = [];
                }
            }
            const updatedMetadata = await updateFunction(originalMetadata);

            // Step 3: Validate JSON before writing
            const jsonContent = JSON.stringify(updatedMetadata, null, 4);
            try {
                JSON.parse(jsonContent);
            } catch (parseError) {
                return {
                    success: false,
                    error: `Invalid JSON generated: ${(parseError as Error).message}`
                };
            }

            // Step 4: Direct write - simple, like every other file
            const encoded = new TextEncoder().encode(jsonContent);
            await vscode.workspace.fs.writeFile(metadataPath, encoded);

            return { success: true, metadata: updatedMetadata };

        } catch (error) {
            return {
                success: false,
                error: `Failed to update metadata: ${(error as Error).message}`
            };
        }
    }

    /**
     * Safely read metadata - simple read with validation
     */
    static async safeReadMetadata<T = ProjectMetadata>(
        workspaceUri: vscode.Uri
    ): Promise<{ success: boolean; metadata?: T; error?: string }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");

        try {
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const text = new TextDecoder().decode(content);

            if (!text.trim()) {
                return {
                    success: false,
                    error: "metadata.json is empty"
                };
            }

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
     * Safely open a folder, ensuring pending writes complete first
     */
    static async safeOpenFolder(
        targetUri: vscode.Uri,
        currentWorkspaceUri?: vscode.Uri,
        newWindow: boolean = false
    ): Promise<void> {
        // Wait for pending writes before switching
        if (currentWorkspaceUri) {
            if (this.hasPendingWrites(currentWorkspaceUri.fsPath)) {
                console.log("[MetadataManager] Waiting for pending writes before folder switch...");
                await this.waitForPendingWrites(currentWorkspaceUri.fsPath, 10000);
            }
        } else if (this.hasPendingWrites()) {
            console.log("[MetadataManager] Waiting for all pending writes before folder switch...");
            await this.waitForPendingWrites(undefined, 10000);
        }

        await vscode.commands.executeCommand("vscode.openFolder", targetUri, newWindow);
    }

    /**
     * Update extension versions in metadata.json
     * This is the main entry point for both codex-editor internal use
     * and for frontier-authentication (via command)
     */
    static async updateExtensionVersions(
        workspaceUri: vscode.Uri,
        versions: {
            codexEditor?: string;
            frontierAuthentication?: string;
        }
    ): Promise<{ success: boolean; error?: string }> {
        const result = await this.safeUpdateMetadata<ProjectMetadata>(
            workspaceUri,
            (metadata) => {
                if (!metadata.meta) {
                    metadata.meta = {};
                }
                if (!metadata.meta.requiredExtensions) {
                    metadata.meta.requiredExtensions = {};
                }

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
     * Read current extension versions from metadata.json
     */
    static async getExtensionVersions(
        workspaceUri: vscode.Uri
    ): Promise<{
        success: boolean;
        versions?: { codexEditor?: string; frontierAuthentication?: string };
        error?: string;
    }> {
        const result = await this.safeReadMetadata<ProjectMetadata>(workspaceUri);

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
            return "This is a chat between a helpful Bible translation assistant and a Bible translator...";
        }

        const result = await this.safeReadMetadata<ProjectMetadata>(workspaceFolder);

        if (result.success && result.metadata) {
            const chatSystemMessage = (result.metadata as any).chatSystemMessage as string | undefined;
            if (chatSystemMessage) {
                return chatSystemMessage;
            }
        }

        // Try to generate chatSystemMessage if it doesn't exist
        let sourceLanguage: { refName: string } | undefined;
        let targetLanguage: { refName: string } | undefined;

        if (result.success && result.metadata) {
            const metadata = result.metadata as any;
            sourceLanguage = metadata.languages?.find((l: any) => l.projectStatus === "source");
            targetLanguage = metadata.languages?.find((l: any) => l.projectStatus === "target");
        }

        if (!sourceLanguage || !targetLanguage) {
            try {
                const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
                const configSourceLanguage = projectConfig.get("sourceLanguage") as { refName: string } | undefined;
                const configTargetLanguage = projectConfig.get("targetLanguage") as { refName: string } | undefined;

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

        if (sourceLanguage?.refName && targetLanguage?.refName) {
            try {
                const { generateChatSystemMessage } = await import("../copilotSettings/copilotSettings");
                const generatedValue = await generateChatSystemMessage(
                    sourceLanguage,
                    targetLanguage,
                    workspaceFolder
                );

                if (generatedValue) {
                    const saveResult = await this.setChatSystemMessage(generatedValue, workspaceFolder);
                    if (saveResult.success) {
                        return generatedValue;
                    }
                }
            } catch (error) {
                console.debug("[MetadataManager] Error attempting to generate chatSystemMessage:", error);
            }
        }

        return "This is a chat between a helpful Bible translation assistant and a Bible translator...";
    }

    /**
     * Set chatSystemMessage in metadata.json with edit tracking
     */
    static async setChatSystemMessage(
        value: string,
        workspaceFolderUri?: vscode.Uri,
        author?: string
    ): Promise<{ success: boolean; error?: string }> {
        const workspaceFolder = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            return { success: false, error: "No workspace folder found" };
        }

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
                (metadata as any).chatSystemMessage = value;

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
     * Ensure metadata.json exists and is valid (simplified version)
     */
    static async ensureMetadataIntegrity(workspaceUri: vscode.Uri): Promise<{ success: boolean; recovered?: boolean; error?: string }> {
        const metadataPath = vscode.Uri.joinPath(workspaceUri, "metadata.json");

        try {
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const text = new TextDecoder().decode(content);

            if (!text.trim()) {
                return { success: false, error: "metadata.json is empty" };
            }

            JSON.parse(text);
            return { success: true, recovered: false };
        } catch (error) {
            if ((error as any).code === 'FileNotFound') {
                return { success: false, error: "metadata.json not found" };
            }
            return {
                success: false,
                error: `metadata.json is corrupted: ${(error as Error).message}`
            };
        }
    }
}

/**
 * Register commands that frontier-authentication can call to write to metadata.json
 * This implements the "single writer" principle - only codex-editor writes to metadata.json
 */
export function registerMetadataCommands(context: vscode.ExtensionContext): void {
    // Command for frontier-authentication to update extension versions
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.updateMetadataExtensionVersions",
            async (versions: { codexEditor?: string; frontierAuthentication?: string }): Promise<{ success: boolean; error?: string }> => {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return { success: false, error: "No workspace folder open" };
                }

                return MetadataManager.updateExtensionVersions(workspaceFolder.uri, versions);
            }
        )
    );

    // Command for frontier-authentication to read extension versions
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.getMetadataExtensionVersions",
            async (): Promise<{ success: boolean; versions?: { codexEditor?: string; frontierAuthentication?: string }; error?: string }> => {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return { success: false, error: "No workspace folder open" };
                }

                return MetadataManager.getExtensionVersions(workspaceFolder.uri);
            }
        )
    );
}
