import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    generateCellId,
    createProcessedCell,
    createNotebookPair,
    validateFileExtension,
    splitContentIntoSegments,
} from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';

const SUPPORTED_EXTENSIONS = ['md', 'markdown'];

/**
 * Validates a Markdown file
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .md or .markdown extension');
    }

    // Check file size (warn if > 10MB)
    if (file.size > 10 * 1024 * 1024) {
        warnings.push('Large markdown files may take longer to process');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'markdown',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses a Markdown file
 */
const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading Markdown file...', 'processing', 20));

        const text = await file.text();

        onProgress?.(createProgress('Parsing Markdown', 'Parsing Markdown structure...', 'processing', 50));

        // Split markdown into sections (by headers or double line breaks)
        const segments = splitContentIntoSegments(text, 'sections');

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 'processing', 80));

        // Convert each segment to a cell
        const cells = await Promise.all(
            segments.map(async (segment, index) => {
                const cellId = generateCellId('markdown', index);

                // Convert markdown to HTML (placeholder - would use a real markdown parser)
                const htmlContent = convertMarkdownToHtml(segment);
                const cell = createProcessedCell(cellId, htmlContent);

                // Extract images from markdown/HTML
                const images = await extractImagesFromHtml(htmlContent);
                cell.images = images;

                return cell;
            })
        );

        // Create notebook pair
        const notebookPair = createNotebookPair(
            file.name,
            cells,
            'markdown',
            {
                segmentCount: segments.length,
            }
        );

        onProgress?.(createProgress('Complete', 'Markdown processing complete', 'complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                segmentCount: cells.length,
                imageCount: cells.reduce((count, cell) => count + cell.images.length, 0),
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process Markdown file', 'error', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Simple markdown to HTML converter (placeholder)
 * In a real implementation, you'd use a library like marked or remark
 */
const convertMarkdownToHtml = (markdown: string): string => {
    return markdown
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2" />')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(.+)$/gm, '<p>$1</p>')
        .replace(/<p><\/p>/g, '')
        .replace(/<p><h([1-6])>/g, '<h$1>')
        .replace(/<\/h([1-6])><\/p>/g, '</h$1>');
};

/**
 * Markdown Importer Plugin
 */
export const markdownImporter: ImporterPlugin = {
    name: 'Markdown Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: 'Imports Markdown files with section-based splitting',
    validateFile,
    parseFile,
}; 