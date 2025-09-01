import * as vscode from 'vscode';
import * as path from 'path';
import {
    DocumentStructureMetadata,
    deserializeDocumentStructure,
    reconstructDocument,
    validateRoundTrip
} from '../../webviews/codex-webviews/src/NewSourceUploader/utils/documentStructurePreserver';
import { CodexNotebookAsJSONData } from '../../types';

/**
 * Reads a .codex notebook from disk and parses its JSON content
 */
async function readCodexNotebookFromUri(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
}

/**
 * Exports a Codex notebook back to its original document format with structure preserved
 */
export async function exportWithOriginalStructure(
    codexFileUri: vscode.Uri,
    outputPath: string,
    options?: {
        validateBeforeExport?: boolean;
        preserveInlineMarkup?: boolean;
    }
): Promise<void> {
    try {
        // Read the codex notebook
        const codexNotebook = await readCodexNotebookFromUri(codexFileUri);

        // Get the corresponding source notebook to access structure metadata
        const sourceFileName = path.basename(codexFileUri.fsPath).replace('.codex', '.source');
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(codexFileUri);
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const sourceFileUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            '.project',
            'sourceTexts',
            sourceFileName
        );

        const sourceNotebook = await readCodexNotebookFromUri(sourceFileUri);

        // Extract document structure metadata
        const notebookMetadata = sourceNotebook.metadata as any;
        if (!notebookMetadata?.documentStructure) {
            throw new Error('No document structure metadata found. This file may not support structure-preserved export.');
        }

        const structureMetadata = deserializeDocumentStructure(
            notebookMetadata.documentStructure
        );

        // Build map of updated segments from codex cells
        const updatedSegments = new Map<string, string>();

        for (const cell of codexNotebook.cells) {
            const metadata = cell.metadata as any;
            if (cell.kind === 2 && metadata?.id) { // vscode.NotebookCellKind.Code
                const cellId = metadata.id;
                let cellContent = cell.value.trim();

                // If cell has original structure data, use it for validation
                if (metadata?.data?.originalContent) {
                    // Handle inline markup preservation
                    if (options?.preserveInlineMarkup) {
                        cellContent = preserveInlineMarkupChanges(
                            metadata.data.originalContent,
                            cellContent
                        );
                    }
                }

                updatedSegments.set(cellId, cellContent);
            }
        }

        // Reconstruct the document with updated content
        const reconstructedDocument = reconstructDocument(
            structureMetadata.structureTree!,
            updatedSegments
        );

        // Validate if requested
        if (options?.validateBeforeExport) {
            const validation = await validateRoundTrip(
                await getOriginalContent(structureMetadata),
                reconstructedDocument,
                {
                    whitespaceNormalization: true,
                    selfClosingTags: true,
                    attributeOrder: true
                }
            );

            if (!validation.isValid) {
                const proceed = await vscode.window.showWarningMessage(
                    `Document reconstruction validation failed (${Math.round(validation.similarity * 100)}% similarity). Continue with export?`,
                    'Yes',
                    'No',
                    'Show Differences'
                );

                if (proceed === 'Show Differences') {
                    // Show differences in output channel
                    const outputChannel = vscode.window.createOutputChannel('Document Structure Export');
                    outputChannel.appendLine('=== Validation Differences ===');
                    validation.differences?.forEach(diff => outputChannel.appendLine(diff));
                    outputChannel.show();

                    const proceedAfterReview = await vscode.window.showWarningMessage(
                        'Review the differences. Continue with export?',
                        'Yes',
                        'No'
                    );

                    if (proceedAfterReview !== 'Yes') {
                        throw new Error('Export cancelled by user');
                    }
                } else if (proceed !== 'Yes') {
                    throw new Error('Export cancelled by user');
                }
            }
        }

        // Convert HTML back to DOCX if original was DOCX
        if (structureMetadata.originalMimeType.includes('wordprocessingml')) {
            await exportToDocx(reconstructedDocument, outputPath);
        } else {
            // For other formats, save as HTML
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(outputPath),
                Buffer.from(reconstructedDocument, 'utf-8')
            );
        }

        vscode.window.showInformationMessage(
            `Successfully exported document with original structure to ${outputPath}`
        );

    } catch (error) {
        console.error('Error exporting with original structure:', error);
        vscode.window.showErrorMessage(`Export failed: ${error}`);
        throw error;
    }
}

/**
 * Preserves inline markup changes while maintaining structure
 */
function preserveInlineMarkupChanges(
    originalContent: string,
    modifiedContent: string
): string {
    // This function attempts to preserve user's inline markup changes
    // while maintaining the overall structure

    // Remove all HTML tags for comparison
    const stripTags = (html: string) => html.replace(/<[^>]*>/g, '');
    const originalText = stripTags(originalContent);
    const modifiedText = stripTags(modifiedContent);

    // If the text content is the same, return the modified version with its markup
    if (originalText === modifiedText) {
        return modifiedContent;
    }

    // If text has changed, try to preserve structure while applying changes
    // This is a simplified approach - a more sophisticated diff algorithm
    // could be used for better results

    // Extract the outer structure from original
    const structureMatch = originalContent.match(/^(<[^>]+>)(.*?)(<\/[^>]+>)$/);
    if (structureMatch) {
        const [, openTag, , closeTag] = structureMatch;
        // Wrap modified content in original structure
        return `${openTag}${modifiedContent}${closeTag}`;
    }

    // If no clear structure, return modified content as-is
    return modifiedContent;
}

/**
 * Gets the original content from attachments
 */
async function getOriginalContent(
    structureMetadata: DocumentStructureMetadata
): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error('No workspace folder found');
    }

    const originalFileUri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.project',
        structureMetadata.originalFileRef
    );

    try {
        const fileData = await vscode.workspace.fs.readFile(originalFileUri);
        // For DOCX files, we'd need to extract the HTML from the binary
        // For now, reconstruct from segments
        return Array.from(structureMetadata.segments.values())
            .map(segment => segment.originalContent)
            .join('');
    } catch (error) {
        console.warn('Could not read original file, using segment data', error);
        return Array.from(structureMetadata.segments.values())
            .map(segment => segment.originalContent)
            .join('');
    }
}

/**
 * Exports HTML content back to DOCX format
 */
async function exportToDocx(
    htmlContent: string,
    outputPath: string
): Promise<void> {
    // This would require a library like html-docx-js or similar
    // For now, we'll save as HTML and note that DOCX conversion is needed

    const htmlPath = outputPath.replace('.docx', '.html');
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(htmlPath),
        Buffer.from(htmlContent, 'utf-8')
    );

    vscode.window.showInformationMessage(
        `Exported as HTML to ${htmlPath}. DOCX conversion requires additional tooling.`
    );
}

/**
 * Command to export current document with structure preservation
 */
export async function exportCurrentDocumentWithStructure(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('No active document');
        return;
    }

    const documentUri = activeEditor.document.uri;
    if (!documentUri.fsPath.endsWith('.codex')) {
        vscode.window.showErrorMessage('Current document is not a Codex file');
        return;
    }

    // Let user choose output location
    const outputUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
            documentUri.fsPath.replace('.codex', '_exported.html')
        ),
        filters: {
            'HTML files': ['html'],
            'Word documents': ['docx'],
            'All files': ['*']
        }
    });

    if (!outputUri) {
        return;
    }

    // Ask about validation
    const validate = await vscode.window.showQuickPick(
        ['Yes', 'No'],
        {
            placeHolder: 'Validate document reconstruction before export?'
        }
    );

    await exportWithOriginalStructure(
        documentUri,
        outputUri.fsPath,
        {
            validateBeforeExport: validate === 'Yes',
            preserveInlineMarkup: true
        }
    );
}
