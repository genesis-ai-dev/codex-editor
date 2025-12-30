import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
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

const SUPPORTED_EXTENSIONS = ['md', 'markdown'];

/**
 * Splits markdown content into granular elements (headings, list items, paragraphs, etc.)
 */
const splitMarkdownIntoElements = (content: string): string[] => {
    const lines = content.split('\n');
    const elements: string[] = [];
    let currentElement = '';
    let inCodeBlock = false;
    let inListContext = false;
    let listDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle code blocks
        if (trimmedLine.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            currentElement += line + '\n';
            if (!inCodeBlock && currentElement.trim()) {
                elements.push(currentElement.trim());
                currentElement = '';
            }
            continue;
        }

        // If we're in a code block, just accumulate
        if (inCodeBlock) {
            currentElement += line + '\n';
            continue;
        }

        // Handle headings
        if (trimmedLine.match(/^#{1,6}\s/)) {
            // Finish any current element
            if (currentElement.trim()) {
                elements.push(currentElement.trim());
                currentElement = '';
            }
            elements.push(trimmedLine);
            inListContext = false;
            continue;
        }

        // Handle list items
        const listMatch = trimmedLine.match(/^(\s*)([-*+]|\d+\.)\s(.+)/);
        if (listMatch) {
            const indentation = listMatch[1];
            const currentDepth = Math.floor(indentation.length / 2); // Assuming 2 spaces per level

            // If we're starting a new list or changing depth significantly, finish current element
            if (!inListContext || Math.abs(currentDepth - listDepth) > 0) {
                if (currentElement.trim()) {
                    elements.push(currentElement.trim());
                    currentElement = '';
                }
            }

            // Each list item becomes its own element
            elements.push(trimmedLine);
            inListContext = true;
            listDepth = currentDepth;
            continue;
        }

        // Handle empty lines
        if (trimmedLine === '') {
            // If we have accumulated content and hit an empty line, finish the element
            if (currentElement.trim()) {
                elements.push(currentElement.trim());
                currentElement = '';
                inListContext = false;
            }
            continue;
        }

        // Handle regular paragraphs and other content
        if (inListContext) {
            // If we were in a list but now have non-list content, finish any accumulated content
            if (currentElement.trim()) {
                elements.push(currentElement.trim());
                currentElement = '';
            }
            inListContext = false;
        }

        currentElement += line + '\n';
    }

    // Don't forget the last element
    if (currentElement.trim()) {
        elements.push(currentElement.trim());
    }

    return elements.filter(element => element.length > 0);
};

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

        // Split markdown into individual elements instead of sections
        const elements = splitMarkdownIntoElements(processedText);

        if (elements.length === 0) {
            throw new Error('No content elements could be extracted from the markdown file');
        }

        onProgress?.(createProgress('Converting to HTML', 'Converting markdown elements to HTML...', 60));

        // Convert each element to a cell
        const cells = await Promise.all(
            elements.map(async (element, index) => {
                // Convert markdown to HTML using marked library
                const htmlContent = await marked.parse(element);

                // Analyze the element type
                const elementInfo = getElementType(element);

                // Create cell metadata with UUID, globalReferences, and chapterNumber
                const { cellId, metadata } = createMarkdownCellMetadata({
                    fileName: file.name,
                    segmentIndex: index,
                    originalMarkdown: element,
                    elementType: elementInfo.type,
                    headingLevel: elementInfo.level,
                    headingText: elementInfo.headingText,
                    cellLabel: elementInfo.type === 'heading' && elementInfo.headingText
                        ? elementInfo.headingText.substring(0, 20)
                        : String(index + 1),
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
                        // Keep existing fields for backward compatibility
                        type: 'markdown',
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
        const wordCount = elements.join(' ').split(/\s+/).filter(w => w.length > 0).length;

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
                elementCount: elements.length,
                headingCount,
                listItemCount,
                imageCount,
                wordCount,
                footnoteCount: footnotes.length,
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