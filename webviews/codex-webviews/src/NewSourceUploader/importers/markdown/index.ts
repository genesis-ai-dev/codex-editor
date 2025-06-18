import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
    splitContentIntoSegments,
} from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
import { marked } from 'marked';

const SUPPORTED_EXTENSIONS = ['md', 'markdown'];

/**
 * Validates a Markdown file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
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

    // Basic content validation
    try {
        const content = await file.text();

        if (content.trim().length === 0) {
            errors.push('File appears to be empty');
        }

        // Check for markdown characteristics
        const hasMarkdownSyntax = /#{1,6}\s/.test(content) ||
            /\*\*.*?\*\*/.test(content) ||
            /\*.*?\*/.test(content) ||
            /\[.*?\]\(.*?\)/.test(content);

        if (!hasMarkdownSyntax) {
            warnings.push('File does not appear to contain markdown syntax - consider using plaintext importer');
        }

        // Check for potential USFM content
        if (content.includes('\\v ') || content.includes('\\c ')) {
            warnings.push('File appears to contain USFM markers - consider using USFM importer instead');
        }

    } catch (error) {
        errors.push('Could not read file content');
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
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading Markdown file...', 20));

        const text = await file.text();

        onProgress?.(createProgress('Parsing Markdown', 'Parsing Markdown structure...', 30));

        // Configure marked for consistent parsing
        marked.setOptions({
            gfm: true, // GitHub Flavored Markdown
            breaks: false,
        });

        // Split markdown into sections (by headers or double line breaks)
        const segments = splitContentIntoSegments(text, 'sections');

        if (segments.length === 0) {
            throw new Error('No content segments could be extracted from the markdown file');
        }

        onProgress?.(createProgress('Converting to HTML', 'Converting markdown to HTML...', 60));

        // Convert each segment to a cell
        const cells = await Promise.all(
            segments.map(async (segment, index) => {
                const cellId = createStandardCellId(file.name, 1, index + 1);

                // Convert markdown to HTML using marked library
                const htmlContent = await marked.parse(segment);

                // Create cell with metadata about the segment
                const cell = createProcessedCell(cellId, htmlContent, {
                    type: 'markdown',
                    segmentIndex: index,
                    originalMarkdown: segment,
                    // Detect if this segment has a heading
                    hasHeading: /^#{1,6}\s/.test(segment.trimStart()),
                    // Extract heading text if present
                    headingText: segment.match(/^#{1,6}\s(.*)$/m)?.[1],
                });

                // Extract images from the converted HTML
                const images = await extractImagesFromHtml(htmlContent);
                cell.images = images;

                return cell;
            })
        );

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pair...', 85));

        // Analyze content for metadata
        const headingCount = cells.filter(cell => cell.metadata?.hasHeading).length;
        const imageCount = cells.reduce((count, cell) => count + cell.images.length, 0);
        const wordCount = segments.join(' ').split(/\s+/).filter(w => w.length > 0).length;

        // Create notebook pair directly
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: `source-${Date.now()}`,
                originalFileName: file.name,
                importerType: 'markdown',
                createdAt: new Date().toISOString(),
                segmentCount: segments.length,
                headingCount,
                imageCount,
                wordCount,
                features: {
                    hasImages: imageCount > 0,
                    hasHeadings: headingCount > 0,
                    hasTables: text.includes('|'),
                    hasCodeBlocks: text.includes('```'),
                    hasLinks: /\[.*?\]\(.*?\)/.test(text),
                },
            },
        };

        const codexCells = cells.map(sourceCell => ({
            id: sourceCell.id,
            content: sourceCell.images.length > 0
                ? sourceCell.images.map(img => `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ''} />`).join('\n')
                : '', // Empty for translation, preserve images
            images: sourceCell.images,
            metadata: sourceCell.metadata,
        }));

        const codexNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: `codex-${Date.now()}`,
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        onProgress?.(createProgress('Complete', 'Markdown processing complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                segmentCount: cells.length,
                headingCount,
                imageCount,
                wordCount,
                fileSize: file.size,
                features: {
                    hasImages: imageCount > 0,
                    hasHeadings: headingCount > 0,
                    hasTables: text.includes('|'),
                    hasCodeBlocks: text.includes('```'),
                    hasLinks: /\[.*?\]\(.*?\)/.test(text),
                },
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process Markdown file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};



/**
 * Markdown Importer Plugin
 */
export const markdownImporter: ImporterPlugin = {
    name: 'Markdown Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/markdown', 'text/x-markdown'],
    description: 'Imports Markdown files with section-based splitting',
    validateFile,
    parseFile,
}; 