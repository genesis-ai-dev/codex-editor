import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface MigrationResult {
    renamedFiles: string[];
    updatedCodexFiles: string[];
    errors: string[];
}

interface FileRenameOperation {
    oldPath: string;
    newPath: string;
    type: 'file' | 'pointer';
    bookSegment: string;
}

interface ValidationResult {
    isValid: boolean;
    operations: FileRenameOperation[];
    issues: string[];
    affectedCodexFiles: Set<string>;
}

/**
 * Validates the migration by checking all files exist and can be renamed
 * Returns a plan of operations to execute
 */
async function validateMigration(
    workspaceRoot: string,
    xm4aFiles: vscode.Uri[]
): Promise<ValidationResult> {
    const validation: ValidationResult = {
        isValid: true,
        operations: [],
        issues: [],
        affectedCodexFiles: new Set()
    };

    const seenNewPaths = new Set<string>();

    // Group files by book segment to ensure files/pointers match
    const filesBySegment = new Map<string, { files: string[], pointers: string[]; }>();

    for (const xm4aFile of xm4aFiles) {
        const oldPath = xm4aFile.fsPath;
        const newPath = oldPath.replace(/\.x-m4a$/, '.m4a');
        const relativePath = path.relative(workspaceRoot, oldPath);

        // Check if file actually exists
        try {
            await vscode.workspace.fs.stat(xm4aFile);
        } catch {
            validation.issues.push(`File not found: ${relativePath}`);
            validation.isValid = false;
            continue;
        }

        // Check if destination already exists
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
            validation.issues.push(`Destination already exists: ${newPath}`);
            validation.isValid = false;
            continue;
        } catch {
            // Good - destination doesn't exist
        }

        // Check for duplicate destinations (shouldn't happen, but be safe)
        if (seenNewPaths.has(newPath)) {
            validation.issues.push(`Duplicate destination path: ${newPath}`);
            validation.isValid = false;
            continue;
        }
        seenNewPaths.add(newPath);

        // Determine type and book segment
        const isPointer = relativePath.includes('attachments/pointers/');
        const isFile = relativePath.includes('attachments/files/');

        if (!isPointer && !isFile) {
            validation.issues.push(`File not in expected location: ${relativePath}`);
            validation.isValid = false;
            continue;
        }

        // Extract book segment (e.g., "GEN", "MAT")
        const segmentMatch = relativePath.match(/attachments\/(?:files|pointers)\/([^/]+)\//);
        const bookSegment = segmentMatch ? segmentMatch[1] : 'UNKNOWN';

        // Track files by segment
        if (!filesBySegment.has(bookSegment)) {
            filesBySegment.set(bookSegment, { files: [], pointers: [] });
        }
        const segmentGroup = filesBySegment.get(bookSegment)!;

        if (isFile) {
            segmentGroup.files.push(path.basename(oldPath));
        } else {
            segmentGroup.pointers.push(path.basename(oldPath));
        }

        validation.operations.push({
            oldPath,
            newPath,
            type: isFile ? 'file' : 'pointer',
            bookSegment
        });
    }

    // Check that files and pointers are matched
    for (const [segment, group] of filesBySegment) {
        const fileSet = new Set(group.files);
        const pointerSet = new Set(group.pointers);

        // Check for files without pointers
        for (const file of group.files) {
            if (!pointerSet.has(file)) {
                validation.issues.push(`File without pointer: ${segment}/${file}`);
            }
        }

        // Check for pointers without files
        for (const pointer of group.pointers) {
            if (!fileSet.has(pointer)) {
                validation.issues.push(`Pointer without file: ${segment}/${pointer}`);
            }
        }
    }

    // Find all .codex files that reference .x-m4a
    const codexPattern = new vscode.RelativePattern(workspaceRoot, '**/*.codex');
    const codexFiles = await vscode.workspace.findFiles(codexPattern);

    for (const codexUri of codexFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(codexUri);
            const content = document.getText();

            if (content.includes('.x-m4a')) {
                validation.affectedCodexFiles.add(codexUri.fsPath);
            }
        } catch (error) {
            validation.issues.push(`Cannot read .codex file: ${codexUri.fsPath}`);
            validation.isValid = false;
        }
    }

    return validation;
}

/**
 * Migrates .x-m4a audio files to .m4a format
 * - VALIDATES everything first (atomic check)
 * - Renames physical files in attachments/files and attachments/pointers
 * - Updates .codex file metadata references
 * - Uses git mv to preserve LFS tracking
 */
export async function migrateXM4aFiles(): Promise<MigrationResult> {
    const result: MigrationResult = {
        renamedFiles: [],
        updatedCodexFiles: [],
        errors: []
    };

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder found');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const attachmentsRoot = path.join(workspaceRoot, '.project', 'attachments');

    // Check if this is a git repository with LFS
    let isGitRepo = false;
    let hasLFS = false;
    try {
        await execAsync('git rev-parse --git-dir', { cwd: workspaceRoot });
        isGitRepo = true;

        // Check if git-lfs is available
        try {
            await execAsync('git lfs version', { cwd: workspaceRoot });
            hasLFS = true;
        } catch {
            console.log('Git LFS not detected, will use regular file rename');
        }
    } catch {
        console.log('Not a git repository, will use regular file rename');
    }

    // Find all .x-m4a files in attachments
    const xm4aFiles: vscode.Uri[] = [];

    try {
        // Search in files directory
        const filesPattern = new vscode.RelativePattern(attachmentsRoot, 'files/**/*.x-m4a');
        const filesUris = await vscode.workspace.findFiles(filesPattern);
        xm4aFiles.push(...filesUris);

        // Search in pointers directory
        const pointersPattern = new vscode.RelativePattern(attachmentsRoot, 'pointers/**/*.x-m4a');
        const pointersUris = await vscode.workspace.findFiles(pointersPattern);
        xm4aFiles.push(...pointersUris);
    } catch (error) {
        result.errors.push(`Error finding .x-m4a files: ${error}`);
        return result;
    }

    if (xm4aFiles.length === 0) {
        vscode.window.showInformationMessage('No .x-m4a files found to migrate');
        return result;
    }

    // PHASE 1: VALIDATION - Check everything before making ANY changes
    const validation = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Validating migration...',
            cancellable: false
        },
        async () => {
            return await validateMigration(workspaceRoot, xm4aFiles);
        }
    );

    // Report validation issues
    if (!validation.isValid || validation.issues.length > 0) {
        const issueList = validation.issues.join('\n  - ');
        const message = `Migration validation failed:\n  - ${issueList}`;

        vscode.window.showErrorMessage(
            'Cannot migrate: validation failed. See output for details.',
            'Show Details'
        ).then(choice => {
            if (choice === 'Show Details') {
                const outputChannel = vscode.window.createOutputChannel('Audio Migration Validation');
                outputChannel.appendLine('=== Migration Validation Failed ===\n');
                outputChannel.appendLine('Issues found:');
                validation.issues.forEach(issue => outputChannel.appendLine(`  ❌ ${issue}`));
                outputChannel.appendLine(`\nTotal operations planned: ${validation.operations.length}`);
                outputChannel.appendLine(`Affected .codex files: ${validation.affectedCodexFiles.size}`);
                outputChannel.show();
            }
        });

        result.errors.push(...validation.issues);
        return result;
    }

    // Show migration plan to user
    const planMessage = [
        `Found ${validation.operations.length} file(s) to rename`,
        `Will update ${validation.affectedCodexFiles.size} .codex file(s)`,
        '',
        'All validations passed. Ready to migrate.'
    ].join('\n');

    console.log('Migration plan:', planMessage);

    // PHASE 2: EXECUTION - Now perform the migration atomically
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Migrating .x-m4a files to .m4a',
            cancellable: false
        },
        async (progress) => {
            const totalSteps = validation.operations.length + validation.affectedCodexFiles.size;
            let currentStep = 0;

            // Track what we've done for potential rollback
            const completedOperations: FileRenameOperation[] = [];

            try {
                // Step 1: Rename physical files using the validated plan
                for (const operation of validation.operations) {
                    currentStep++;
                    progress.report({
                        message: `Renaming ${operation.type} ${currentStep}/${validation.operations.length}`,
                        increment: (50 / totalSteps)
                    });

                    const relativePath = path.relative(workspaceRoot, operation.oldPath);

                    try {
                        if (isGitRepo && hasLFS) {
                            // Use git mv to preserve LFS tracking
                            const relativeOldPath = path.relative(workspaceRoot, operation.oldPath);
                            const relativeNewPath = path.relative(workspaceRoot, operation.newPath);

                            await execAsync(
                                `git mv "${relativeOldPath}" "${relativeNewPath}"`,
                                { cwd: workspaceRoot }
                            );
                            console.log(`Git moved: ${relativeOldPath} -> ${relativeNewPath}`);
                        } else {
                            // Regular file rename
                            const oldUri = vscode.Uri.file(operation.oldPath);
                            const newUri = vscode.Uri.file(operation.newPath);
                            await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });
                            console.log(`Renamed: ${relativePath}`);
                        }

                        result.renamedFiles.push(relativePath);
                        completedOperations.push(operation);
                    } catch (error) {
                        // Critical error during rename - try to rollback
                        const errorMsg = `Failed to rename ${relativePath}: ${error}`;
                        console.error(errorMsg);
                        result.errors.push(errorMsg);

                        // Attempt rollback of completed operations
                        await attemptRollback(workspaceRoot, completedOperations, isGitRepo, hasLFS);
                        throw new Error(`Migration aborted: ${errorMsg}`);
                    }
                }

                // Step 2: Update .codex file metadata (only if all renames succeeded)
                for (const codexPath of validation.affectedCodexFiles) {
                    currentStep++;
                    progress.report({
                        message: 'Updating .codex references',
                        increment: (50 / totalSteps)
                    });

                    try {
                        await updateSingleCodexFile(codexPath, result);
                    } catch (error) {
                        const errorMsg = `Error updating ${codexPath}: ${error}`;
                        console.error(errorMsg);
                        result.errors.push(errorMsg);
                        // Don't rollback file renames for .codex update errors
                        // User can manually fix or re-run migration
                    }
                }

                return result;
            } catch (error) {
                // Critical error occurred and rollback attempted
                result.errors.push(`Migration failed and rollback attempted: ${error}`);
                throw error;
            }
        }
    );
}

/**
 * Updates a single .codex file to change .x-m4a references to .m4a
 */
async function updateSingleCodexFile(
    codexPath: string,
    result: MigrationResult
): Promise<void> {
    const codexUri = vscode.Uri.file(codexPath);
    const document = await vscode.workspace.openTextDocument(codexUri);
    const content = document.getText();

    // Double-check it still has .x-m4a references
    if (!content.includes('.x-m4a')) {
        return;
    }

    // Parse the notebook
    let notebook: any;
    try {
        notebook = JSON.parse(content);
    } catch {
        throw new Error(`Failed to parse ${codexPath}`);
    }

    let modified = false;

    // Update attachment URLs in cells
    if (notebook.cells && Array.isArray(notebook.cells)) {
        for (const cell of notebook.cells) {
            if (cell.metadata?.attachments) {
                const attachments = cell.metadata.attachments;

                for (const [key, attachment] of Object.entries(attachments)) {
                    if (attachment && typeof attachment === 'object' && 'url' in attachment) {
                        const url = (attachment as any).url;
                        if (typeof url === 'string' && url.endsWith('.x-m4a')) {
                            (attachment as any).url = url.replace(/\.x-m4a$/, '.m4a');
                            modified = true;
                        }
                    }
                }
            }
        }
    }

    if (modified) {
        // Write the updated content
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(content.length)
        );
        edit.replace(codexUri, fullRange, JSON.stringify(notebook, null, 2));

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            await document.save();
            result.updatedCodexFiles.push(codexPath);
            console.log(`Updated references in: ${codexPath}`);
        } else {
            throw new Error(`Failed to apply edit to ${codexPath}`);
        }
    }
}

/**
 * Attempts to rollback file renames if migration fails
 */
async function attemptRollback(
    workspaceRoot: string,
    completedOperations: FileRenameOperation[],
    isGitRepo: boolean,
    hasLFS: boolean
): Promise<void> {
    console.error('Migration failed, attempting rollback...');

    for (const operation of completedOperations.reverse()) {
        try {
            if (isGitRepo && hasLFS) {
                const relativeNewPath = path.relative(workspaceRoot, operation.newPath);
                const relativeOldPath = path.relative(workspaceRoot, operation.oldPath);

                await execAsync(
                    `git mv "${relativeNewPath}" "${relativeOldPath}"`,
                    { cwd: workspaceRoot }
                );
                console.log(`Rolled back: ${relativeNewPath} -> ${relativeOldPath}`);
            } else {
                const newUri = vscode.Uri.file(operation.newPath);
                const oldUri = vscode.Uri.file(operation.oldPath);
                await vscode.workspace.fs.rename(newUri, oldUri, { overwrite: false });
                console.log(`Rolled back: ${operation.newPath}`);
            }
        } catch (rollbackError) {
            console.error(`Failed to rollback ${operation.newPath}:`, rollbackError);
            // Continue trying to rollback other files
        }
    }
}

/**
 * Shows the migration results to the user
 */
export function showMigrationResults(result: MigrationResult): void {
    const messages: string[] = [];

    if (result.renamedFiles.length > 0) {
        messages.push(`✅ Renamed ${result.renamedFiles.length} audio file(s)`);
    }

    if (result.updatedCodexFiles.length > 0) {
        messages.push(`✅ Updated ${result.updatedCodexFiles.length} .codex file(s)`);
    }

    if (result.errors.length > 0) {
        messages.push(`⚠️ ${result.errors.length} error(s) occurred`);
    }

    const summary = messages.join('\n');

    if (result.errors.length > 0) {
        vscode.window.showWarningMessage(
            `Audio migration completed with errors:\n${summary}`,
            'Show Details'
        ).then(selection => {
            if (selection === 'Show Details') {
                const outputChannel = vscode.window.createOutputChannel('Audio Migration');
                outputChannel.appendLine('=== Audio Migration Results ===\n');
                outputChannel.appendLine(`Renamed Files (${result.renamedFiles.length}):`);
                result.renamedFiles.forEach(file => outputChannel.appendLine(`  - ${file}`));
                outputChannel.appendLine(`\nUpdated .codex Files (${result.updatedCodexFiles.length}):`);
                result.updatedCodexFiles.forEach(file => outputChannel.appendLine(`  - ${file}`));
                outputChannel.appendLine(`\nErrors (${result.errors.length}):`);
                result.errors.forEach(error => outputChannel.appendLine(`  ❌ ${error}`));
                outputChannel.show();
            }
        });
    } else {
        vscode.window.showInformationMessage(
            `Audio migration completed successfully!\n${summary}`
        );
    }
}

