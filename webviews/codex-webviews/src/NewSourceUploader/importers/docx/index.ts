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
    generateCellId,
    createProcessedCell,
    createNotebookPair,
    validateFileExtension,
} from '../../utils/workflowHelpers';
import { processImageData, extractImagesFromHtml } from '../../utils/imageProcessor';
import { DocxParsingOptions, DocxMammothOptions } from './types';

const SUPPORTED_EXTENSIONS = ['docx'];

/**
 * Validates a DOCX file
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
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
const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading DOCX file...', 'processing', 10));

        const arrayBuffer = await file.arrayBuffer();

        onProgress?.(createProgress('Converting to HTML', 'Converting DOCX to HTML using mammoth.js...', 'processing', 30));

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
        const htmlContent = result.value;

        onProgress?.(createProgress('Parsing Structure', 'Parsing HTML structure...', 'processing', 60));

        // Parse HTML structure
        const htmlSegments = await parseHtmlStructure(htmlContent);

        onProgress?.(createProgress('Processing Images', 'Processing embedded images...', 'processing', 80));

        // Process each segment into cells
        const cells = await Promise.all(
            htmlSegments.map(async (segment, index) => {
                const cellId = generateCellId('docx', index);
                const cell = createProcessedCell(cellId, segment);

                // Extract and process images from this cell
                const images = await extractImagesFromHtml(segment);
                cell.images = images;

                return cell;
            })
        );

        onProgress?.(createProgress('Creating Notebooks', 'Creating source and codex notebooks...', 'processing', 90));

        // Create notebook pair
        const notebookPair = createNotebookPair(
            file.name,
            cells,
            'docx',
            {
                wordCount: countWordsInHtml(htmlContent),
                mammothMessages: result.messages,
            }
        );

        onProgress?.(createProgress('Complete', 'DOCX processing complete', 'complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                wordCount: countWordsInHtml(htmlContent),
                segmentCount: cells.length,
                imageCount: cells.reduce((count, cell) => count + cell.images.length, 0),
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process DOCX file', 'error', 0));

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
    description: 'Imports Microsoft Word DOCX files using mammoth.js',
    validateFile,
    parseFile,
}; 