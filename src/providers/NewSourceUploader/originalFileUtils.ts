/**
 * Original File Utilities
 *
 * Handles hash-based deduplication of original files stored in .project/attachments/files/originals/
 * (Under files/ and pointers/ so sync/LFS can properly track them.)
 *
 * Storage Structure:
 * - .project/attachments/files/originals/   (actual files)
 * - .project/attachments/pointers/originals/ (mirror for sync)
 * - metadata.json  (originalFilesHashes section - registry for proper sync/merge)
 *
 * Features:
 * - Computes SHA-256 hash of file content
 * - Maintains registry in metadata.json (originalFilesHashes) for sync and merge
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
    /** The filename stored in attachments/files/originals/ */
    fileName: string;
    /** Original filename(s) that mapped to this file (for reference) */
    originalNames: string[];
    /** Notebook base names (without extension) that reference this original file */
    referencedBy: string[];
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

const ORIGINAL_FILES_HASHES_KEY = 'originalFilesHashes';

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
 * Get the path to the originals directory in attachments/files.
 * Uses attachments/files/originals so sync/LFS can properly track these files.
 */
function getOriginalsDir(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(
        workspaceFolder.uri,
        '.project',
        'attachments',
        'files',
        'originals'
    );
}

/**
 * Get the path to the originals directory in attachments/pointers.
 * Mirrors files/originals for sync - pointers/ is committed to git (files/ is gitignored).
 */
function getOriginalsPointersDir(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(
        workspaceFolder.uri,
        '.project',
        'attachments',
        'pointers',
        'originals'
    );
}

/**
 * Resolve the URI for an original file, checking both current and legacy locations.
 * Preferred: attachments/files/originals/
 * Legacy: attachments/originals/ (for projects created before the path change)
 * Returns the URI of the existing file, or the preferred URI if neither exists (caller will fail on read).
 */
export async function resolveOriginalFileUri(
    workspaceFolder: vscode.WorkspaceFolder,
    fileName: string
): Promise<vscode.Uri> {
    const preferredUri = vscode.Uri.joinPath(getOriginalsDir(workspaceFolder), fileName);
    try {
        await vscode.workspace.fs.stat(preferredUri);
        return preferredUri;
    } catch {
        const legacyUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            '.project',
            'attachments',
            'originals',
            fileName
        );
        try {
            await vscode.workspace.fs.stat(legacyUri);
            return legacyUri;
        } catch {
            return preferredUri;
        }
    }
}

/**
 * Find an original file by trying multiple possible filenames.
 * Returns the first filename that exists in either preferred or legacy location.
 */
export async function findOriginalFileByPossibleNames(
    workspaceFolder: vscode.WorkspaceFolder,
    possibleFileNames: string[]
): Promise<{ fileName: string; uri: vscode.Uri } | null> {
    for (const fileName of possibleFileNames) {
        const uri = await resolveOriginalFileUri(workspaceFolder, fileName);
        try {
            await vscode.workspace.fs.stat(uri);
            return { fileName, uri };
        } catch {
            // File doesn't exist, try next
        }
    }
    return null;
}

/**
 * Ensure a copy exists in pointers/originals for sync.
 * Copies from files/originals if the pointer is missing (e.g. file saved before we wrote to pointers/).
 */
async function ensureOriginalPointerExists(
    workspaceFolder: vscode.WorkspaceFolder,
    fileName: string
): Promise<void> {
    const filesUri = vscode.Uri.joinPath(getOriginalsDir(workspaceFolder), fileName);
    const pointersUri = vscode.Uri.joinPath(getOriginalsPointersDir(workspaceFolder), fileName);
    try {
        await vscode.workspace.fs.stat(pointersUri);
        return; // Pointer already exists
    } catch {
        // Pointer missing - copy from files/
    }
    try {
        const bytes = await vscode.workspace.fs.readFile(filesUri);
        await vscode.workspace.fs.createDirectory(getOriginalsPointersDir(workspaceFolder));
        await vscode.workspace.fs.writeFile(pointersUri, bytes);
    } catch (err) {
        console.warn(`[OriginalFiles] Could not ensure pointer for ${fileName}:`, err);
    }
}

/**
 * Load the original files registry from metadata.json, creating an empty one if it doesn't exist.
 * Migrates from legacy file-hashes.json if present.
 */
export async function loadOriginalFilesRegistry(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<OriginalFilesRegistry> {
    // Migration: check for legacy file-hashes.json and migrate to metadata.json
    await migrateFromLegacyFileHashes(workspaceFolder);

    const { MetadataManager } = await import('../../utils/metadataManager');
    const result = await MetadataManager.safeReadMetadata(workspaceFolder.uri);

    if (!result.success || !result.metadata) {
        return createEmptyRegistry();
    }

    const registry = (result.metadata as Record<string, unknown>)[ORIGINAL_FILES_HASHES_KEY] as OriginalFilesRegistry | undefined;
    if (!registry || typeof registry !== 'object') {
        return createEmptyRegistry();
    }

    // Ensure all required fields exist (migration safety)
    if (!registry.files) registry.files = {};
    if (!registry.fileNameToHash) registry.fileNameToHash = {};
    if (!registry.version) registry.version = 1;

    for (const entry of Object.values(registry.files)) {
        if (!entry.referencedBy) {
            entry.referencedBy = [];
        }
    }

    return registry;
}

function createEmptyRegistry(): OriginalFilesRegistry {
    return {
        version: 1,
        files: {},
        fileNameToHash: {},
    };
}

/**
 * Migrate from legacy file-hashes.json to metadata.json
 */
async function migrateFromLegacyFileHashes(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const legacyPath = vscode.Uri.joinPath(getOriginalsDir(workspaceFolder), 'file-hashes.json');
    try {
        const data = await vscode.workspace.fs.readFile(legacyPath);
        const registry = JSON.parse(new TextDecoder().decode(data)) as OriginalFilesRegistry;
        if (!registry.files) registry.files = {};
        if (!registry.fileNameToHash) registry.fileNameToHash = {};
        if (!registry.version) registry.version = 1;

        const { MetadataManager } = await import('../../utils/metadataManager');
        await MetadataManager.safeUpdateMetadata(workspaceFolder.uri, (metadata: Record<string, unknown>) => {
            metadata[ORIGINAL_FILES_HASHES_KEY] = registry;
            return metadata;
        });
        await vscode.workspace.fs.delete(legacyPath);
        console.log('[OriginalFiles] Migrated file-hashes.json to metadata.json');
    } catch {
        // No legacy file or migration already done
    }
}

/**
 * Save the original files registry to metadata.json
 */
export async function saveOriginalFilesRegistry(
    workspaceFolder: vscode.WorkspaceFolder,
    registry: OriginalFilesRegistry
): Promise<void> {
    const { MetadataManager } = await import('../../utils/metadataManager');
    const result = await MetadataManager.safeUpdateMetadata(workspaceFolder.uri, (metadata: Record<string, unknown>) => {
        metadata[ORIGINAL_FILES_HASHES_KEY] = registry;
        return metadata;
    });
    if (!result.success) {
        throw new Error(result.error || 'Failed to save original files registry');
    }
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
 * @param notebookBaseName Optional base name of the notebook referencing this file (e.g., "test-(uuid)")
 * @returns Result with the actual filename to use in metadata
 */
export async function saveOriginalFileWithDeduplication(
    workspaceFolder: vscode.WorkspaceFolder,
    requestedFileName: string,
    fileData: Uint8Array | ArrayBuffer | Buffer,
    notebookBaseName?: string
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

        // Ensure pointer exists for sync (in case it was saved before we wrote to pointers/)
        await ensureOriginalPointerExists(workspaceFolder, existingEntry.fileName);

        let registryChanged = false;

        // Track this original name if it's new
        if (!existingEntry.originalNames.includes(requestedFileName)) {
            existingEntry.originalNames.push(requestedFileName);
            registryChanged = true;
        }

        // Track notebook reference
        if (notebookBaseName && !existingEntry.referencedBy.includes(notebookBaseName)) {
            existingEntry.referencedBy.push(notebookBaseName);
            registryChanged = true;
        }

        if (registryChanged) {
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

    // Save the file to both files/ and pointers/ (pointers/ is committed for sync)
    const fileUri = vscode.Uri.joinPath(originalsDir, actualFileName);
    const pointersDir = getOriginalsPointersDir(workspaceFolder);
    await vscode.workspace.fs.createDirectory(pointersDir);

    const buffer = fileData instanceof ArrayBuffer
        ? new Uint8Array(fileData)
        : fileData instanceof Buffer
            ? new Uint8Array(fileData)
            : fileData;
    await vscode.workspace.fs.writeFile(fileUri, buffer);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(pointersDir, actualFileName), buffer);

    // Update registry
    registry.files[hash] = {
        hash,
        fileName: actualFileName,
        originalNames: [requestedFileName],
        referencedBy: notebookBaseName ? [notebookBaseName] : [],
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
 * Remove a notebook reference from the registry.
 * If no other notebooks reference the original file, deletes the file from disk and registry.
 * 
 * @param workspaceFolder The workspace folder
 * @param notebookBaseName The base name of the notebook being deleted (e.g., "test-(uuid)")
 * @param originalFileName The originalFileName from the notebook's metadata (points to file in originals/)
 * @returns Whether the original file was deleted from disk
 */
export async function removeNotebookReference(
    workspaceFolder: vscode.WorkspaceFolder,
    notebookBaseName: string,
    originalFileName?: string
): Promise<{ originalFileDeleted: boolean; fileName: string | null }> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);

    // Find the entry by originalFileName or by scanning referencedBy
    let targetHash: string | null = null;
    let targetEntry: OriginalFileEntry | null = null;

    if (originalFileName) {
        // Look up by filename first
        const hash = registry.fileNameToHash[originalFileName];
        if (hash && registry.files[hash]) {
            targetHash = hash;
            targetEntry = registry.files[hash];
        }
    }

    // If not found by filename, scan all entries for this notebook reference
    if (!targetEntry) {
        for (const [hash, entry] of Object.entries(registry.files)) {
            if (entry.referencedBy.includes(notebookBaseName)) {
                targetHash = hash;
                targetEntry = entry;
                break;
            }
        }
    }

    if (!targetEntry || !targetHash) {
        console.log(`[OriginalFiles] No registry entry found for notebook "${notebookBaseName}"`);
        return { originalFileDeleted: false, fileName: null };
    }

    // Remove this notebook from referencedBy
    targetEntry.referencedBy = targetEntry.referencedBy.filter(ref => ref !== notebookBaseName);
    console.log(`[OriginalFiles] Removed reference "${notebookBaseName}" from "${targetEntry.fileName}" (${targetEntry.referencedBy.length} references remaining)`);

    if (targetEntry.referencedBy.length === 0) {
        // No more references - delete the original file from both files/ and pointers/, and registry entry
        const fileUri = vscode.Uri.joinPath(getOriginalsDir(workspaceFolder), targetEntry.fileName);
        const pointerUri = vscode.Uri.joinPath(getOriginalsPointersDir(workspaceFolder), targetEntry.fileName);
        const deletedFileName = targetEntry.fileName;

        try {
            await vscode.workspace.fs.delete(fileUri);
            console.log(`[OriginalFiles] Deleted unreferenced original file: ${targetEntry.fileName}`);
        } catch (err) {
            console.warn(`[OriginalFiles] Could not delete original file "${targetEntry.fileName}": ${err}`);
        }
        try {
            await vscode.workspace.fs.delete(pointerUri);
        } catch {
            // Pointer may not exist (e.g. old files saved before we wrote to pointers/)
        }

        // Remove from registry
        delete registry.files[targetHash];
        delete registry.fileNameToHash[targetEntry.fileName];
        await saveOriginalFilesRegistry(workspaceFolder, registry);

        return { originalFileDeleted: true, fileName: deletedFileName };
    }

    // Still has references, just save the updated registry
    await saveOriginalFilesRegistry(workspaceFolder, registry);
    return { originalFileDeleted: false, fileName: targetEntry.fileName };
}

/**
 * Add a notebook reference to an existing registry entry (by originalFileName).
 * Used when the notebook base name isn't known at import time but is known after file creation.
 * 
 * @param workspaceFolder The workspace folder
 * @param originalFileName The originalFileName stored in metadata
 * @param notebookBaseName The base name of the notebook (e.g., "test-(uuid)")
 */
export async function addNotebookReference(
    workspaceFolder: vscode.WorkspaceFolder,
    originalFileName: string,
    notebookBaseName: string
): Promise<void> {
    const registry = await loadOriginalFilesRegistry(workspaceFolder);

    const hash = registry.fileNameToHash[originalFileName];
    if (!hash || !registry.files[hash]) {
        console.warn(`[OriginalFiles] Cannot add reference: no registry entry for "${originalFileName}"`);
        return;
    }

    const entry = registry.files[hash];
    if (!entry.referencedBy.includes(notebookBaseName)) {
        entry.referencedBy.push(notebookBaseName);
        await saveOriginalFilesRegistry(workspaceFolder, registry);
        console.log(`[OriginalFiles] Added reference "${notebookBaseName}" to "${originalFileName}" (${entry.referencedBy.length} total)`);
    }
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
