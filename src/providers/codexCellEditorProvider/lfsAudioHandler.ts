import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { LFSHelper } from "../../utils/lfsUtils";
import { CodexCellDocument } from "./codexDocument";

/**
 * Enhanced audio attachment handler with LFS support
 */
export class LFSAudioHandler {

    /**
     * Save audio attachment with automatic LFS handling for large files
     */
    static async saveAudioAttachmentWithLFS(
        cellId: string,
        audioId: string,
        audioData: string,
        fileExtension: string,
        document: CodexCellDocument,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<{ success: boolean; isLFS: boolean; error?: string; }> {
        try {
            const documentSegment = cellId.split(' ')[0];

            // Create attachments directory
            const attachmentsDir = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                "attachments",
                documentSegment
            );
            await fs.promises.mkdir(attachmentsDir, { recursive: true });

            // Decode base64 audio data
            const base64Data = audioData.split(',')[1] || audioData;
            const buffer = Buffer.from(base64Data, 'base64');
            const audioBytes = new Uint8Array(buffer);

            // Determine file path
            const fileName = `${audioId}.${fileExtension}`;
            const relativePath = path.join(".project", "attachments", documentSegment, fileName);

            // Use LFS helper to add file (it will automatically determine if LFS should be used)
            const result = await LFSHelper.addFileWithLFS(
                workspaceFolder.uri,
                relativePath,
                audioBytes
            );

            if (!result.success) {
                return { success: false, isLFS: false, error: result.error };
            }

            // Update cell attachment metadata
            await document.updateCellAttachment(cellId, audioId, {
                url: relativePath,
                type: "audio",
                isLFS: result.isLFS // Add LFS flag to metadata
            });

            console.log(`[LFS] Audio attachment saved: ${fileName} (LFS: ${result.isLFS})`);
            return { success: true, isLFS: result.isLFS };

        } catch (error) {
            console.error("[LFS] Failed to save audio attachment:", error);
            return { success: false, isLFS: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Load audio attachment with LFS support
     */
    static async loadAudioAttachmentWithLFS(
        filePath: string,
        workspaceFolder: vscode.WorkspaceFolder,
        oid?: string
    ): Promise<{ success: boolean; audioData?: string; error?: string; }> {
        try {
            // Use LFS helper to read file (handles LFS automatically)
            const result = await LFSHelper.readFileWithLFS(
                workspaceFolder.uri,
                filePath,
                oid
            );

            if (!result.success) {
                return { success: false, error: result.error };
            }

            // Convert to base64 for webview
            const base64Data = Buffer.from(result.content!).toString('base64');
            const mimeType = this.getMimeTypeFromPath(filePath);
            const audioData = `data:${mimeType};base64,${base64Data}`;

            return { success: true, audioData };

        } catch (error) {
            console.error("[LFS] Failed to load audio attachment:", error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Get MIME type from file path
     */
    private static getMimeTypeFromPath(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: { [key: string]: string; } = {
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.ogg': 'audio/ogg',
            '.webm': 'audio/webm'
        };
        return mimeTypes[ext] || 'audio/wav';
    }

    /**
     * Migrate existing audio attachments to LFS
     */
    static async migrateAttachmentsToLFS(
        workspaceFolder: vscode.WorkspaceFolder,
        progressCallback?: (current: number, total: number, fileName: string) => void
    ): Promise<{ success: boolean; migratedCount: number; errors: string[]; }> {
        try {
            const attachmentsRoot = path.join(workspaceFolder.uri.fsPath, ".project", "attachments");
            console.log({ attachmentsRoot });
            if (!fs.existsSync(attachmentsRoot)) {
                return { success: true, migratedCount: 0, errors: [] };
            }

            // Find all audio files
            const audioFiles: string[] = [];
            const findAudioFiles = (dir: string) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        findAudioFiles(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (['.wav', '.mp3', '.m4a', '.ogg', '.webm'].includes(ext)) {
                            audioFiles.push(fullPath);
                        }
                    }
                }
            };

            findAudioFiles(attachmentsRoot);

            let migratedCount = 0;
            const errors: string[] = [];

            // Process each audio file
            for (let i = 0; i < audioFiles.length; i++) {
                const filePath = audioFiles[i];
                const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

                if (progressCallback) {
                    progressCallback(i + 1, audioFiles.length, path.basename(filePath));
                }

                try {
                    // Read file content
                    const content = await fs.promises.readFile(filePath);
                    const audioBytes = new Uint8Array(content);

                    // Check if file should use LFS
                    if (LFSHelper.shouldUseLFS(filePath, content.length)) {
                        // Add to LFS
                        const result = await LFSHelper.addFileWithLFS(
                            workspaceFolder.uri,
                            relativePath,
                            audioBytes
                        );

                        if (result.success && result.isLFS) {
                            migratedCount++;
                            console.log(`[LFS] Migrated to LFS: ${relativePath}`);
                        } else {
                            errors.push(`Failed to migrate ${relativePath}: ${result.error}`);
                        }
                    }
                } catch (error) {
                    errors.push(`Error processing ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            return { success: true, migratedCount, errors };

        } catch (error) {
            console.error("[LFS] Migration failed:", error);
            return { success: false, migratedCount: 0, errors: [error instanceof Error ? error.message : String(error)] };
        }
    }

    /**
     * Check LFS status of project attachments
     */
    static async checkLFSStatus(
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<{
        totalFiles: number;
        lfsFiles: number;
        regularFiles: number;
        totalSize: number;
        lfsSavings: number;
    }> {
        try {
            const attachmentsRoot = path.join(workspaceFolder.uri.fsPath, ".project", "attachments");

            if (!fs.existsSync(attachmentsRoot)) {
                return { totalFiles: 0, lfsFiles: 0, regularFiles: 0, totalSize: 0, lfsSavings: 0 };
            }

            let totalFiles = 0;
            let lfsFiles = 0;
            let totalSize = 0;
            let lfsSavings = 0;

            const checkFile = async (filePath: string) => {
                const stats = await fs.promises.stat(filePath);
                totalFiles++;
                totalSize += stats.size;

                // Check if file would qualify for LFS
                if (LFSHelper.shouldUseLFS(filePath, stats.size)) {
                    // Check if it's actually in LFS by reading git object
                    try {
                        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
                        const result = await LFSHelper.readFileWithLFS(workspaceFolder.uri, relativePath);

                        // If we can read it and it's much smaller than expected, it's probably an LFS pointer
                        if (result.success && result.content!.length < stats.size / 10) {
                            lfsFiles++;
                            lfsSavings += stats.size - result.content!.length;
                        }
                    } catch (error) {
                        // File not in git yet, count as regular
                    }
                }
            };

            const walkDir = async (dir: string) => {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walkDir(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (['.wav', '.mp3', '.m4a', '.ogg', '.webm'].includes(ext)) {
                            await checkFile(fullPath);
                        }
                    }
                }
            };

            await walkDir(attachmentsRoot);

            return {
                totalFiles,
                lfsFiles,
                regularFiles: totalFiles - lfsFiles,
                totalSize,
                lfsSavings
            };

        } catch (error) {
            console.error("[LFS] Status check failed:", error);
            return { totalFiles: 0, lfsFiles: 0, regularFiles: 0, totalSize: 0, lfsSavings: 0 };
        }
    }
}