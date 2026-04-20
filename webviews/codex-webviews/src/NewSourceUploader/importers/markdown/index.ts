import { v4 as uuidv4 } from 'uuid';
import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import type { MarkdownNotebookMetadata } from '../../types/processedNotebookMetadata';
import {
    createProgress,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
import { marked } from 'marked';
import {
    processMarkdownWithFootnotes
} from '../../utils/markdownFootnoteExtractor';
import { validateFootnotes } from '../../utils/footnoteUtils';
import { createMarkdownCellMetadata } from './cellMetadata';
import { preprocessParagraphForHardLineBreaks } from './markdownImportPreprocess';
import { splitMarkdownIntoSpannedSegments } from './markdownSplit';

const SUPPORTED_EXTENSIONS = ['md', 'markdown'];

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * Determines the type of markdown element
 */
const getElementType = (element: string): {
    type: 'heading' | 'list-item' | 'paragraph' | 'code-block' | 'table' | 'other';
    level?: number;
    headingText?: string;
} => {
    const trimmed = element.trim();

    // Check for headings
    const headingMatch = trimmed.match(/^(#{1,6})\s(.+)/);
    if (headingMatch) {
        return {
            type: 'heading',
            level: headingMatch[1].length,
            headingText: headingMatch[2],
        };
    }

    // Check for list items
    if (trimmed.match(/^(\s*)([-*+]|\d+\.)\s/)) {
        return { type: 'list-item' };
    }

    // Check for code blocks
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
        return { type: 'code-block' };
    }

    // Check for tables
    if (trimmed.includes('|') && trimmed.split('\n').some(line => line.includes('|'))) {
        return { type: 'table' };
    }

    // Default to paragraph
    return { type: 'paragraph' };
};

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

        onProgress?.(createProgress('Extracting Footnotes', 'Extracting footnotes from Markdown...', 25));

        // Process Markdown content for footnotes
        const { content: processedText, footnotes } = processMarkdownWithFootnotes(text);

        // Validate footnotes
        const footnoteValidation = validateFootnotes(footnotes);
        if (!footnoteValidation.isValid) {
            console.warn('Markdown footnote validation errors:', footnoteValidation.errors);
        }
        if (footnoteValidation.warnings.length > 0) {
            console.warn('Markdown footnote validation warnings:', footnoteValidation.warnings);
        }

        onProgress?.(createProgress('Parsing Markdown', 'Breaking down into individual elements...', 30));

        // Configure marked for consistent parsing
        marked.setOptions({
            gfm: true, // GitHub Flavored Markdown
            breaks: false,
        });

        // Split markdown into segments with UTF-16 spans for round-trip export
        const spannedSegments = splitMarkdownIntoSpannedSegments(processedText);

        if (spannedSegments.length === 0) {
            throw new Error('No content elements could be extracted from the markdown file');
        }

        const canonicalRoundTripBytes = new TextEncoder().encode(processedText);
        const originalFileData = toArrayBuffer(canonicalRoundTripBytes);

        onProgress?.(createProgress('Converting to HTML', 'Converting markdown elements to HTML...', 60));

        // Convert each element to a cell
        const cells = await Promise.all(
            spannedSegments.map(async ({ text: element, start, end }, index) => {
                // Analyze the element type before optional paragraph preprocessing
                const elementInfo = getElementType(element);
                const markdownForParse =
                    elementInfo.type === "paragraph"
                        ? preprocessParagraphForHardLineBreaks(element)
                        : element;

                // Convert markdown to HTML using marked library
                const htmlContent = await marked.parse(markdownForParse);

                // Create cell metadata with UUID, globalReferences, and chapterNumber
                const { cellId, metadata } = createMarkdownCellMetadata({
                    fileName: file.name,
                    segmentIndex: index,
                    originalMarkdown: element,
                    sourceSpan: { start, end },
                    elementType: elementInfo.type,
                    headingLevel: elementInfo.level,
                    headingText: elementInfo.headingText,
                    cellLabel: undefined,
                });

                // Extract images from the converted HTML
                const images = await extractImagesFromHtml(htmlContent);

                // Create cell with metadata
                const cell = {
                    id: cellId,
                    content: htmlContent,
                    images,
                    metadata: {
                        ...metadata,
                        segmentIndex: index,
                        originalMarkdown: element,
                        elementType: elementInfo.type,
                        hasHeading: elementInfo.type === 'heading',
                        headingText: elementInfo.headingText,
                        headingLevel: elementInfo.level,
                    },
                };

                return cell;
            })
        );

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pair...', 85));

        // Analyze content for metadata
        const headingCount = cells.filter(cell => cell.metadata?.elementType === 'heading').length;
        const listItemCount = cells.filter(cell => cell.metadata?.elementType === 'list-item').length;
        const imageCount = cells.reduce((count, cell) => count + cell.images.length, 0);
        const wordCount = spannedSegments.map(s => s.text).join(' ').split(/\s+/).filter(w => w.length > 0).length;

        // Create notebook pair directly
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const sourceMetadata: MarkdownNotebookMetadata = {
            id: uuidv4(),
            originalFileName: file.name,
            sourceFile: file.name,
            originalFileData,
            corpusMarker: "markdown",
            markdownRoundTripSource: "processed-utf8",
            importerType: "markdown",
            createdAt: new Date().toISOString(),
            importContext: {
                importerType: "markdown",
                fileName: file.name,
                originalFileName: file.name,
                fileSize: file.size,
                importTimestamp: new Date().toISOString(),
            },
            elementCount: spannedSegments.length,
            headingCount,
            listItemCount,
            imageCount,
            wordCount,
            footnoteCount: footnotes.length,
            features: {
                hasImages: imageCount > 0,
                hasHeadings: headingCount > 0,
                hasListItems: listItemCount > 0,
                hasTables: processedText.includes("|"),
                hasCodeBlocks: processedText.includes("```"),
                hasLinks: /\[.*?\]\(.*?\)/.test(processedText),
                hasFootnotes: footnotes.length > 0,
            },
        };

        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: sourceMetadata,
        };

        // Target (.codex) cells start empty so progress is not reported as complete when source
        // and translation are identical. Image-only cells carry <img> tags so attachments stay wired.
        const codexCells = cells.map((sourceCell) => ({
            id: sourceCell.id,
            content:
                sourceCell.images.length > 0
                    ? sourceCell.images
                          .map(
                              (img) =>
                                  `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ""} />`
                          )
                          .join("\n")
                    : "",
            images: sourceCell.images,
            metadata: sourceCell.metadata,
        }));

        const codexMetadata: MarkdownNotebookMetadata = {
            ...sourceMetadata,
            id: uuidv4(),
            originalFileData: undefined,
        };

        const codexNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: codexMetadata,
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Add milestone cells to the notebook pair
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

        onProgress?.(createProgress('Complete', 'Markdown processing complete', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                elementCount: cells.length,
                headingCount,
                listItemCount,
                imageCount,
                wordCount,
                footnoteCount: footnotes.length,
                fileSize: file.size,
                features: {
                    hasImages: imageCount > 0,
                    hasHeadings: headingCount > 0,
                    hasListItems: listItemCount > 0,
                    hasTables: processedText.includes('|'),
                    hasCodeBlocks: processedText.includes('```'),
                    hasLinks: /\[.*?\]\(.*?\)/.test(processedText),
                    hasFootnotes: footnotes.length > 0,
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
    description: 'Imports Markdown files with granular element-based splitting (headings, list items, paragraphs)',
    validateFile,
    parseFile,
}; 