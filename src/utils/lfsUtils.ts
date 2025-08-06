import * as vscode from "vscode";
import git from "isomorphic-git";
import fs from "fs";
import http from "isomorphic-git/http/web";
import lfs from '@fetsorn/isogit-lfs';
// Patch the LFS library to work with GitLab responses
import { patchLFSLibrary } from './lfsLibraryPatch';
import path from "path";

// Apply the patch when the module is loaded
patchLFSLibrary();

/**
 * LFS utilities for handling large files in Codex projects
 */
export class LFSHelper {

    /**
     * Check if a file should be stored in LFS based on type (and size for non-audio files)
     */
    static shouldUseLFS(filePath: string, fileSize: number): boolean {
        const ext = path.extname(filePath).toLowerCase();

        // Audio files: ALL go to LFS regardless of size (they're binary and don't benefit from Git)
        const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];
        if (audioExtensions.includes(ext)) {
            return true;
        }

        // Other large binary files: use size threshold
        const largeBinaryExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.pdf'];
        const lfsThresholdMB = 10; // Files larger than 10MB
        const sizeMB = fileSize / (1024 * 1024);

        return largeBinaryExtensions.includes(ext) && sizeMB > lfsThresholdMB;
    }

    /**
 * Check if the remote repository has LFS support
 */
    static async checkLFSSupport(workspaceUri: vscode.Uri): Promise<{ supported: boolean; error?: string; }> {
        try {
            const workspaceFolder = workspaceUri.fsPath;

            // Get remote URL
            const remoteURL = await git.getConfig({
                fs,
                dir: workspaceFolder,
                path: 'remote.origin.url'
            });

            if (!remoteURL) {
                return { supported: false, error: "No remote URL configured" };
            }

            // Parse URL to extract credentials
            const { cleanUrl, auth } = this.parseGitUrl(remoteURL);

            // Try to make a simple LFS API request to check if LFS is enabled
            const lfsUrl = cleanUrl.replace(/\.git$/, '') + '.git/info/lfs';
            console.log("[LFS] Checking LFS support at:", lfsUrl);

            try {
                // Make a simple request to the LFS endpoint
                const response = await http.request({
                    url: lfsUrl,
                    method: 'GET',
                    headers: auth ? {
                        'Authorization': `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
                    } : {}
                });

                console.log("[LFS] LFS endpoint response status:", response.statusCode);

                // If we get a 200 or 401 (auth required), LFS is likely enabled
                if (response.statusCode === 200 || response.statusCode === 401 || response.statusCode === 403) {
                    return { supported: true };
                } else {
                    return { supported: false, error: `LFS endpoint returned status ${response.statusCode}` };
                }
            } catch (requestError: any) {
                console.warn("[LFS] Could not verify LFS support:", requestError.message);
                // Don't fail completely, just warn
                return { supported: true }; // Assume it's supported and let actual operations fail if not
            }
        } catch (error) {
            console.error("[LFS] Error checking LFS support:", error);
            return { supported: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Extract credentials from URL and return clean URL + auth
     */
    private static parseGitUrl(url: string): { cleanUrl: string; auth?: { username: string; password: string; }; } {
        try {
            const urlObj = new URL(url);

            // Check if URL has embedded credentials
            if (urlObj.username || urlObj.password) {
                const auth = {
                    username: decodeURIComponent(urlObj.username),
                    password: decodeURIComponent(urlObj.password)
                };

                // Remove credentials from URL
                urlObj.username = '';
                urlObj.password = '';

                return { cleanUrl: urlObj.toString(), auth };
            }

            return { cleanUrl: url };
        } catch (error) {
            // If URL parsing fails, return as-is
            console.warn("[LFS] Could not parse URL, using as-is:", error);
            return { cleanUrl: url };
        }
    }

    /**
     * Upload a file to LFS and get pointer info
     */
    static async uploadToLFS(
        workspaceUri: vscode.Uri,
        filePath: string,
        fileContent: Uint8Array
    ): Promise<{ success: boolean; pointerInfo?: any; error?: string; }> {
        try {
            const workspaceFolder = workspaceUri.fsPath;

            // Get remote URL for LFS operations
            const remoteURL = await git.getConfig({
                fs,
                dir: workspaceFolder,
                path: 'remote.origin.url'
            });

            if (!remoteURL) {
                return { success: false, error: "No remote URL configured" };
            }

            // Parse URL to extract credentials
            const { cleanUrl, auth } = this.parseGitUrl(remoteURL);
            console.log("[LFS] Using clean URL for upload:", cleanUrl);

            // Upload blobs to LFS (uploadBlobs expects an array) - now using patched version
            console.log("[LFS] Attempting upload with auth:", auth ? "credentials provided" : "no auth");

            const pointerInfos = await lfs.uploadBlobs({
                fs,
                http,
                url: cleanUrl,
                headers: {},
                auth // Pass extracted credentials
            }, [fileContent]);

            const pointerInfo = pointerInfos[0]; // Get first result since we uploaded one blob
            console.log("[LFS] Upload successful, pointer info:", pointerInfo);

            return { success: true, pointerInfo };
        } catch (error) {
            console.error("[LFS] Upload failed:", error);

            // If LFS upload fails, let's fall back to adding the file normally to Git
            // This ensures the user's workflow isn't completely blocked
            console.warn("[LFS] Falling back to regular Git storage due to LFS upload failure");

            const workspaceFolder = workspaceUri.fsPath;

            try {
                // Add file to Git normally (without LFS)
                // Use filePath directly since it should already be relative to workspace
                const relativePath = path.isAbsolute(filePath) ? path.relative(workspaceFolder, filePath) : filePath;

                // Ensure the path doesn't go outside the workspace
                if (relativePath.startsWith('..')) {
                    throw new Error(`File path is outside workspace: ${relativePath}`);
                }

                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: relativePath
                });

                console.log("[LFS] File added to Git (without LFS) as fallback");

                return {
                    success: false,
                    error: `LFS upload failed, file was added to Git normally instead: ${error instanceof Error ? error.message : String(error)}`
                };
            } catch (gitError) {
                console.error("[LFS] Fallback to Git also failed:", gitError);
                return {
                    success: false,
                    error: `Both LFS upload and Git fallback failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    }

    /**
     * Read a file, handling LFS automatically
     */
    static async readFileWithLFS(
        workspaceUri: vscode.Uri,
        relativePath: string,
        oid?: string
    ): Promise<{ success: boolean; content?: Uint8Array; error?: string; }> {
        try {
            const workspaceFolder = workspaceUri.fsPath;
            const fullPath = path.join(workspaceFolder, relativePath);

            // If no OID provided, just read the file directly
            if (!oid) {
                const content = await fs.promises.readFile(fullPath);
                return { success: true, content: new Uint8Array(content) };
            }

            // Read blob from git
            const gitObject = await git.readBlob({
                fs,
                dir: workspaceFolder,
                oid,
                filepath: relativePath
            });

            // Check if this blob points to LFS
            if (lfs.pointsToLFS(gitObject.blob)) {
                console.log("[LFS] File points to LFS, downloading...");

                // Get remote URL
                const remoteURL = await git.getConfig({
                    fs,
                    dir: workspaceFolder,
                    path: 'remote.origin.url'
                });

                if (!remoteURL) {
                    return { success: false, error: "No remote URL configured for LFS" };
                }

                // Parse URL to extract credentials
                const { cleanUrl, auth } = this.parseGitUrl(remoteURL);

                // Deserialize pointer
                const pointer = lfs.readPointer({
                    gitdir: path.join(workspaceFolder, '.git'),
                    content: gitObject.blob
                });

                // Download from LFS
                const lfsContent = await lfs.downloadBlobFromPointer({
                    fs,
                    url: cleanUrl,
                    http,
                    headers: {},
                    auth // Pass extracted credentials
                }, pointer);

                return { success: true, content: lfsContent };
            } else {
                // Regular git blob
                return { success: true, content: gitObject.blob };
            }
        } catch (error) {
            console.error("[LFS] Read failed:", error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Add a file to git with LFS handling
     */
    static async addFileWithLFS(
        workspaceUri: vscode.Uri,
        relativePath: string,
        fileContent: Uint8Array
    ): Promise<{ success: boolean; isLFS: boolean; error?: string; }> {
        try {
            const workspaceFolder = workspaceUri.fsPath;
            const fullPath = path.join(workspaceFolder, relativePath);

            // Check if file should use LFS
            const shouldUseLFS = this.shouldUseLFS(relativePath, fileContent.length);

            if (shouldUseLFS) {
                console.log("[LFS] File qualifies for LFS, uploading...");

                // Upload to LFS
                const uploadResult = await this.uploadToLFS(workspaceUri, relativePath, fileContent);

                if (!uploadResult.success) {
                    return { success: false, isLFS: false, error: uploadResult.error };
                }

                // Create pointer file content
                const pointerContent = lfs.formatPointerInfo(uploadResult.pointerInfo!);

                // Write pointer file to working directory
                await fs.promises.writeFile(fullPath, pointerContent);

                // Add pointer file to git
                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: relativePath
                });

                return { success: true, isLFS: true };
            } else {
                // Regular file, write and add normally
                await fs.promises.writeFile(fullPath, fileContent);

                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: relativePath
                });

                return { success: true, isLFS: false };
            }
        } catch (error) {
            console.error("[LFS] Add file failed:", error);
            return { success: false, isLFS: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Migrate from .gitignore to LFS tracking
     */
    static async migrateFromGitignoreToLFS(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const workspaceFolder = workspaceUri.fsPath;
            const gitignorePath = path.join(workspaceFolder, '.gitignore');

            // Read existing .gitignore
            let gitignoreContent = '';
            try {
                gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf8');
            } catch (error) {
                console.log("[LFS] No existing .gitignore found");
                return true;
            }

            // Remove problematic patterns that prevent LFS tracking
            const problematicPatterns = [
                '.project/attachments/',
                '*.wav',
                '*.mp3',
                '*.m4a',
                '*.ogg',
                '*.webm',
                '*.mp4',
                '*.avi',
                '*.mov',
                '*.mkv',
                '*.jpg',
                '*.jpeg',
                '*.png'
            ];

            let updatedContent = gitignoreContent;
            let hasChanges = false;

            for (const pattern of problematicPatterns) {
                const regex = new RegExp(`^\\s*${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'gm');
                if (regex.test(updatedContent)) {
                    updatedContent = updatedContent.replace(regex, '');
                    hasChanges = true;
                    console.log(`[LFS] Removed ${pattern} from .gitignore`);
                }
            }

            // Clean up extra blank lines
            updatedContent = updatedContent.replace(/\n\s*\n\s*\n/g, '\n\n');

            if (hasChanges) {
                await fs.promises.writeFile(gitignorePath, updatedContent);
                console.log("[LFS] Updated .gitignore to allow LFS tracking");
            }

            return true;
        } catch (error) {
            console.error("[LFS] Migration from .gitignore failed:", error);
            return false;
        }
    }

    /**
     * Initialize LFS in a repository
     */
    static async initializeLFS(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            // First, migrate .gitignore to allow LFS tracking
            const migrationSuccess = await this.migrateFromGitignoreToLFS(workspaceUri);
            if (!migrationSuccess) {
                console.warn("[LFS] .gitignore migration had issues, but continuing...");
            }

            const workspaceFolder = workspaceUri.fsPath;
            const gitAttributesPath = path.join(workspaceFolder, '.gitattributes');

            // Create or update .gitattributes for LFS
            const lfsPatterns = [
                '# Audio files',
                '*.wav filter=lfs diff=lfs merge=lfs -text',
                '*.mp3 filter=lfs diff=lfs merge=lfs -text',
                '*.m4a filter=lfs diff=lfs merge=lfs -text',
                '*.ogg filter=lfs diff=lfs merge=lfs -text',
                '*.webm filter=lfs diff=lfs merge=lfs -text',
                '',
                '# Video files',
                '*.mp4 filter=lfs diff=lfs merge=lfs -text',
                '*.avi filter=lfs diff=lfs merge=lfs -text',
                '*.mov filter=lfs diff=lfs merge=lfs -text',
                '*.mkv filter=lfs diff=lfs merge=lfs -text',
                '',
                '# Image files over 1MB should use LFS',
                '*.jpg filter=lfs diff=lfs merge=lfs -text',
                '*.jpeg filter=lfs diff=lfs merge=lfs -text',
                '*.png filter=lfs diff=lfs merge=lfs -text'
            ];

            await fs.promises.writeFile(gitAttributesPath, lfsPatterns.join('\n'));

            // Add .gitattributes to git
            await git.add({
                fs,
                dir: workspaceFolder,
                filepath: '.gitattributes'
            });

            console.log("[LFS] Initialized LFS configuration");
            return true;
        } catch (error) {
            console.error("[LFS] Initialization failed:", error);
            return false;
        }
    }
}