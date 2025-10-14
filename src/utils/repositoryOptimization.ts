import * as vscode from 'vscode';

/**
 * Global lock to prevent concurrent optimization operations
 * Key: workspace path, Value: Promise representing the ongoing optimization
 */
const optimizationLocks = new Map<string, Promise<void>>();

/**
 * Optimizes the current workspace repository by packing git objects
 * This consolidates loose objects and multiple pack files to improve performance
 * Especially useful when sync operations are slow due to fragmented object storage
 * 
 * @param workspacePath - Optional workspace path, defaults to current workspace
 * @returns Promise that resolves when packing is complete
 */
export async function optimizeRepository(workspacePath?: string): Promise<void> {
    const dir = workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!dir) {
        throw new Error('No workspace folder available for optimization');
    }

    // Check if optimization is already in progress for this workspace
    const existingLock = optimizationLocks.get(dir);
    if (existingLock) {
        console.log('[RepositoryOptimization] Optimization already in progress, waiting for completion...');
        // Wait for the existing optimization to complete
        await existingLock;
        return;
    }

    // Create a new lock for this optimization operation
    const optimizationPromise = (async () => {
        try {
            // Get the Frontier API
            const frontierExtension = vscode.extensions.getExtension('frontier-rnd.frontier-authentication');
            if (!frontierExtension) {
                throw new Error('Frontier Authentication extension is not installed');
            }

            if (!frontierExtension.isActive) {
                await frontierExtension.activate();
            }

            const frontierApi = frontierExtension.exports;
            if (!frontierApi || !frontierApi.packRepository) {
                throw new Error('Frontier Authentication extension does not support repository packing (update required)');
            }

            // Call the pack function with silent mode (no UI notifications, only console logs)
            await frontierApi.packRepository(workspacePath, true);
        } finally {
            // Always remove the lock when done (success or failure)
            optimizationLocks.delete(dir);
        }
    })();

    // Store the lock
    optimizationLocks.set(dir, optimizationPromise);

    // Wait for completion
    await optimizationPromise;
}

/**
 * Checks if a repository optimization is currently in progress
 * 
 * @param workspacePath - Optional workspace path, defaults to current workspace
 * @returns True if optimization is running for this workspace
 */
export function isOptimizationInProgress(workspacePath?: string): boolean {
    const dir = workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!dir) {
        return false;
    }
    return optimizationLocks.has(dir);
}

/**
 * Cleans up stale temporary files and orphaned pack files from interrupted pack operations
 * This handles cases where optimization was interrupted (power failure, crash, etc.)
 * 
 * Three types of cleanup:
 * 1. Temporary files (tmp_pack_*, tmp_idx_*, .tmp-*) - Always safe to remove
 * 2. Orphaned pack files (*.pack without *.idx) - Incomplete/unusable by Git
 * 3. Orphaned index files (*.idx without *.pack) - Leftover metadata
 * 
 * @param workspacePath - Optional workspace path, defaults to current workspace
 */
export async function cleanupStalePackFiles(workspacePath?: string): Promise<void> {
    const path = await import('path');
    const dir = workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!dir) {
        return;
    }

    try {
        const packDir = path.join(dir, '.git', 'objects', 'pack');
        const packUri = vscode.Uri.file(packDir);

        try {
            const files = await vscode.workspace.fs.readDirectory(packUri);
            const fileNames = files.map(([name]) => name);

            // 1. Remove temporary files (tmp_pack_*, tmp_idx_*, .tmp-*)
            const tempFiles = fileNames.filter(name =>
                name.startsWith('tmp_') ||
                name.startsWith('.tmp-')
            );

            if (tempFiles.length > 0) {
                console.log(`[RepositoryOptimization] Found ${tempFiles.length} temporary files, cleaning up...`);

                for (const filename of tempFiles) {
                    try {
                        const fileUri = vscode.Uri.file(path.join(packDir, filename));
                        await vscode.workspace.fs.delete(fileUri);
                        console.log(`[RepositoryOptimization] Removed temp file: ${filename}`);
                    } catch (err) {
                        console.warn(`[RepositoryOptimization] Could not remove ${filename}:`, err);
                    }
                }
            }

            // 2. Find and remove orphaned pack files (*.pack without corresponding *.idx)
            // These are created when power fails between packObjects() and indexPack()
            const packFiles = fileNames.filter(name => name.endsWith('.pack'));
            const idxFiles = new Set(fileNames.filter(name => name.endsWith('.idx')));

            const orphanedPacks: string[] = [];
            for (const packFile of packFiles) {
                const expectedIdxFile = packFile.replace('.pack', '.idx');
                if (!idxFiles.has(expectedIdxFile)) {
                    orphanedPacks.push(packFile);
                }
            }

            if (orphanedPacks.length > 0) {
                console.warn(`[RepositoryOptimization] Found ${orphanedPacks.length} orphaned pack files (missing .idx), removing...`);

                for (const packFile of orphanedPacks) {
                    try {
                        const fileUri = vscode.Uri.file(path.join(packDir, packFile));
                        await vscode.workspace.fs.delete(fileUri);
                        console.log(`[RepositoryOptimization] Removed orphaned pack: ${packFile}`);
                    } catch (err) {
                        console.warn(`[RepositoryOptimization] Could not remove ${packFile}:`, err);
                    }
                }
            }

            // 3. Find and remove orphaned index files (*.idx without corresponding *.pack)
            // These are rare but can happen if pack file is manually deleted
            const packFilesSet = new Set(packFiles);
            const orphanedIdxFiles: string[] = [];

            for (const idxFile of idxFiles) {
                const expectedPackFile = idxFile.replace('.idx', '.pack');
                if (!packFilesSet.has(expectedPackFile)) {
                    orphanedIdxFiles.push(idxFile);
                }
            }

            if (orphanedIdxFiles.length > 0) {
                console.warn(`[RepositoryOptimization] Found ${orphanedIdxFiles.length} orphaned index files (missing .pack), removing...`);

                for (const idxFile of orphanedIdxFiles) {
                    try {
                        const fileUri = vscode.Uri.file(path.join(packDir, idxFile));
                        await vscode.workspace.fs.delete(fileUri);
                        console.log(`[RepositoryOptimization] Removed orphaned index: ${idxFile}`);
                    } catch (err) {
                        console.warn(`[RepositoryOptimization] Could not remove ${idxFile}:`, err);
                    }
                }
            }

            // Summary log
            const totalCleaned = tempFiles.length + orphanedPacks.length + orphanedIdxFiles.length;
            if (totalCleaned > 0) {
                console.log(`[RepositoryOptimization] Cleanup complete: removed ${totalCleaned} stale/orphaned files`);
            }
        } catch (err) {
            // Pack directory might not exist yet, that's fine
            return;
        }
    } catch (error) {
        // Non-critical operation, just log if something goes wrong
        console.warn('[RepositoryOptimization] Error during stale file cleanup:', error);
    }
}

/**
 * Checks if a repository needs optimization by analyzing pack file count and loose objects
 * Returns true if there are more than 10 pack files OR more than 50 loose objects
 * 
 * @param workspacePath - Optional workspace path, defaults to current workspace
 * @returns Promise that resolves to true if optimization is recommended
 */
export async function shouldOptimizeRepository(workspacePath?: string): Promise<boolean> {
    const path = await import('path');
    const dir = workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!dir) {
        return false;
    }

    try {
        const packDir = path.join(dir, '.git', 'objects', 'pack');
        const packUri = vscode.Uri.file(packDir);
        const files = await vscode.workspace.fs.readDirectory(packUri);

        // Count pack files (*.pack)
        const packFiles = files.filter(([name]) => name.endsWith('.pack'));

        // Recommend optimization if more than 10 pack files
        if (packFiles.length > 10) {
            return true;
        }

        // Also check loose object count
        const objectsDir = path.join(dir, '.git', 'objects');
        const objectsUri = vscode.Uri.file(objectsDir);
        const objectsDirs = await vscode.workspace.fs.readDirectory(objectsUri);

        let looseObjectCount = 0;
        for (const [name, type] of objectsDirs) {
            // Skip special directories
            if (name === 'pack' || name === 'info' || name.length !== 2 || type !== vscode.FileType.Directory) {
                continue;
            }

            const subdirUri = vscode.Uri.file(path.join(objectsDir, name));
            try {
                const files = await vscode.workspace.fs.readDirectory(subdirUri);
                looseObjectCount += files.filter(([fname]) => fname.length === 38).length;
            } catch {
                continue;
            }
        }

        // Recommend optimization if more than 50 loose objects
        return looseObjectCount > 50;
    } catch (error) {
        // If we can't read the directories, don't recommend optimization
        return false;
    }
}

/**
 * Automatically optimize repository if needed
 * This can be called during startup or before sync operations
 * 
 * IMPORTANT: Always runs cleanup first to handle interrupted operations from previous runs
 * 
 * @param workspacePath - Optional workspace path, defaults to current workspace
 * @param silent - If true, don't show any UI messages (defaults to true)
 * @returns Promise that resolves to true if optimization was performed
 */
export async function autoOptimizeIfNeeded(workspacePath?: string, silent: boolean = true): Promise<boolean> {
    try {
        // ALWAYS clean up stale files first (handles power failures, crashes, etc.)
        // This ensures we don't have orphaned pack files or temp files before checking thresholds
        await cleanupStalePackFiles(workspacePath);

        const needsOptimization = await shouldOptimizeRepository(workspacePath);

        if (!needsOptimization) {
            return false;
        }

        if (!silent) {
            vscode.window.showInformationMessage('Optimizing repository to improve sync performance...');
        }

        await optimizeRepository(workspacePath);

        if (!silent) {
            vscode.window.showInformationMessage('Repository optimized successfully!');
        }

        return true;
    } catch (error) {
        console.error('Error during auto-optimization:', error);
        return false;
    }
}

