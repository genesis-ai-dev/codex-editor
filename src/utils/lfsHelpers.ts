import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[LFSHelpers]", ...args) : () => { };

/**
 * LFS Pointer structure
 */
export interface LFSPointer {
    oid: string;
    size: number;
    version: string;
}

/**
 * Check if a file is an LFS pointer file
 * @param filePath - Absolute path to the file
 * @returns true if file is an LFS pointer, false otherwise
 */
export async function isPointerFile(filePath: string): Promise<boolean> {
    try {
        const stats = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

        // Quick check: LFS pointers are always < 200 bytes
        // Real media files are always much larger
        if (stats.size > 400) {
            return false;
        }

        // Read and verify content
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const text = Buffer.from(content).toString('utf-8');

        // Check for LFS pointer signature
        return text.includes('version https://git-lfs.github.com/spec/v1');
    } catch (error) {
        debug(`Error checking if file is pointer: ${filePath}`, error);
        return false;
    }
}

/**
 * Parse an LFS pointer file to extract OID and size
 * @param filePath - Absolute path to the pointer file
 * @returns LFS pointer data or null if invalid
 */
export async function parsePointerFile(filePath: string): Promise<LFSPointer | null> {
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const text = Buffer.from(content).toString('utf-8');

        return parsePointerContent(text);
    } catch (error) {
        debug(`Error parsing pointer file: ${filePath}`, error);
        return null;
    }
}

/**
 * Parse LFS pointer content string
 * @param content - Content of the pointer file
 * @returns LFS pointer data or null if invalid
 */
export function parsePointerContent(content: string): LFSPointer | null {
    try {
        // Check for version
        const versionMatch = content.match(/version (https:\/\/git-lfs\.github\.com\/spec\/v\d+)/);
        if (!versionMatch) {
            return null;
        }

        // Extract OID
        const oidMatch = content.match(/oid sha256:([a-f0-9]{64})/i);
        if (!oidMatch) {
            return null;
        }

        // Extract size
        const sizeMatch = content.match(/size (\d+)/);
        if (!sizeMatch) {
            return null;
        }

        return {
            version: versionMatch[1],
            oid: oidMatch[1],
            size: parseInt(sizeMatch[1], 10),
        };
    } catch (error) {
        debug("Error parsing pointer content", error);
        return null;
    }
}

/**
 * Get file status regarding LFS
 */
export type LFSFileStatus =
    | "missing"                    // File doesn't exist
    | "local-unsynced"             // Both files/ and pointers/ have full files (not synced yet)
    | "uploaded-not-downloaded"    // Both are pointers (synced but not downloaded)
    | "uploaded-and-downloaded"    // Pointer in pointers/, file in files/
    | "regular-file";              // Regular file (not LFS)

/**
 * Check the LFS status of a file
 * @param projectPath - Root path of the project
 * @param book - Book abbreviation (e.g., "MAT")
 * @param filename - Name of the file (e.g., "audio-xxx.webm")
 * @returns Status of the file
 */
export async function getFileStatus(
    projectPath: string,
    book: string,
    filename: string
): Promise<LFSFileStatus> {
    const filesPath = path.join(projectPath, ".project", "attachments", "files", book, filename);
    const pointersPath = path.join(projectPath, ".project", "attachments", "pointers", book, filename);

    try {
        let filesStats: vscode.FileStat | null = null;
        let pointersStats: vscode.FileStat | null = null;

        try {
            filesStats = await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
        } catch {
            filesStats = null;
        }

        try {
            pointersStats = await vscode.workspace.fs.stat(vscode.Uri.file(pointersPath));
        } catch {
            pointersStats = null;
        }

        if (!filesStats && !pointersStats) {
            return "missing";
        }

        // Check if each file is a pointer
        const filesIsPointer = filesStats ? await isPointerFile(filesPath) : false;
        const pointersIsPointer = pointersStats ? await isPointerFile(pointersPath) : false;

        // Both are full files (approximately same size) = local recording not synced
        if (!pointersIsPointer && filesStats && pointersStats &&
            Math.abs(filesStats.size - pointersStats.size) < 1000) {
            return "local-unsynced";
        }

        // Both are pointers = synced but not downloaded (stream-only mode)
        if (pointersIsPointer && filesIsPointer) {
            return "uploaded-not-downloaded";
        }

        // Pointer in pointers/, file in files/ = synced and downloaded
        if (pointersIsPointer && !filesIsPointer && filesStats) {
            return "uploaded-and-downloaded";
        }

        // Only has files/ without pointers/ = regular non-LFS file
        if (filesStats && !pointersStats) {
            return "regular-file";
        }

        return "missing";
    } catch (error) {
        debug("Error getting file status", error);
        return "missing";
    }
}

/**
 * Find all pointer files in the pointers directory
 * @param pointersDir - Path to .project/attachments/pointers
 * @returns Array of relative paths (e.g., ["MAT/audio-xxx.webm", "GEN/audio-yyy.webm"])
 */
// Helper function for scanning directories (defined at module level to avoid no-inner-declarations)
async function scanDirectoryForPointers(
    dirUri: vscode.Uri,
    relativePath: string,
    pointerFiles: string[]
): Promise<void> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);

        for (const [name, type] of entries) {
            const fullPath = path.join(dirUri.fsPath, name);
            const relPath = relativePath ? path.join(relativePath, name) : name;

            if (type === vscode.FileType.Directory) {
                await scanDirectoryForPointers(vscode.Uri.file(fullPath), relPath, pointerFiles);
            } else if (type === vscode.FileType.File) {
                // Check if it's actually a pointer
                const isPointer = await isPointerFile(fullPath);
                if (isPointer) {
                    pointerFiles.push(relPath);
                }
            }
        }
    } catch (error) {
        debug(`Error scanning directory: ${dirUri.fsPath}`, error);
    }
}

/**
 * Find all pointer files in the pointers directory
 * @param pointersDir - Path to .project/attachments/pointers
 * @returns Array of relative paths (e.g., ["MAT/audio-xxx.webm", "GEN/audio-yyy.webm"])
 */
export async function findAllPointerFiles(pointersDir: string): Promise<string[]> {
    const pointerFiles: string[] = [];

    try {
        const pointersUri = vscode.Uri.file(pointersDir);
        await scanDirectoryForPointers(pointersUri, "", pointerFiles);
    } catch (error) {
        debug("Error finding pointer files", error);
    }

    return pointerFiles;
}

/**
 * Replace a file in attachments/files with its pointer from attachments/pointers
 * @param projectPath - Root path of the project
 * @param relativeFilePath - Relative path from pointers/ (e.g., "MAT/audio-xxx.webm")
 * @returns true if successful, false otherwise
 */
export async function replaceFileWithPointer(
    projectPath: string,
    relativeFilePath: string
): Promise<boolean> {
    const pointerPath = path.join(projectPath, ".project", "attachments", "pointers", relativeFilePath);
    const filesPath = path.join(projectPath, ".project", "attachments", "files", relativeFilePath);

    try {
        // Verify pointer exists and is actually a pointer
        let pointerExists = false;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(pointerPath));
            pointerExists = true;
        } catch {
            pointerExists = false;
        }

        if (!pointerExists) {
            debug(`Pointer doesn't exist: ${pointerPath}`);
            return false;
        }

        const isPointer = await isPointerFile(pointerPath);
        if (!isPointer) {
            debug(`File is not a pointer: ${pointerPath}`);
            return false;
        }

        // Check if files/ path exists
        let filesExists = false;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filesPath));
            filesExists = true;
        } catch {
            filesExists = false;
        }

        if (filesExists) {
            // Check if it's already a pointer
            const filesIsPointer = await isPointerFile(filesPath);
            if (filesIsPointer) {
                debug(`File is already a pointer: ${filesPath}`);
                return true; // Already done
            }
        }

        // Ensure directory exists
        const filesDir = path.dirname(filesPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

        // Copy pointer to files/
        const pointerContent = await vscode.workspace.fs.readFile(vscode.Uri.file(pointerPath));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(filesPath), pointerContent);

        debug(`Replaced file with pointer: ${relativeFilePath}`);
        return true;
    } catch (error) {
        console.error(`Error replacing file with pointer: ${relativeFilePath}`, error);
        return false;
    }
}

/**
 * Check if a file should be protected from cleanup (i.e., it's a local unsynced recording)
 * @param projectPath - Root path of the project
 * @param book - Book abbreviation
 * @param filename - File name
 * @returns true if file should be protected
 */
export async function isLocalUnsyncedFile(
    projectPath: string,
    book: string,
    filename: string
): Promise<boolean> {
    const status = await getFileStatus(projectPath, book, filename);
    return status === "local-unsynced";
}

/**
 * Check if a Uint8Array contains an LFS pointer (not the actual file content).
 * Useful for validating file content before processing.
 */
export function isLfsPointerContent(data: Uint8Array): boolean {
    if (data.length > 400) {
        return false;
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    return text.includes('version https://git-lfs.github.com/spec/v1');
}

/**
 * Resolve a Git LFS pointer file by downloading the actual content.
 * Uses `git lfs smudge` to pipe the pointer content and get the real file.
 *
 * @param filePath - Absolute path to the LFS pointer file
 * @param projectPath - Root path of the git repository (used as cwd for git commands)
 * @returns The resolved file content as Uint8Array, or null if resolution failed
 */
export async function resolveLfsPointerFile(
    filePath: string,
    projectPath: string
): Promise<{ data: Uint8Array; error?: undefined } | { data?: undefined; error: string }> {
    try {
        const pointer = await parsePointerFile(filePath);
        if (!pointer) {
            return { error: `File "${filePath}" is not a valid LFS pointer.` };
        }

        console.log(`[LFS] Resolving pointer for "${path.basename(filePath)}" (oid: ${pointer.oid.substring(0, 12)}..., expected size: ${pointer.size} bytes)`);

        // Read the pointer content
        const pointerContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const pointerText = Buffer.from(pointerContent).toString('utf-8');

        // Use git lfs smudge to resolve the pointer to actual content
        // This pipes the pointer text to stdin and gets the real file on stdout
        const result = await new Promise<{ data: Uint8Array; error?: undefined } | { data?: undefined; error: string }>((resolve) => {
            const proc = execFile(
                'git',
                ['lfs', 'smudge'],
                {
                    cwd: projectPath,
                    maxBuffer: pointer.size + 1024 * 1024, // Expected size + 1MB headroom
                    encoding: 'buffer' as any,
                },
                (err, stdout, _stderr) => {
                    if (err) {
                        const stderrText = _stderr ? Buffer.from(_stderr).toString('utf-8') : '';
                        resolve({
                            error: `git lfs smudge failed: ${err.message}${stderrText ? ` (${stderrText.trim()})` : ''}. ` +
                                `Make sure Git LFS is installed and the LFS server is accessible. ` +
                                `You can also try running "git lfs pull" in the project directory.`
                        });
                        return;
                    }
                    const data = new Uint8Array(stdout as unknown as Buffer);
                    if (data.length < 10 || isLfsPointerContent(data)) {
                        resolve({
                            error: `git lfs smudge returned a pointer instead of the actual file. ` +
                                `The file may not be available on the LFS server. ` +
                                `Try running "git lfs pull" in "${projectPath}".`
                        });
                        return;
                    }
                    console.log(`[LFS] Successfully resolved "${path.basename(filePath)}" (${data.length} bytes)`);
                    resolve({ data });
                }
            );

            // Write the pointer content to stdin
            proc.stdin?.write(pointerText);
            proc.stdin?.end();
        });

        // If successful, also write the resolved content back to disk to cache it
        if (result.data) {
            try {
                await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), result.data);
                console.log(`[LFS] Cached resolved file at "${filePath}"`);
            } catch (writeErr) {
                console.warn(`[LFS] Could not cache resolved file: ${writeErr}`);
            }
        }

        return result;
    } catch (err) {
        return {
            error: `Failed to resolve LFS pointer: ${err instanceof Error ? err.message : String(err)}. ` +
                `Try running "git lfs pull" in the project directory.`
        };
    }
}

