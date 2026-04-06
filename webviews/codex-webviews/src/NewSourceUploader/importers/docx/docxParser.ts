/**
 * DOCX OOXML Parser for round-trip export
 * Parses Word documents while preserving all formatting, structure, and XML for reconstruction
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
    DocxDocument,
    DocxParagraph,
    DocxRun,
    DocxParagraphProperties,
    DocxRunProperties,
    DocxStyles,
    DocxResources,
    DocxMetadata,
    DocxRelationships,
    DocxParseConfig,
    DocxParseError,
} from './docxTypes';

// XML Parser configuration for OOXML
const XML_PARSER_OPTIONS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false, // Keep as strings
    trimValues: false, // Preserve whitespace
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

// Helper to compute SHA-256 hash
async function computeSHA256(input: string | ArrayBuffer): Promise<string> {
    const data = typeof input === 'string'
        ? new TextEncoder().encode(input).buffer
        : input;

    const cryptoObj: any = (globalThis as any).crypto;
    if (cryptoObj?.subtle?.digest) {
        const digest = await cryptoObj.subtle.digest('SHA-256', data);
        const bytes = new Uint8Array(digest);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback hash
    const bytes = new Uint8Array(data);
    let h1 = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h1 ^= bytes[i];
        h1 = (h1 * 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0');
}

export class DocxParser {
    private config: DocxParseConfig;
    private debugCallback?: (message: string) => void;
    private xmlParser: XMLParser;
    private xmlBuilder: XMLBuilder;

    constructor(config: Partial<DocxParseConfig> = {}) {
        this.config = {
            preserveAllFormatting: true,
            extractImages: true,
            extractFootnotes: true,
            extractTables: false, // TODO: Implement table support
            segmentationStrategy: 'paragraph',
            validateStructure: true,
            ...config,
        };

        this.xmlParser = new XMLParser(XML_PARSER_OPTIONS);
        this.xmlBuilder = new XMLBuilder(XML_PARSER_OPTIONS);
    }

    setDebugCallback(callback: (message: string) => void) {
        this.debugCallback = callback;
    }

    private debugLog(message: string) {
        if (this.debugCallback) {
            this.debugCallback(message);
        }
        console.log(`[DOCX Parser] ${message}`);
    }

    /**
     * Main parsing method - extracts DOCX structure from file
     */
    async parseDocx(file: File): Promise<DocxDocument> {
        try {
            this.debugLog(`Starting parse of ${file.name}`);

            // Read file as array buffer
            const arrayBuffer = await file.arrayBuffer();
            const originalHash = await computeSHA256(arrayBuffer);

            this.debugLog(`File hash: ${originalHash}`);

            // Unzip DOCX file
            const zip = await JSZip.loadAsync(arrayBuffer);

            // Extract main document XML
            const documentXmlFile = zip.file('word/document.xml');
            if (!documentXmlFile) {
                throw new DocxParseError('document.xml not found in DOCX file');
            }

            const documentXml = await documentXmlFile.async('string');
            this.debugLog(`Extracted document.xml (${documentXml.length} chars)`);

            // Parse document XML
            const parsedDoc = this.xmlParser.parse(documentXml);

            // Extract paragraphs from body
            const paragraphs = await this.extractParagraphs(parsedDoc, documentXml);
            this.debugLog(`Extracted ${paragraphs.length} paragraphs`);

            // Extract styles
            const styles = await this.extractStyles(zip);

            // Extract relationships
            const relationships = await this.extractRelationships(zip);

            // Extract resources (images, etc.)
            const resources = await this.extractResources(zip, relationships);

            // Extract metadata
            const metadata = await this.extractMetadata(zip);

            const document: DocxDocument = {
                id: `docx-${Date.now()}`,
                version: '1.0',
                documentXml,
                paragraphs,
                styles,
                resources,
                metadata,
                originalHash,
                relationships,
            };

            this.debugLog('Parse complete');
            return document;

        } catch (error) {
            if (error instanceof DocxParseError) {
                throw error;
            }
            throw new DocxParseError(
                `Failed to parse DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Extract paragraphs from document XML
     */
    private async extractParagraphs(parsedDoc: any, documentXml: string): Promise<DocxParagraph[]> {
        const paragraphs: DocxParagraph[] = [];

        try {
            /**
             * IMPORTANT:
             * For round-trip export, `paragraphIndex` MUST correspond to the linear <w:p> order
             * inside <w:body> in `word/document.xml`.
             *
             * Using object traversal (`findAllElements`) can drift from true XML order in complex
             * structures like tables, leading to incorrect mapping during export.
             *
             * So we enumerate paragraph XML fragments in-order using a regex scan over <w:body>,
             * then parse each paragraph fragment into an object and extract runs/properties from it.
             */
            const paragraphXmls = this.extractParagraphXmlList(documentXml);
            if (paragraphXmls.length > 0) {
                this.debugLog(`Found ${paragraphXmls.length} paragraph XML fragments (XML-order scan)`);

                for (let i = 0; i < paragraphXmls.length; i++) {
                    const pXml = paragraphXmls[i];
                    const pElement = this.parseParagraphFragment(pXml);
                    if (!pElement) {
                        this.debugLog(`  -> Skipped paragraph ${i} (could not parse fragment)`);
                        continue;
                    }

                    this.debugLog(`Processing paragraph ${i}`);
                    const paragraph = await this.extractParagraph(pElement, i, documentXml);
                    if (paragraph) {
                        this.debugLog(`  -> Added paragraph ${i} with ${paragraph.runs.length} runs`);
                        paragraphs.push(paragraph);
                    } else {
                        this.debugLog(`  -> Skipped paragraph ${i} (empty or error)`);
                    }
                }

                this.debugLog(`Total paragraphs extracted: ${paragraphs.length}`);
                return paragraphs;
            }

            // Fallback (should be rare): old behavior using parsed object traversal.
            this.debugLog('Falling back to parsedDoc traversal for paragraphs (XML-order scan found none)');
            this.debugLog(`Parsed doc keys: ${Object.keys(parsedDoc).join(', ')}`);

            const body = this.findElement(parsedDoc, 'w:body');
            if (!body) {
                this.debugLog('No body element found');
                this.debugLog(`Full parsed doc: ${JSON.stringify(parsedDoc).substring(0, 500)}`);
                return paragraphs;
            }

            const pElements = this.findAllElements(body, 'w:p');
            this.debugLog(`Found ${pElements.length} paragraph elements (fallback traversal)`);

            for (let i = 0; i < pElements.length; i++) {
                const pElement = pElements[i];
                const paragraph = await this.extractParagraph(pElement, i, documentXml);
                if (paragraph) paragraphs.push(paragraph);
            }

            this.debugLog(`Total paragraphs extracted: ${paragraphs.length}`);

        } catch (error) {
            this.debugLog(`Error extracting paragraphs: ${error}`);
        }

        return paragraphs;
    }

    private sliceBodyXml(documentXml: string): string | null {
        const bodyOpenIdx = documentXml.indexOf('<w:body');
        if (bodyOpenIdx < 0) return null;
        const bodyStart = documentXml.indexOf('>', bodyOpenIdx);
        const bodyCloseIdx = documentXml.indexOf('</w:body>');
        if (bodyStart < 0 || bodyCloseIdx < 0) return null;
        return documentXml.slice(bodyStart + 1, bodyCloseIdx);
    }

    private extractParagraphXmlList(documentXml: string): string[] {
        const bodyXml = this.sliceBodyXml(documentXml);
        if (!bodyXml) return [];
        const paraRe = /<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
        const matches = bodyXml.match(paraRe);
        return matches ?? [];
    }

    private parseParagraphFragment(paragraphXml: string): any | null {
        try {
            const parsed = this.xmlParser.parse(paragraphXml);
            // Fast-xml-parser returns `{ 'w:p': {...} }` for a <w:p> root.
            if (parsed && typeof parsed === 'object' && parsed['w:p']) return parsed['w:p'];
            // Self-closing paragraphs may parse slightly differently; accept root object.
            return parsed ?? null;
        } catch (err) {
            this.debugLog(`Error parsing paragraph fragment: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }

    /**
     * Extract a single paragraph with all its runs and properties
     */
    private async extractParagraph(
        pElement: any,
        paragraphIndex: number,
        documentXml: string
    ): Promise<DocxParagraph | null> {
        try {
            const paragraphId = `p-${paragraphIndex}`;

            // Extract paragraph properties
            const pPrElement = this.findElement(pElement, 'w:pPr');
            const paragraphProperties = pPrElement
                ? this.extractParagraphProperties(pPrElement)
                : {};

            // Extract runs (w:r elements)
            const rElements = this.findAllElements(pElement, 'w:r');
            const runs: DocxRun[] = [];

            for (let i = 0; i < rElements.length; i++) {
                const run = await this.extractRun(rElements[i], i, paragraphId);
                if (run) { // Include ALL runs, even empty ones for round-trip
                    runs.push(run);
                }
            }

            // Don't skip empty paragraphs - we need them for round-trip!
            // Even empty paragraphs might have important formatting or spacing
            this.debugLog(`  Paragraph ${paragraphIndex} has ${runs.length} runs, total text: "${runs.map(r => r.content).join('')}"`);

            // Only skip if there are no runs at all (not even empty ones)
            if (rElements.length > 0 && runs.length === 0) {
                this.debugLog(`  -> Skipping paragraph ${paragraphIndex} (no runs could be extracted)`);
                return null;
            }

            // Get the XML representation of this paragraph for before/after tracking
            // This is crucial for round-trip - we need to preserve the exact XML structure
            const paragraphXml = this.elementToXml(pElement);

            const paragraph: DocxParagraph = {
                id: paragraphId,
                paragraphIndex,
                paragraphProperties,
                runs,
                metadata: {
                    originalXml: paragraphXml,
                },
            };

            return paragraph;

        } catch (error) {
            this.debugLog(`Error extracting paragraph ${paragraphIndex}: ${error}`);
            return null;
        }
    }

    /**
     * Extract a single run with properties and content
     */
    private async extractRun(
        rElement: any,
        runIndex: number,
        paragraphId: string
    ): Promise<DocxRun | null> {
        try {
            const runId = `${paragraphId}-r-${runIndex}`;

            // Extract run properties
            const rPrElement = this.findElement(rElement, 'w:rPr');
            const runProperties = rPrElement
                ? this.extractRunProperties(rPrElement)
                : {};

            // Extract text content (w:t elements)
            const textElements = this.findAllElements(rElement, 'w:t');
            let content = '';
            for (const tElement of textElements) {
                const text = this.getElementText(tElement);
                content += text;
            }

            // Get XML representation of this run
            const runXml = this.elementToXml(rElement);

            const run: DocxRun = {
                id: runId,
                runIndex,
                runProperties,
                content,
                metadata: {
                    originalXml: runXml,
                },
            };

            return run;

        } catch (error) {
            this.debugLog(`Error extracting run ${runIndex}: ${error}`);
            return null;
        }
    }

    /**
     * Extract paragraph properties from w:pPr element
     */
    private extractParagraphProperties(pPrElement: any): DocxParagraphProperties {
        const props: DocxParagraphProperties = {};

        try {
            // Style ID
            const pStyle = this.findElement(pPrElement, 'w:pStyle');
            if (pStyle && pStyle['@_w:val']) {
                props.styleId = pStyle['@_w:val'];
            }

            // Alignment
            const jc = this.findElement(pPrElement, 'w:jc');
            if (jc && jc['@_w:val']) {
                props.alignment = jc['@_w:val'];
            }

            // Indentation
            const ind = this.findElement(pPrElement, 'w:ind');
            if (ind) {
                props.indentation = {
                    left: ind['@_w:left'] ? parseInt(ind['@_w:left']) : undefined,
                    right: ind['@_w:right'] ? parseInt(ind['@_w:right']) : undefined,
                    firstLine: ind['@_w:firstLine'] ? parseInt(ind['@_w:firstLine']) : undefined,
                    hanging: ind['@_w:hanging'] ? parseInt(ind['@_w:hanging']) : undefined,
                };
            }

            // Spacing
            const spacing = this.findElement(pPrElement, 'w:spacing');
            if (spacing) {
                props.spacing = {
                    before: spacing['@_w:before'] ? parseInt(spacing['@_w:before']) : undefined,
                    after: spacing['@_w:after'] ? parseInt(spacing['@_w:after']) : undefined,
                    line: spacing['@_w:line'] ? parseInt(spacing['@_w:line']) : undefined,
                    lineRule: spacing['@_w:lineRule'],
                };
            }

            // Store complete element for round-trip
            props._originalElement = pPrElement;

        } catch (error) {
            this.debugLog(`Error extracting paragraph properties: ${error}`);
        }

        return props;
    }

    /**
     * Extract run properties from w:rPr element
     */
    private extractRunProperties(rPrElement: any): DocxRunProperties {
        const props: DocxRunProperties = {};

        try {
            // Bold
            if (this.findElement(rPrElement, 'w:b')) {
                props.bold = true;
            }

            // Italic
            if (this.findElement(rPrElement, 'w:i')) {
                props.italic = true;
            }

            // Underline
            const u = this.findElement(rPrElement, 'w:u');
            if (u) {
                props.underline = u['@_w:val'] || true;
            }

            // Strike
            if (this.findElement(rPrElement, 'w:strike')) {
                props.strike = true;
            }

            // Font size (w:sz is in half-points)
            const sz = this.findElement(rPrElement, 'w:sz');
            if (sz && sz['@_w:val']) {
                props.fontSize = parseInt(sz['@_w:val']);
            }

            // Font family
            const rFonts = this.findElement(rPrElement, 'w:rFonts');
            if (rFonts) {
                props.fontFamily = rFonts['@_w:ascii'] || rFonts['@_w:hAnsi'];
                props.fontFamilyComplex = rFonts['@_w:cs'];
                props.fontFamilyEastAsia = rFonts['@_w:eastAsia'];
            }

            // Color
            const color = this.findElement(rPrElement, 'w:color');
            if (color && color['@_w:val']) {
                props.color = color['@_w:val'];
            }

            // Highlight
            const highlight = this.findElement(rPrElement, 'w:highlight');
            if (highlight && highlight['@_w:val']) {
                props.highlight = highlight['@_w:val'];
            }

            // Vertical alignment (superscript/subscript)
            const vertAlign = this.findElement(rPrElement, 'w:vertAlign');
            if (vertAlign && vertAlign['@_w:val']) {
                if (vertAlign['@_w:val'] === 'superscript') {
                    props.superscript = true;
                } else if (vertAlign['@_w:val'] === 'subscript') {
                    props.subscript = true;
                }
            }

            // Store complete element for round-trip
            props._originalElement = rPrElement;

        } catch (error) {
            this.debugLog(`Error extracting run properties: ${error}`);
        }

        return props;
    }

    /**
     * Extract styles from styles.xml
     */
    private async extractStyles(zip: JSZip): Promise<DocxStyles> {
        // TODO: Implement full style extraction
        return {
            paragraphStyles: [],
            characterStyles: [],
            tableStyles: [],
            numberingStyles: [],
        };
    }

    /**
     * Extract relationships from document.xml.rels
     */
    private async extractRelationships(zip: JSZip): Promise<DocxRelationships> {
        // TODO: Implement relationship extraction
        return {
            relationships: [],
        };
    }

    /**
     * Extract resources (images, media) from DOCX
     */
    private async extractResources(zip: JSZip, relationships: DocxRelationships): Promise<DocxResources> {
        // TODO: Implement resource extraction
        return {
            images: [],
            fonts: [],
            media: [],
        };
    }

    /**
     * Extract metadata from docProps/core.xml
     */
    private async extractMetadata(zip: JSZip): Promise<DocxMetadata> {
        // TODO: Implement metadata extraction
        return {};
    }

    // ============================================================================
    // XML Helper Methods
    // ============================================================================

    /**
     * Find first element with given tag name in parsed XML
     */
    private findElement(element: any, tagName: string): any {
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
                    const found = this.findElement(item, tagName);
                    if (found) return found;
                }
            } else if (typeof child === 'object') {
                const found = this.findElement(child, tagName);
                if (found) return found;
            }
        }

        return null;
    }

    /**
     * Find all elements with given tag name
     */
    private findAllElements(element: any, tagName: string): any[] {
        const results: any[] = [];

        if (!element || typeof element !== 'object') {
            return results;
        }

        if (element[tagName]) {
            const items = Array.isArray(element[tagName]) ? element[tagName] : [element[tagName]];
            results.push(...items);
        }

        // Search in children
        for (const key of Object.keys(element)) {
            if (key.startsWith('@_') || key === '#text') continue;

            const child = element[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    results.push(...this.findAllElements(item, tagName));
                }
            } else if (typeof child === 'object') {
                results.push(...this.findAllElements(child, tagName));
            }
        }

        return results;
    }

    /**
     * Get text content from element
     */
    private getElementText(element: any): string {
        if (!element) return '';
        if (typeof element === 'string') return element;
        if (element['#text']) return element['#text'];

        let text = '';
        for (const key of Object.keys(element)) {
            if (key.startsWith('@_')) continue;
            const child = element[key];
            if (typeof child === 'string') {
                text += child;
            } else if (typeof child === 'object') {
                text += this.getElementText(child);
            }
        }
        return text;
    }

    /**
     * Convert parsed element back to XML string
     */
    private elementToXml(element: any): string {
        try {
            return this.xmlBuilder.build(element);
        } catch (error) {
            this.debugLog(`Error converting element to XML: ${error}`);
            return '';
        }
    }
}

