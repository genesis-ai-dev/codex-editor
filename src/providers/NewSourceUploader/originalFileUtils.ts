/**
 * Original File Utilities
 * 
 * Handles hash-based deduplication of original files stored in .project/attachments/originals/
 * 
 * Storage Structure:
 * - .project/attachments/originals/
 *   - file-hashes.json     (registry of all imported files with their hashes)
 *   - sample.idml          (actual original file)
 *   - sample(1).idml       (renamed file if same name but different content)
 *   - other-document.docx  (another original file)
 * 
 * Features:
 * - Computes SHA-256 hash of file content
 * - Maintains a registry (file-hashes.json) of original files with their hashes
 * - Saves actual original files to the originals folder
 * - Prevents duplicate storage of identical files (same content = reuse existing file)
 * - Handles filename conflicts by renaming (e.g., sample(1).idml, sample(2).idml)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Registry entry for an original file
 */
export interface OriginalFileEntry {
    /** SHA-256 hash of the file content */
    hash: string;
    /** The filename stored in attachments/originals/ */
    fileName: string;
    /** Original filename(s) that mapped to this file (for reference) */
    originalNames: string[];
    /** Timestamp when first added */
    addedAt: string;
}

/**
 * Registry structure for original files
 */
export interface OriginalFilesRegistry {
    /** Version for future migrations */
    version: number;
    /** Map of hash -> file entry */
    files: { [hash: string]: OriginalFileEntry; };
    /** Map of filename -> hash (for quick filename lookup) */
    fileNameToHash: { [fileName: string]: string; };
}

/**
 * Result of checking/adding an original file
 */
export interface OriginalFileResult {
    /** The filename to use in metadata (may be different from requested) */
    fileName: string;
    /** Whether a new file was saved (false if deduplicated) */
    savedNewFile: boolean;
    /** The hash of the file */
    hash: string;
    /** Message describing what happened */
    message: string;
}

const REGISTRY_FILENAME = 'file-hashes.json';

/**
 * Compute SHA-256 hash of file data
 */
export function computeFileHash(data: Uint8Array | ArrayBuffer | Buffer): string {
    const buffer = data instanceof ArrayBuffer
        ? Buffer.from(data)
        : data instanceof Uint8Array
            ? Buffer.from(data)
            : data;
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get the path to the originals directory
 */
function getOriginalsDir(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(
        workspaceFolder.uri,
        '.project',
        'attachments',
        'originals'
    );
}

/**
 * Get the path to the registry file
 */
function getRegistryPath(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(getOriginalsDir(workspaceFolder), REGISTRY_FILENAME);
}

/**
 * Load the original files registry, creating an empty one if it doesn't exist
 */
export async function loadOriginalFilesRegistry(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<OriginalFilesRegistry> {
    const registryPath = getRegistryPath(workspaceFolder);

    try {
        const data = await vscode.workspace.fs.readFile(registryPath);
        const registry = JSON.parse(new TextDecoder().decode(data)) as OriginalFilesRegistry;

        // Ensure all required fields exist (migration safety)
        if (!registry.files) registry.files = {};
        if (!registry.fileNameToHash) registry.fileNameToHash = {};
        if (!registry.version) registry.version = 1;

        return registry;
    } catch {
        // Registry doesn't exist, create empty one
        return {
            version: 1,
            files: {},
            fileNameToHash: {},
        };
    }
}

/**
 * Save the original files registry
 */
export async function saveOriginalFilesRegistry(
    workspaceFolder: vscode.WorkspaceFolder,
    registry: OriginalFilesRegistry
): Promise<void> {
    const originalsDir = getOriginalsDir(workspaceFolder);
    await vscode.workspace.fs.createDirectory(originalsDir);

    const registryPath = getRegistryPath(workspaceFolder);
    const data = new TextEncoder().encode(JSON.stringify(registry, null, 2));
    await vscode.workspace.fs.writeFile(registryPath, data);
}

/**
 * Generate a unique filename by adding (1), (2), etc. suffix
 */
function generateUniqueFileName(
    baseName: string,
    existingFileNames: Set<string>
): string {
    if (!existingFileNames.has(baseName)) {
        return baseName;
    }

    // Split filename into name and extension
    const lastDotIndex = baseName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex > 0 ? baseName.slice(0, lastDotIndex) : baseName;
    const extension = lastDotIndex > 0 ? baseName.slice(lastDotIndex) : '';

    // Try incrementing numbers until we find a unique name
    let counter = 1;
    let newName: string;
    do {
        newName = `${nameWithoutExt}(${counter})${extension}`;
        counter++;
    } while (existingFileNames.has(newName));

    return newName;
}

/**
 * Save an original file with hash-based deduplication
 * 
 * Handles three scenarios:
 * 1. Same name, same hash: Keep existing file, return existing filename
 * 2. Different name, same hash: Keep existing file, return existing filename
 * 3. Same name, different hash: Save with new name (e.g., sample(1).idml)
 * 
 * @param workspaceFolder The workspace folder
 * @param requestedFileName The desired filename for the original file
 * @param fileData The file content
 * @returns Result with the actual filename to use in metadata
 */
export async function saveOriginalFileWithDeduplication(
    workspaceFolder: vscode.WorkspaceFolder,
    requestedFileName: string,
    fileData: Uint8Array | ArrayBuffer | Buffer
): Promise<OriginalFileResult> {
    // Compute hash of the file
    const hash = computeFileHash(fileData);

    // Load existing registry
    const registry = await loadOriginalFilesRegistry(workspaceFolder);

    // Check if we already have a file with this hash
    const existingEntry = registry.files[hash];

    if (existingEntry) {
        // We already have a file with the same content
        console.log(`[OriginalFiles] File with hash ${hash.slice(0, 8)}... already exists as "${existingEntry.fileName}"`);

        // Track this original name if it's new
        if (!existingEntry.originalNames.includes(requestedFileName)) {
            existingEntry.originalNames.push(requestedFileName);
            await saveOriginalFilesRegistry(workspaceFolder, registry);
        }

        return {
            fileName: existingEntry.fileName,
            savedNewFile: false,
            hash,
            message: `Deduplicated: using existing file "${existingEntry.fileName}" (same content as "${requestedFileName}")`,
        };
    }

    // No existing file with this hash - need to save
    const originalsDir = getOriginalsDir(workspaceFolder);
    await vscode.workspace.fs.createDirectory(originalsDir);

    // Check if the filename is already taken (by a different file with different hash)
    const existingFileNames = new Set(Object.keys(registry.fileNameToHash));
    let actualFileName = requestedFileName;

    if (existingFileNames.has(requestedFileName)) {
        // Filename conflict - need to generate a unique name
        actualFileName = generateUniqueFileName(requestedFileName, existingFileNames);
        console.log(`[OriginalFiles] Filename "${requestedFileName}" exists with different content, saving as "${actualFileName}"`);
    }

    // Save the file
    const fileUri = vscode.Uri.joinPath(originalsDir, actualFileName);
    const buffer = fileData instanceof ArrayBuffer
        ? new Uint8Array(fileData)
        : fileData instanceof Buffer
            ? new Uint8Array(fileData)
            : fileData;
    await vscode.workspace.fs.writeFile(fileUri, buffer);

    // Update registry
    registry.files[hash] = {
        hash,
        fileName: actualFileName,
        originalNames: [requestedFileName],
        addedAt: new Date().toISOString(),
    };
    registry.fileNameToHash[actualFileName] = hash;

    await saveOriginalFilesRegistry(workspaceFolder, registry);

    const message = actualFileName !== requestedFileName
        ? `Saved as "${actualFileName}" (renamed from "${requestedFileName}" due to filename conflict)`
        : `Saved new file "${actualFileName}"`;

    console.log(`[OriginalFiles] ${message}`);

    return {
        fileName: actualFileName,
        savedNewFile: true,
        hash,
        message,
    };
}

/**
 * Check if an original file exists by hash
 */
export async function findOriginalFileByHash(
    workspaceFolder: vscode.WorkspaceFolder,
    hash: string
): Promise<OriginalFileEntry | null> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);
    return registry.files[hash] || null;
}

/**
 * Check if an original file exists by filename
 */
export async function findOriginalFileByName(
    workspaceFolder: vscode.WorkspaceFolder,
    fileName: string
): Promise<OriginalFileEntry | null> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);
    const hash = registry.fileNameToHash[fileName];
    if (hash) {
        return registry.files[hash] || null;
    }
    return null;
}

/**
 * Get all original files in the registry
 */
export async function getAllOriginalFiles(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<OriginalFileEntry[]> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);
    return Object.values(registry.files);
}

/**
 * Clean up orphaned registry entries (files that no longer exist on disk)
 */
export async function cleanupOrphanedEntries(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<number> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);
    const originalsDir = getOriginalsDir(workspaceFolder);

    let removedCount = 0;

    for (const [hash, entry] of Object.entries(registry.files)) {
        const fileUri = vscode.Uri.joinPath(originalsDir, entry.fileName);
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch {
            // File doesn't exist, remove from registry
            delete registry.files[hash];
            delete registry.fileNameToHash[entry.fileName];
            removedCount++;
            console.log(`[OriginalFiles] Removed orphaned registry entry: ${entry.fileName}`);
        }
    }

    if (removedCount > 0) {
        await saveOriginalFilesRegistry(workspaceFolder, registry);
    }

    return removedCount;
}
