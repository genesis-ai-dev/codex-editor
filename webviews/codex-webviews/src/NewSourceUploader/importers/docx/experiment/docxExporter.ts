/**
 * DOCX Exporter for Round-Trip Functionality
 * Reconstructs DOCX files with translated content while preserving all formatting
 * Similar approach to Biblica IDML exporter
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
    DocxDocument,
    DocxParagraph,
    DocxRun,
    DocxExportConfig,
    DocxExportError,
    DocxCellMetadata,
} from './docxTypes';

// XML Parser/Builder configuration
const XML_OPTIONS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: false, // Set to false for proper array detection
    allowBooleanAttributes: true,
    parseTagValue: false,
    processEntities: true,
    ignoreDeclaration: false,
    ignorePiTags: false,
    isArray: (name: string, jpath: string) => {
        // Treat these elements as arrays even if there's only one
        return ['w:p', 'w:r', 'w:t', 'w:tab', 'w:br', 'w:drawing'].includes(name);
    },
};

/**
 * Export DOCX with translations
 * 
 * @param originalFileData - Original DOCX file as ArrayBuffer
 * @param codexCells - Array of Codex cells with translations
 * @param docxDocument - Parsed DocxDocument structure (from metadata)
 * @param config - Export configuration
 * @returns ArrayBuffer of new DOCX file
 */
export async function exportDocxWithTranslations(
    originalFileData: ArrayBuffer,
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>,
    docxDocument: DocxDocument | string,
    config: Partial<DocxExportConfig> = {}
): Promise<ArrayBuffer> {
    const exportConfig: DocxExportConfig = {
        preserveFormatting: true,
        preserveStyles: true,
        validateOutput: true,
        strictMode: false,
        ...config,
    };

    try {
        console.log('[DOCX Exporter] Starting export...');

        // Parse docxDocument if it's a string
        const docxDoc: DocxDocument = typeof docxDocument === 'string'
            ? JSON.parse(docxDocument)
            : docxDocument;

        // Load original DOCX
        const zip = await JSZip.loadAsync(originalFileData);
        console.log('[DOCX Exporter] Loaded original DOCX');

        // Get document.xml
        const documentXmlFile = zip.file('word/document.xml');
        if (!documentXmlFile) {
            throw new DocxExportError('document.xml not found', exportConfig, docxDoc);
        }

        const documentXml = await documentXmlFile.async('string');
        console.log('[DOCX Exporter] Extracted document.xml');

        // Collect translations from cells
        const translationMap = collectTranslations(codexCells);
        console.log(`[DOCX Exporter] Collected ${translationMap.size} translations`);

        // Replace content in document.xml
        const updatedXml = await replaceContentInXml(
            documentXml,
            translationMap,
            docxDoc,
            exportConfig
        );
        console.log('[DOCX Exporter] Updated document.xml with translations');

        // Update document.xml in ZIP
        zip.file('word/document.xml', updatedXml);

        // Generate new DOCX
        const newDocx = await zip.generateAsync({
            type: 'arraybuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
        });

        console.log('[DOCX Exporter] Export complete');
        return newDocx;

    } catch (error) {
        console.error('[DOCX Exporter] Error:', error);
        throw new DocxExportError(
            `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            exportConfig
        );
    }
}

/**
 * Collect translations from Codex cells
 */
function collectTranslations(
    codexCells: Array<{ kind: number; value: string; metadata: any; }>
): Map<string, string> {
    const translations = new Map<string, string>();

    console.log(`[Exporter] Processing ${codexCells.length} cells for translations`);

    for (let i = 0; i < codexCells.length; i++) {
        const cell = codexCells[i];
        const meta = cell.metadata;

        // Log cell info for debugging
        console.log(`[Exporter] Cell ${i}: kind=${cell.kind}, type=${meta?.type}, paragraphId=${meta?.paragraphId}, paragraphIndex=${meta?.paragraphIndex}`);

        // Only process text cells
        const isText = cell.kind === 2 && meta?.type === 'text';
        if (!isText) {
            console.log(`[Exporter] Skipping cell ${i} - not a text cell`);
            continue;
        }

        // Get translated content (strip HTML tags)
        const translated = removeHtmlTags(cell.value).trim();
        if (!translated) {
            console.log(`[Exporter] Skipping cell ${i} - no translated content`);
            continue;
        }

        // Get paragraph identifier
        const paragraphId = meta?.paragraphId;
        const paragraphIndex = meta?.paragraphIndex;

        if (paragraphId !== undefined) {
            translations.set(paragraphId, translated);
            console.log(`[Exporter] ✓ Collected translation for ${paragraphId} (index ${paragraphIndex}): "${translated.substring(0, 50)}..."`);
        } else if (paragraphIndex !== undefined) {
            const fallbackId = `p-${paragraphIndex}`;
            translations.set(fallbackId, translated);
            console.log(`[Exporter] ✓ Collected translation for ${fallbackId}: "${translated.substring(0, 50)}..."`);
        } else {
            console.warn(`[Exporter] ⚠ Cell ${i} has no paragraphId or paragraphIndex!`);
        }
    }

    console.log(`[Exporter] Collected ${translations.size} translations total`);
    console.log(`[Exporter] Translation IDs:`, Array.from(translations.keys()));

    return translations;
}

/**
 * Remove HTML tags from content
 */
function removeHtmlTags(html: string): string {
    // Simple HTML tag removal
    // TODO: Handle nested tags, entities, etc.
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
}

/**
 * Replace content in document.xml while preserving structure
 * 
 * This is the core round-trip logic - similar to Biblica's verse replacement
 */
async function replaceContentInXml(
    documentXml: string,
    translations: Map<string, string>,
    docxDoc: DocxDocument,
    config: DocxExportConfig
): Promise<string> {
    const parser = new XMLParser(XML_OPTIONS);
    const builder = new XMLBuilder(XML_OPTIONS);

    try {
        // Parse XML
        const parsed = parser.parse(documentXml);
        console.log('[Exporter] Parsed document.xml');

        // Find body element
        const body = findElement(parsed, 'w:body');
        if (!body) {
            throw new Error('w:body not found in document.xml');
        }

        // Find all paragraph elements
        const paragraphs = findAllElements(body, 'w:p');
        console.log(`[Exporter] Found ${paragraphs.length} paragraphs in XML`);

        // Create a map of paragraph index to docxParagraph for faster lookup
        const docxParagraphMap = new Map<number, DocxParagraph>();
        for (const docxParagraph of docxDoc.paragraphs) {
            docxParagraphMap.set(docxParagraph.paragraphIndex, docxParagraph);
        }

        console.log(`[Exporter] DocxDocument has ${docxDoc.paragraphs.length} paragraphs`);
        console.log(`[Exporter] Paragraph IDs in docxDoc:`, docxDoc.paragraphs.map(p => `${p.id} (index ${p.paragraphIndex})`));

        // Replace content in each paragraph
        let replacedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const pElement = paragraphs[i];

            // Get the corresponding docxParagraph by its index (i matches paragraphIndex)
            const docxParagraph = docxParagraphMap.get(i);
            if (!docxParagraph) {
                // No matching paragraph in our parsed structure (shouldn't happen)
                console.warn(`[Exporter] ⚠ No docxParagraph found for XML paragraph index ${i}`);
                skippedCount++;
                continue;
            }

            const paragraphId = docxParagraph.id;

            // Check if we have a translation for this paragraph
            const translation = translations.get(paragraphId);
            if (!translation) {
                console.log(`[Exporter] No translation for paragraph ${i} (${paragraphId})`);
                skippedCount++;
                continue; // No translation, keep original
            }

            // Replace content in paragraph runs
            const replaced = replaceParagraphContent(pElement, translation, docxParagraph);
            if (replaced) {
                replacedCount++;
                console.log(`[Exporter] ✓ Replaced paragraph ${i} (${paragraphId}): "${translation.substring(0, 50)}..."`);
            } else {
                console.warn(`[Exporter] ⚠ Failed to replace paragraph ${i} (${paragraphId})`);
            }
        }

        console.log(`[Exporter] Summary: ${replacedCount} replaced, ${skippedCount} skipped, ${paragraphs.length} total`);

        // Rebuild XML
        const updatedXml = builder.build(parsed);
        return updatedXml;

    } catch (error) {
        console.error('[Exporter] Error replacing content:', error);
        throw error;
    }
}

/**
 * Replace content in a paragraph element
 * 
 * Strategy:
 * 1. Find all w:r (run) elements in paragraph
 * 2. Find w:t (text) elements in runs
 * 3. Replace text content while preserving all formatting
 * 4. Put all translation in first text run, clear all other text runs
 */
function replaceParagraphContent(
    pElement: any,
    translation: string,
    docxParagraph: DocxParagraph
): boolean {
    try {
        console.log(`[Exporter] ==== Processing paragraph ====`);
        console.log(`[Exporter] Translation to insert: "${translation.substring(0, 100)}..."`);

        // Access runs directly from pElement['w:r']
        const runsArray = pElement['w:r'];
        if (!runsArray) {
            console.warn('[Exporter] ⚠ No w:r property found in paragraph element');
            return false;
        }

        const runs = Array.isArray(runsArray) ? runsArray : [runsArray];
        console.log(`[Exporter] Found ${runs.length} runs in paragraph`);

        // STRATEGY: Keep only the FIRST run and replace its FIRST text element with translation
        // Delete all other runs to avoid text duplication

        if (runs.length === 0) {
            console.warn('[Exporter] ⚠ No runs found');
            return false;
        }

        // Get the first run
        const firstRun = runs[0];
        const firstRunTextArray = firstRun['w:t'];

        if (!firstRunTextArray) {
            console.warn('[Exporter] ⚠ First run has no w:t property');
            return false;
        }

        // Get first text element
        const firstRunTexts = Array.isArray(firstRunTextArray) ? firstRunTextArray : [firstRunTextArray];
        if (firstRunTexts.length === 0) {
            console.warn('[Exporter] ⚠ First run has no text elements');
            return false;
        }

        // Replace first text element with translation
        const firstTextElement = firstRunTexts[0];

        // Handle both string and object representations
        let oldText: string;
        if (typeof firstTextElement === 'string') {
            // fast-xml-parser represented this as a simple string
            oldText = firstTextElement;
            // Replace with an object containing the translation
            firstRun['w:t'] = { '#text': translation };
            console.log(`[Exporter] ✓ Replaced text in first run (was string)`);
        } else {
            // It's an object with properties (may have attributes like xml:space)
            oldText = firstTextElement['#text'] || '';
            firstTextElement['#text'] = translation;
            // Update the reference in case there were multiple text elements
            firstRun['w:t'] = firstTextElement;
            console.log(`[Exporter] ✓ Replaced text in first run (was object)`);
        }

        console.log(`[Exporter]   OLD: "${oldText}"`);
        console.log(`[Exporter]   NEW: "${translation.substring(0, 100)}..."`);

        // Note: we've already set firstRun['w:t'] to the first element only above

        // DELETE all subsequent runs to avoid duplication
        if (runs.length > 1) {
            pElement['w:r'] = runs[0]; // Keep only the first run
            console.log(`[Exporter] ✓ Removed ${runs.length - 1} subsequent runs`);
        }

        console.log(`[Exporter] ==== Done processing paragraph ====\n`);
        return true;

    } catch (error) {
        console.error('[Exporter] ❌ ERROR:', error);
        console.error('[Exporter] Stack:', error instanceof Error ? error.stack : 'No stack');
        return false;
    }
}

// ============================================================================
// XML Helper Functions
// ============================================================================

/**
 * Find first element with given tag name
 */
function findElement(element: any, tagName: string): any {
    if (!element || typeof element !== 'object') {
        return null;
    }

    if (element[tagName]) {
        return Array.isArray(element[tagName]) ? element[tagName][0] : element[tagName];
    }

    // Search in children
    for (const key of Object.keys(element)) {
        if (key.startsWith('@_') || key === '#text') continue;

        const child = element[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                const found = findElement(item, tagName);
                if (found) return found;
            }
        } else if (typeof child === 'object') {
            const found = findElement(child, tagName);
            if (found) return found;
        }
    }

    return null;
}

/**
 * Find all elements with given tag name
 * For direct children only (non-recursive), used for w:r elements in w:p
 */
function findAllElements(element: any, tagName: string, directChildrenOnly: boolean = false): any[] {
    const results: any[] = [];

    if (!element || typeof element !== 'object') {
        return results;
    }

    if (element[tagName]) {
        const items = Array.isArray(element[tagName]) ? element[tagName] : [element[tagName]];
        results.push(...items);

        if (directChildrenOnly) {
            return results; // Only return direct children
        }
    }

    // Search in children (recursive)
    if (!directChildrenOnly) {
        for (const key of Object.keys(element)) {
            if (key.startsWith('@_') || key === '#text') continue;

            const child = element[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    results.push(...findAllElements(item, tagName, false));
                }
            } else if (typeof child === 'object') {
                results.push(...findAllElements(child, tagName, false));
            }
        }
    }

    return results;
}

/**
 * Simple exporter class (for consistency with other importers)
 */
export class DocxExporter {
    private config: DocxExportConfig;

    constructor(config: Partial<DocxExportConfig> = {}) {
        this.config = {
            preserveFormatting: true,
            preserveStyles: true,
            validateOutput: true,
            strictMode: false,
            ...config,
        };
    }

    async export(
        originalFileData: ArrayBuffer,
        codexCells: any[],
        docxDocument: DocxDocument | string
    ): Promise<ArrayBuffer> {
        return exportDocxWithTranslations(
            originalFileData,
            codexCells,
            docxDocument,
            this.config
        );
    }
}

// Export default instance
export default new DocxExporter();

