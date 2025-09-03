import mammoth from 'mammoth';
import { XMLParser } from 'fast-xml-parser';
import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProcessedImage,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
} from '../../utils/workflowHelpers';
import { processImageData, extractImagesFromHtml } from '../../utils/imageProcessor';
import { DocxParsingOptions, DocxMammothOptions } from './types';
import {
    extractDocxFootnotes,
    integrateFootnotesIntoHtml
} from '../../utils/docxFootnoteExtractor';
import {
    extractAndReplaceFootnotes,
    validateFootnotes,
    createFootnoteChildCells
} from '../../utils/footnoteUtils';
import { postProcessImportedFootnotes } from '../../utils/postProcessFootnotes';
import { processMammothFootnotes } from '../../utils/mammothFootnoteHandler';
import { extractFootnotesFromMammothMarkdown } from '../../utils/mammothMarkdownFootnoteExtractor';
import { integrateFootnotesBeforeCellSplit } from '../../utils/footnoteIntegration';
import { cleanIntegrateFootnotes } from '../../utils/cleanFootnoteIntegration';
import {
    SegmentMetadata,
    DocumentStructureMetadata,
    OffsetTracker,
    buildStructureTree,
    generateChecksum,
    serializeDocumentStructure,
} from '../../utils/documentStructurePreserver';

const SUPPORTED_EXTENSIONS = ['docx'];

/**
 * Validates a DOCX file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .docx extension');
    }

    // Check file size (warn if > 50MB)
    if (file.size > 50 * 1024 * 1024) {
        warnings.push('Large files may take longer to process');
    }

    // Check if file is actually a DOCX by reading the magic bytes
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        // DOCX files are ZIP files, check for ZIP signature
        const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B &&
            (uint8Array[2] === 0x03 || uint8Array[2] === 0x05);

        if (!isZip) {
            errors.push('File does not appear to be a valid DOCX document');
        }
    } catch (error) {
        warnings.push('Could not verify file format');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'docx',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses a DOCX file using mammoth.js
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading DOCX file...', 10));

        const arrayBuffer = await file.arrayBuffer();

        onProgress?.(createProgress('Converting to HTML', 'Converting DOCX to HTML using mammoth.js...', 30));

        // Configure mammoth.js options
        const mammothOptions: DocxMammothOptions = {
            arrayBuffer,
            styleMap: [
                "p[style-name='Normal'] => p:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh",
                "p[style-name='Quote'] => blockquote:fresh",
                "p[style-name='Footnote Text'] => p.footnote:fresh",
                // Footnote and endnote handling
                "footnote-reference => sup.footnote-ref",
                "endnote-reference => sup.endnote-ref",
                // Run styles
                "r[style-name='Strong'] => strong",
                "r[style-name='Emphasis'] => em",
                "r[style-name='Code'] => code",
                "r[style-name='Superscript'] => sup",
                "r[style-name='Subscript'] => sub",
                "r[style-name='Strikethrough'] => s",
                "r[style-name='Underline'] => u",
                "table => table.table",
                "tr => tr",
                "td => td",
                "th => th",
                "ul => ul",
                "ol => ol",
                "li => li",
            ],
            transformDocument: (element: any) => {
                // Add embedded styles to each section
                if (element.type === "paragraph" || element.type === "table" || element.type === "list") {
                    const styleProperties = element.styleProperties || {};
                    const styleString = Object.entries(styleProperties)
                        .map(([key, value]) => {
                            switch (key) {
                                case "fontSize": return `font-size: ${value}pt;`;
                                case "fontFamily": return `font-family: ${value};`;
                                case "color": return `color: ${value};`;
                                case "backgroundColor": return `background-color: ${value};`;
                                case "textAlign": return `text-align: ${value};`;
                                case "lineHeight": return `line-height: ${value};`;
                                default: return "";
                            }
                        })
                        .filter(style => style !== "")
                        .join(" ");

                    if (styleString) {
                        element.style = styleString;
                    }
                }
                return element;
            },
        };

        // Convert to HTML
        const result = await mammoth.convertToHtml(mammothOptions as any);
        let htmlContent = result.value;

        onProgress?.(createProgress('Processing Footnotes', 'Converting to markdown to extract footnotes...', 45));

        // Also convert to Markdown to extract footnote content properly
        const markdownResult = await mammoth.convertToMarkdown({ arrayBuffer });

        onProgress?.(createProgress('Processing Footnotes', 'Processing footnotes from markdown output...', 50));

        // Use markdown-based footnote extraction (more reliable)
        const { footnotes, processedHtml } = await extractFootnotesFromMammothMarkdown(
            file,
            result,
            markdownResult
        );
        htmlContent = processedHtml;

        // Validate footnotes and log any issues
        const footnoteValidation = validateFootnotes(footnotes);
        if (!footnoteValidation.isValid) {
            console.warn('DOCX footnote validation errors:', footnoteValidation.errors);
        }
        if (footnoteValidation.warnings.length > 0) {
            console.warn('DOCX footnote validation warnings:', footnoteValidation.warnings);
        }

        onProgress?.(createProgress('Integrating Footnotes', 'Cleaning and integrating footnotes...', 55));

        // Use clean footnote integration approach to avoid nested/malformed footnotes
        htmlContent = cleanIntegrateFootnotes(htmlContent, footnotes);

        onProgress?.(createProgress('Parsing Structure', 'Splitting HTML into segments...', 60));

        // Split HTML into segments without XML re-parsing to preserve inline markup and attributes
        let htmlSegments = htmlContent
            .split(/(?=<(?:h[1-6]|p|div|table|ul|ol)\b[^>]*>)/i)
            .map(segment => segment.trim())
            .filter(segment => segment.length > 0);

        // Merge segments where a standalone <p><sup>n</sup></p> (or Codex marker) paragraph should be inline in the previous paragraph
        const escapeAttr = (s: string) =>
            (s || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

        const footnoteContentMap: Map<string, string> = new Map();
        footnotes.forEach(fn => {
            const m = fn.id.match(/footnote-(\d+)/);
            const num = m ? m[1] : (fn.position ? String(fn.position) : undefined);
            if (num) footnoteContentMap.set(num, fn.content);
        });

        const merged: string[] = [];
        for (let i = 0; i < htmlSegments.length; i++) {
            const seg = htmlSegments[i];
            // Match standalone sup paragraph variants
            const simpleSup = seg.match(/^<p>\s*(?:<a[^>]*>\s*<\/a>\s*)*<sup[^>]*>\s*(\d+)\s*<\/sup>\s*<\/p>$/i);
            const codexSup = seg.match(/^<p>\s*(?:<a[^>]*>\s*<\/a>\s*)*<sup[^>]*class="footnote-marker"[^>]*>\s*(\d+)\s*<\/sup>\s*<\/p>$/i);
            const nestedSup = seg.match(/^<p>\s*(?:<a[^>]*>\s*<\/a>\s*)*<sup[^>]*><a[^>]*><sup[^>]*>\s*(\d+)\s*<\/sup><\/a><\/sup>\s*<\/p>$/i);

            const num = (simpleSup || codexSup || nestedSup)?.[1];
            if (num && merged.length > 0) {
                const prev = merged.pop() as string;
                const content = footnoteContentMap.get(num) || '';
                const codexMarker = `<sup class="footnote-marker" data-footnote="${escapeAttr(content)}">${num}</sup>`;
                // Insert before trailing punctuation/quotes if present
                const punctMatch = prev.match(/([\s\S]*?)(["'”’\)\]]*[\.,;:!?]+)<\/p>$/);
                let updatedPrev: string;
                if (punctMatch) {
                    updatedPrev = `${punctMatch[1]}${codexMarker}${punctMatch[2]}</p>`;
                } else {
                    updatedPrev = prev.replace(/<\/p>\s*$/i, `${codexMarker}</p>`);
                }
                merged.push(updatedPrev);
                continue; // drop the standalone sup segment
            }
            merged.push(seg);
        }
        htmlSegments = merged;

        onProgress?.(createProgress('Processing Images', 'Processing embedded images...', 80));

        // Track offsets and structure for each segment
        const offsetTracker = new OffsetTracker();
        const segmentToIdMap = new Map<string, string>();

        // Store the original raw content from mammoth before segmentation
        const originalRawHtml = result.value;

        // Process each segment into cells with structure tracking
        const cells = await Promise.all(
            htmlSegments.map(async (segment, index) => {
                const cellId = createStandardCellId(file.name, 1, index + 1);

                // Find the position of this segment in the original HTML
                const segmentStart = originalRawHtml.indexOf(segment);
                const segmentEnd = segmentStart + segment.length;

                // Record segment metadata
                offsetTracker.recordSegment(cellId, segment, {
                    structuralPath: `segment[${index}]`,
                    parentContext: {
                        tagName: 'body',
                        attributes: {}
                    }
                });

                segmentToIdMap.set(segment, cellId);

                // Create cell with enhanced metadata including structure data
                const cell = createProcessedCell(cellId, segment, {
                    data: {
                        originalOffset: {
                            start: segmentStart,
                            end: segmentEnd
                        },
                        originalContent: segment,
                        segmentIndex: index
                    }
                });

                // Extract and process images from this cell
                const images = await extractImagesFromHtml(segment);
                cell.images = images;

                return cell;
            })
        );

        onProgress?.(createProgress('Creating Notebooks', 'Creating source and codex notebooks...', 90));

        // Generate file hash for integrity checking (reuse the arrayBuffer we already have)
        const fileHash = await generateChecksum(new Uint8Array(arrayBuffer).toString());

        // Parse the HTML structure for the structure tree
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseAttributeValue: true,
            trimValues: true,
            preserveOrder: true,
            allowBooleanAttributes: true,
            parseTagValue: false,
            processEntities: true,
        });

        let parsedStructure = [];
        try {
            // Parse the original HTML for structure preservation
            const wrappedHtml = `<root>${originalRawHtml}</root>`;
            parsedStructure = parser.parse(wrappedHtml);
        } catch (error) {
            console.warn('Could not parse HTML for structure tree, using simplified structure', error);
            // Fall back to a simplified structure based on segments
            parsedStructure = [];
        }

        // Prepare document structure metadata
        const structureMetadata: DocumentStructureMetadata = {
            originalFileRef: `attachments/originals/${file.name}`,
            originalMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            originalFileHash: fileHash,
            importedAt: new Date().toISOString(),
            documentMetadata: {
                title: file.name,
                modifiedDate: new Date(file.lastModified).toISOString()
            },
            segments: offsetTracker.getSegments(),
            structureTree: buildStructureTree(parsedStructure, segmentToIdMap),
            preservationFormatVersion: '1.0.0'
        };

        // Create notebook pair directly
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const sourceNotebook = {
            name: baseName, // Just the base name, no extension
            cells,
            metadata: {
                id: `source-${Date.now()}`,
                originalFileName: file.name,
                originalFileData: arrayBuffer, // Store original file to be saved in attachments
                importerType: 'docx',
                createdAt: new Date().toISOString(),
                wordCount: countWordsInHtml(htmlContent),
                mammothMessages: result.messages,
                documentStructure: serializeDocumentStructure(structureMetadata),
            },
        };

        const codexCells = cells.map(sourceCell => ({
            id: sourceCell.id,
            content: sourceCell.images.length > 0
                ? sourceCell.images.map(img => `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ''} />`).join('\n')
                : '', // Empty for translation, preserve images
            images: sourceCell.images,
            metadata: {
                ...sourceCell.metadata,
                // Preserve the data field that contains structure info
            },
        }));

        const codexNotebook = {
            name: baseName, // Just the base name, no extension
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: `codex-${Date.now()}`,
                // Don't duplicate the original file data in codex
                originalFileData: undefined,
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Log structure preservation info
        console.log(`[DOCX IMPORTER] Created notebook pair for "${baseName}"`);
        console.log(`[DOCX IMPORTER] - ${cells.length} cells processed`);
        console.log(`[DOCX IMPORTER] - Original file data: ${sourceNotebook.metadata.originalFileData ? 'preserved' : 'missing'}`);
        console.log(`[DOCX IMPORTER] - Document structure: ${sourceNotebook.metadata.documentStructure ? 'preserved' : 'missing'}`);

        onProgress?.(createProgress('Complete', 'DOCX processing complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                wordCount: countWordsInHtml(htmlContent),
                segmentCount: cells.length,
                imageCount: cells.reduce((count, cell) => count + cell.images.length, 0),
                footnoteCount: footnotes.length,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process DOCX file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Parses HTML structure into logical segments
 */
const parseHtmlStructure = async (html: string): Promise<string[]> => {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
        trimValues: true,
        preserveOrder: true,
        allowBooleanAttributes: true,
        parseTagValue: false,
        processEntities: true,
    });

    try {
        // Wrap HTML in root element for proper XML parsing
        const wrappedHtml = `<root>${html}</root>`;
        const parsedHtml = parser.parse(wrappedHtml);

        // Process the parsed structure to extract segments
        if (parsedHtml && parsedHtml[0] && parsedHtml[0].root && Array.isArray(parsedHtml[0].root)) {
            return parsedHtml[0].root.map((item: any) => convertItemToHtml(item)).filter(Boolean);
        }
    } catch (error) {
        console.warn('Failed to parse HTML structure, falling back to simple split:', error);
    }

    // Fallback: simple paragraph-based splitting
    return html
        .split(/(?=<(?:h[1-6]|p|div|table|ul|ol)\b[^>]*>)/i)
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0);
};

/**
 * Converts parsed XML item back to HTML
 */
const convertItemToHtml = (item: any): string => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return String(item || "");
    if (item["#text"]) return item["#text"];

    let html = "";
    for (const [tagName, content] of Object.entries(item)) {
        if (tagName.startsWith(":@")) continue; // Skip invalid tags

        if (tagName === "#text") {
            html += content;
        } else if (Array.isArray(content)) {
            if (content.length === 0) {
                html += `<${tagName}></${tagName}>`;
            } else {
                for (const subItem of content) {
                    if (typeof subItem === "object" && subItem !== null) {
                        const attributes: string[] = [];
                        const children: any[] = [];

                        for (const [key, value] of Object.entries(subItem)) {
                            if (key.startsWith("@_")) {
                                const attrName = key.substring(2);
                                attributes.push(`${attrName}="${value}"`);
                            } else if (key === "#text") {
                                children.push(value);
                            } else {
                                children.push({ [key]: value });
                            }
                        }

                        const attrString = attributes.length > 0 ? " " + attributes.join(" ") : "";

                        if (children.length === 0) {
                            html += `<${tagName}${attrString}></${tagName}>`;
                        } else {
                            html += `<${tagName}${attrString}>`;
                            for (const child of children) {
                                html += convertItemToHtml(child);
                            }
                            html += `</${tagName}>`;
                        }
                    } else {
                        html += `<${tagName}>${subItem}</${tagName}>`;
                    }
                }
            }
        } else if (typeof content === "object" && content !== null) {
            html += convertItemToHtml({ [tagName]: [content] });
        } else {
            html += `<${tagName}>${content}</${tagName}>`;
        }
    }

    return html;
};

/**
 * Counts words in HTML content
 */
const countWordsInHtml = (html: string): number => {
    const textContent = html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return textContent
        .split(" ")
        .filter((word: string) => word.length > 0).length;
};

/**
 * DOCX Importer Plugin
 */
export const docxImporter: ImporterPlugin = {
    name: 'DOCX Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    description: 'Imports Microsoft Word DOCX files using mammoth.js',
    validateFile,
    parseFile,
}; 