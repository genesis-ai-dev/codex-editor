/**
 * IDML XML Parser with round-trip validation
 * Parses InDesign Markup Language (IDML) files while preserving all formatting and IDs
 */

// Note: In a real implementation, you would use a proper XML parser like 'xmldom' or 'fast-xml-parser'
// For now, we'll use the browser's built-in DOMParser
const DOMParser = window.DOMParser;
import JSZip from 'jszip';
import {
    IDMLDocument,
    IDMLStory,
    IDMLParagraph,
    IDMLParagraphStyleRange,
    IDMLCharacterStyleRange,
    IDMLStyles,
    IDMLResources,
    IDMLMetadata,
    IDMLParseError,
    IDMLImportConfig
} from './types';

// Local hashing helpers to avoid test-only imports
function toArrayBufferForHash(input: string | ArrayBuffer): ArrayBuffer {
    if (input instanceof ArrayBuffer) return input;
    return new TextEncoder().encode(input).buffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
    const view = new Uint8Array(bytes);
    let hex = '';
    for (let i = 0; i < view.length; i++) {
        hex += view[i].toString(16).padStart(2, '0');
    }
    return hex;
}

async function computeSHA256(input: string | ArrayBuffer): Promise<string> {
    const cryptoObj: any = (globalThis as any).crypto;
    const data = toArrayBufferForHash(input);
    if (cryptoObj?.subtle?.digest) {
        const digest = await cryptoObj.subtle.digest('SHA-256', data);
        return bytesToHex(digest);
    }
    // Fallback: non-crypto hash to keep function available if SubtleCrypto is absent
    const bytes = new Uint8Array(data);
    let h1 = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h1 ^= bytes[i];
        h1 = (h1 * 0x01000193) >>> 0; // FNV-1a like
    }
    return h1.toString(16).padStart(8, '0');
}

export class IDMLParser {
    private config: IDMLImportConfig;
    private debugCallback?: (message: string) => void;

    constructor(config: Partial<IDMLImportConfig> = {}) {
        this.config = {
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateRoundTrip: true,
            strictMode: false,
            ...config
        };
    }

    setDebugCallback(callback: (message: string) => void) {
        this.debugCallback = callback;
    }

    private debugLog(message: string) {
        if (this.debugCallback) {
            this.debugCallback(message);
        }
    }

    /**
     * Parse IDML content into structured document
     */
    async parseIDML(idmlContent: string | ArrayBuffer): Promise<IDMLDocument> {
        try {
            // Check if this is a ZIP-compressed IDML file
            if (typeof idmlContent === 'string' && idmlContent.startsWith('PK')) {
                return await this.parseZippedIDML(idmlContent);
            } else if (idmlContent instanceof ArrayBuffer) {
                return await this.parseZippedIDMLFromArrayBuffer(idmlContent);
            }

            // Handle simple XML format (for tests)
            if (typeof idmlContent === 'string' && idmlContent.includes('<idPkg:Document')) {
                return await this.parseSimpleXML(idmlContent);
            }

            // Compute original hash for validation
            const originalHash = await computeSHA256(idmlContent);

            // Parse XML
            const parser = new DOMParser();
            const doc = parser.parseFromString(idmlContent, 'text/xml');

            // Check for parsing errors
            const parseError = doc.getElementsByTagName('parsererror')[0];
            if (parseError) {
                throw new IDMLParseError(
                    `XML parsing error: ${parseError.textContent}`,
                    'XML parsing',
                    0,
                    0
                );
            }

            // Extract document structure
            const document = await this.extractDocument(doc, originalHash);

            return document;
        } catch (error) {
            if (error instanceof IDMLParseError) {
                throw error;
            }
            throw new IDMLParseError(
                `Failed to parse IDML: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'IDML parsing'
            );
        }
    }

    /**
     * Parse simple XML format (for tests)
     */
    private async parseSimpleXML(xmlContent: string): Promise<IDMLDocument> {
        const originalHash = await computeSHA256(xmlContent);

        this.debugLog(`Parsing simple XML with hash: ${originalHash}`);

        // Simple placeholder parser for test cases
        const documentId = this.extractAttribute(xmlContent, 'Document', 'id') || 'Document1';

        // Extract stories from simple XML
        const stories = this.extractStoriesFromSimpleXML(xmlContent);

        this.debugLog(`Extracted ${stories.length} stories`);

        const document = {
            id: documentId,
            version: '1.0',
            stories,
            styles: { paragraphStyles: [], characterStyles: [] },
            resources: { fonts: [], colors: [], images: [] },
            metadata: {},
            originalHash
        };

        this.debugLog(`Created document with ID: ${document.id}`);

        return document;
    }

    /**
     * Extract attribute value from XML string
     */
    private extractAttribute(xml: string, tag: string, attribute: string): string | null {
        const regex = new RegExp(`<${tag}[^>]*${attribute}="([^"]*)"`, 'i');
        const match = xml.match(regex);
        return match ? match[1] : null;
    }

    /**
     * Extract stories from simple XML format
     */
    private extractStoriesFromSimpleXML(xml: string): IDMLStory[] {
        const stories: IDMLStory[] = [];

        this.debugLog(`Extracting stories from XML: ${xml.substring(0, 200)}...`);

        // Find all Story elements
        const storyRegex = /<Story[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/Story>/g;
        let match;

        while ((match = storyRegex.exec(xml)) !== null) {
            const storyId = match[1];
            const storyContent = match[2];

            this.debugLog(`Found story with ID: ${storyId}`);

            const story: IDMLStory = {
                id: storyId,
                name: undefined,
                paragraphs: this.extractParagraphsFromStory(storyContent),
                metadata: {}
            };

            stories.push(story);
        }

        this.debugLog(`Total stories extracted: ${stories.length}`);
        return stories;
    }

    /**
     * Extract paragraphs from story content
     */
    private extractParagraphsFromStory(storyContent: string): IDMLParagraph[] {
        const paragraphs: IDMLParagraph[] = [];

        // Find all ParagraphStyleRange elements
        // Case-insensitive match for AppliedParagraphStyle
        const paragraphRegex = /<ParagraphStyleRange[^>]*AppliedParagraphStyle="([^"]*)"[^>]*>([\s\S]*?)<\/ParagraphStyleRange>/gi;
        let match;

        while ((match = paragraphRegex.exec(storyContent)) !== null) {
            const appliedParagraphStyle = match[1];
            const paragraphContent = match[2];
            const fullMatch = match[0];

            // Extract ID from original XML if it exists
            const idMatch = fullMatch.match(/id="([^"]*)"/);
            const originalId = idMatch ? idMatch[1] : undefined;

            const paragraph: IDMLParagraph = {
                id: originalId, // Only         use ID if it existed in original
                paragraphStyleRange: {
                    id: originalId ? `ParaStyle${originalId}` : undefined, // Only generate style ID if paragraph had ID
                    appliedParagraphStyle,
                    properties: {},
                    content: this.extractTextContentFromString(paragraphContent)
                },
                characterStyleRanges: this.extractCharacterRangesFromParagraph(paragraphContent),
                metadata: {}
            };

            paragraphs.push(paragraph);
        }

        return paragraphs;
    }

    /**
     * Extract character style ranges from paragraph content
     */
    private extractCharacterRangesFromParagraph(paragraphContent: string): IDMLCharacterStyleRange[] {
        const ranges: IDMLCharacterStyleRange[] = [];

        // Find all CharacterStyleRange elements
        // Case-insensitive match for AppliedCharacterStyle
        const characterRegex = /<CharacterStyleRange[^>]*AppliedCharacterStyle="([^"]*)"[^>]*>([\s\S]*?)<\/CharacterStyleRange>/gi;
        let match;

        while ((match = characterRegex.exec(paragraphContent)) !== null) {
            const appliedCharacterStyle = match[1];
            const inner = match[2] || '';
            // Only include text inside <Content> nodes
            const content = this.extractTextContentFromString(inner);
            const fullMatch = match[0];

            // Extract ID from original XML if it exists
            const idMatch = fullMatch.match(/id="([^"]*)"/);
            const originalId = idMatch ? idMatch[1] : undefined;

            const range: IDMLCharacterStyleRange = {
                id: originalId, // Only use ID if it existed in original
                appliedCharacterStyle,
                properties: {},
                content,
                startIndex: 0,
                endIndex: content.length
            };

            ranges.push(range);
        }

        return ranges;
    }

    /**
     * Extract text content from HTML/XML string
     */
    private extractTextContentFromString(html: string): string {
        // Preserve order of <Content> and <Br /> by scanning for both
        const parts: string[] = [];
        const tokenRegex = /(<Content>[\s\S]*?<\/Content>)|(<Br\s*\/>)/g;
        let m;
        while ((m = tokenRegex.exec(html)) !== null) {
            if (m[1]) {
                const contentInner = /<Content>([\s\S]*?)<\/Content>/.exec(m[1]);
                parts.push((contentInner?.[1] || ''));
            } else if (m[2]) {
                parts.push('\n');
            }
        }
        const combined = parts.join('');
        // Normalize CRLF to LF and collapse tabs to spaces, but do not trim or strip spaces around newlines
        return combined
            .replace(/\r\n?/g, '\n')
            .replace(/[\t]+/g, ' ');
    }

    /**
     * Extract document structure from parsed XML
     */
    private async extractDocument(doc: Document, originalHash: string): Promise<IDMLDocument> {
        const documentElement = doc.getElementsByTagName('Document')[0];
        if (!documentElement) {
            throw new IDMLParseError('No Document element found in IDML', 'Document extraction');
        }

        const documentId = documentElement.getAttribute('id') || 'Document1';

        // Extract stories
        const stories = await this.extractStories(documentElement);

        // Extract styles
        const styles = await this.extractStyles(doc);

        // Extract resources
        const resources = await this.extractResources(doc);

        // Extract metadata
        const metadata = await this.extractMetadata(doc);

        return {
            id: documentId,
            version: '1.0',
            stories,
            styles,
            resources,
            metadata,
            originalHash
        };
    }

    /**
     * Extract stories from document element
     */
    private async extractStories(documentElement: Element): Promise<IDMLStory[]> {
        const stories: IDMLStory[] = [];
        const storyElements = documentElement.getElementsByTagName('Story');

        this.debugLog(`Found ${storyElements.length} Story elements`);

        for (let i = 0; i < storyElements.length; i++) {
            const storyElement = storyElements[i];
            const story = await this.extractStory(storyElement);
            stories.push(story);
        }

        return stories;
    }

    /**
     * Extract individual story
     */
    private async extractStory(storyElement: Element): Promise<IDMLStory> {
        // IDML often uses capitalized attribute names: 'Self' and 'Name'
        const storyId = storyElement.getAttribute('id') || storyElement.getAttribute('Self') || undefined; // Only use ID if it exists in original
        const storyName = storyElement.getAttribute('name') || storyElement.getAttribute('Name') || undefined;

        this.debugLog(`extractStory: Processing story ${storyId || 'no-id'}, name: ${storyName}`);

        const paragraphs = await this.extractParagraphs(storyElement);

        return {
            id: storyId, // undefined if no ID in original
            name: storyName,
            paragraphs,
            metadata: this.extractElementMetadata(storyElement)
        };
    }

    /**
     * Extract paragraphs from story element
     */
    private async extractParagraphs(storyElement: Element): Promise<IDMLParagraph[]> {
        const paragraphs: IDMLParagraph[] = [];
        const paragraphElements = storyElement.getElementsByTagName('ParagraphStyleRange');

        // Also check for other possible paragraph elements
        const allElements = storyElement.children;
        for (let i = 0; i < allElements.length; i++) {
            const child = allElements[i];
        }

        // Track current book abbreviation and chapter number across paragraphs
        let currentBook = '';
        let currentChapter = '1';

        for (let i = 0; i < paragraphElements.length; i++) {
            const paragraphElement = paragraphElements[i];
            const paragraph = await this.extractParagraph(paragraphElement, currentBook, currentChapter);

            // Update current book if this paragraph defines it
            if ((paragraph.metadata as any)?.bookAbbreviation) {
                currentBook = (paragraph.metadata as any).bookAbbreviation;
                this.debugLog(`Updated current book to: ${currentBook}`);
            }

            // Update current chapter if this paragraph contains a chapter marker
            if ((paragraph.metadata as any)?.lastChapterNumber) {
                currentChapter = (paragraph.metadata as any).lastChapterNumber;
                this.debugLog(`Updated current chapter to: ${currentChapter}`);
            }

            paragraphs.push(paragraph);
        }

        // Post-process to merge verses split across paragraphs
        this.mergeSpanningVerses(paragraphs);

        return paragraphs;
    }

    /**
     * Merge verses that span multiple paragraphs
     * This handles cases where verse content continues across paragraph boundaries
     */
    private mergeSpanningVerses(paragraphs: IDMLParagraph[]): void {
        for (let i = 0; i < paragraphs.length; i++) {
            const currentPara = paragraphs[i];
            const segments = (currentPara.metadata as any)?.biblicaVerseSegments || [];

            if (segments.length === 0) continue;

            // Check each verse segment for missing closing tag
            for (let j = 0; j < segments.length; j++) {
                const segment = segments[j];

                // If this segment doesn't have afterVerse (closing meta:v), it might span to next paragraph
                if (!segment.afterVerse && i + 1 < paragraphs.length) {
                    this.debugLog(`Verse ${segment.bookAbbreviation} ${segment.chapterNumber}:${segment.verseNumber} may span paragraphs`);

                    // Look ahead in subsequent paragraphs for content and closing meta:v
                    let continuedContent = '';
                    let foundClosing = false;
                    let closingTag = '';

                    for (let k = i + 1; k < paragraphs.length && !foundClosing; k++) {
                        const nextPara = paragraphs[k];
                        const nextSegments = (nextPara.metadata as any)?.biblicaVerseSegments || [];

                        // Check if this paragraph has content for our verse
                        // by looking at CharacterStyleRanges before any verse markers
                        const allCSRs = nextPara.characterStyleRanges || [];

                        for (const csr of allCSRs) {
                            const style = csr.appliedCharacterStyle;

                            // If we hit a new verse marker, stop
                            if (style.includes('cv%3av') || style.includes('cv:v')) {
                                break;
                            }

                            // If we find the closing meta:v for our verse
                            if ((style.includes('meta%3av') || style.includes('meta:v')) &&
                                csr.content.trim() === segment.verseNumber) {
                                foundClosing = true;
                                closingTag = `<CharacterStyleRange AppliedCharacterStyle="${csr.appliedCharacterStyle}"><Content>${csr.content}</Content></CharacterStyleRange>`;
                                break;
                            }

                            // Collect content only from default styled ranges
                            // Skip special styled ranges (e.g., "source serif" for apostrophes)
                            if (style.includes('$ID/[No character style]')) {
                                continuedContent += csr.content;
                            }
                        }
                    }

                    // If we found continued content, append it to the verse
                    if (continuedContent) {
                        this.debugLog(`Found continued content for verse ${segment.verseNumber}: "${continuedContent.substring(0, 50)}..."`);
                        segment.verseContent += continuedContent;
                        segment.afterVerse = closingTag;
                        segment.spansMultipleParagraphs = true;
                    }
                }
            }
        }
    }

    /**
     * Extract individual paragraph
     */
    private async extractParagraph(paragraphElement: Element, currentBook: string = '', currentChapter: string = '1'): Promise<IDMLParagraph> {
        const paragraphId = paragraphElement.getAttribute('id') || paragraphElement.getAttribute('Self') || undefined; // Only use ID if it exists in original

        const paragraphStyleRange = await this.extractParagraphStyleRange(paragraphElement);
        const characterStyleRanges = await this.extractCharacterStyleRanges(paragraphElement);

        // Capture trailing CharacterStyleRange blocks without <Content> (e.g., <Br/> with ParagraphBreakType)
        const trailingRuns: string[] = [];
        const childNodes = Array.from(paragraphElement.getElementsByTagName('CharacterStyleRange')) as Element[];
        for (const node of childNodes) {
            const hasContent = node.getElementsByTagName('Content').length > 0;
            if (!hasContent) {
                trailingRuns.push(node.outerHTML);
            }
        }
        if (trailingRuns.length > 0) {
            (paragraphStyleRange as any).dataAfter = trailingRuns;
        }

        // Check if this paragraph contains book metadata (meta:bk)
        const appliedParagraphStyle = paragraphElement.getAttribute('AppliedParagraphStyle') || '';
        if (appliedParagraphStyle.includes('meta%3abk') || appliedParagraphStyle.includes('meta:bk')) {
            // Concatenate all <Content> tags (book abbreviation may be split)
            const contentNodes = paragraphElement.getElementsByTagName('Content');
            let bookAbbrev = '';
            for (let j = 0; j < contentNodes.length; j++) {
                bookAbbrev += (contentNodes[j]?.textContent || '');
            }
            bookAbbrev = bookAbbrev.trim();
            if (bookAbbrev && bookAbbrev.length >= 2 && bookAbbrev.length <= 4) {
                this.debugLog(`Found book abbreviation: ${bookAbbrev}`);
                const metadata = this.extractElementMetadata(paragraphElement) || {};
                (metadata as any).bookAbbreviation = bookAbbrev;
                return {
                    id: paragraphId,
                    paragraphStyleRange,
                    characterStyleRanges,
                    metadata
                };
            }
        }

        // Biblica-specific: detect verse segments using cv%3av and meta%3av markers
        try {
            const verseSegments: Array<{
                bookAbbreviation: string;
                chapterNumber: string;
                verseNumber: string;
                beforeVerse: string;
                verseContent: string;
                afterVerse: string;
            }> = [];
            const csrNodes = Array.from(paragraphElement.getElementsByTagName('CharacterStyleRange')) as Element[];

            // Helper functions to identify character style types
            const isChapterNumberStyle = (el: Element) => {
                const style = el.getAttribute('AppliedCharacterStyle') || '';
                return style.includes('cv%3adc') || style.includes('cv:dc');
            };
            const isVerseNumberStyle = (el: Element) => {
                const style = el.getAttribute('AppliedCharacterStyle') || '';
                return style.includes('cv%3av1') || style.includes('cv%3av') || style.includes('cv:v1') || style.includes('cv:v');
            };
            const isMetaChapterStyle = (el: Element) => {
                const style = el.getAttribute('AppliedCharacterStyle') || '';
                return style.includes('meta%3ac') || style.includes('meta:c');
            };
            const isMetaVerseStyle = (el: Element) => {
                const style = el.getAttribute('AppliedCharacterStyle') || '';
                return style.includes('meta%3av') || style.includes('meta:v');
            };

            const serializer = new XMLSerializer();
            const serializeEl = (el: Element): string => serializer.serializeToString(el);

            let i = 0;
            let chapterInParagraph = currentChapter; // Use the chapter passed from story level
            let lastChapterSeen = currentChapter; // Track the last chapter we saw in this paragraph

            while (i < csrNodes.length) {
                const node = csrNodes[i];

                // Check for chapter number marker (cv:dc)
                if (isChapterNumberStyle(node)) {
                    // Concatenate all <Content> tags (chapter number may be split)
                    const chapterContentNodes = node.getElementsByTagName('Content');
                    let chapterNum = '';
                    for (let j = 0; j < chapterContentNodes.length; j++) {
                        chapterNum += (chapterContentNodes[j]?.textContent || '');
                    }
                    chapterNum = chapterNum.trim();
                    if (chapterNum) {
                        chapterInParagraph = chapterNum;
                        lastChapterSeen = chapterNum;
                        this.debugLog(`Found chapter marker: ${chapterInParagraph}`);
                    }
                    i++;
                    continue;
                }

                // Look for verse number marker (cv:v or cv:v1)
                if (!isVerseNumberStyle(node)) {
                    i++;
                    continue;
                }

                // Extract verse number (may be split across multiple <Content> tags)
                const contentNodes = node.getElementsByTagName('Content');
                let verseNumber = '';
                for (let j = 0; j < contentNodes.length; j++) {
                    verseNumber += (contentNodes[j]?.textContent || '');
                }
                verseNumber = verseNumber.trim();
                if (!verseNumber) {
                    i++;
                    continue;
                }
                this.debugLog(`Found verse number: ${verseNumber} in chapter ${currentChapter}`);
                i++;

                // Skip whitespace/spacing ranges (cv:v1_sp, etc.)
                while (i < csrNodes.length) {
                    const style = csrNodes[i].getAttribute('AppliedCharacterStyle') || '';
                    if (style.includes('_sp') || style.includes('$ID/[No character style]')) {
                        const content = csrNodes[i].getElementsByTagName('Content')[0];
                        const text = (content?.textContent || '').trim();
                        // Only skip if it's just whitespace or empty
                        if (!text || text === ' ') {
                            i++;
                            continue;
                        }
                    }
                    break;
                }

                // Collect "beforeVerse" metadata (meta:c and meta:v)
                let beforeVerse = '';

                // Check for chapter meta (meta:c) - only on first verse of chapter
                if (i < csrNodes.length && isMetaChapterStyle(csrNodes[i])) {
                    beforeVerse += serializeEl(csrNodes[i]);
                    this.debugLog(`Found chapter meta: ${csrNodes[i].textContent}`);
                    i++;
                }

                // Check for verse meta (meta:v) - always present before verse content
                if (i < csrNodes.length && isMetaVerseStyle(csrNodes[i])) {
                    beforeVerse += serializeEl(csrNodes[i]);
                    this.debugLog(`Found verse meta before: ${csrNodes[i].textContent}`);
                    i++;
                }

                // Extract verse content (everything until the next meta:v)
                // Preserve the exact structure: <Content>text</Content><Br/><Content>text</Content>
                let verseContent = '';
                while (i < csrNodes.length && !isMetaVerseStyle(csrNodes[i]) && !isVerseNumberStyle(csrNodes[i])) {
                    const csrNode = csrNodes[i];

                    // Check if this CharacterStyleRange has a special style (not the default)
                    const appliedStyle = csrNode.getAttribute('AppliedCharacterStyle') || '';
                    const isDefaultStyle = appliedStyle.includes('$ID/[No character style]');

                    // Walk through the children in order to preserve Content/Br sequence
                    const children = Array.from(csrNode.childNodes);
                    for (const child of children) {
                        if (child.nodeType === Node.ELEMENT_NODE) {
                            const element = child as Element;
                            if (element.tagName === 'Content') {
                                // Only include content from default styled ranges
                                // Skip content from special styled ranges (e.g., "source serif" for apostrophes)
                                if (isDefaultStyle) {
                                    const text = element.textContent || '';
                                    verseContent += text;
                                }
                            } else if (element.tagName === 'Br') {
                                // Always preserve line breaks regardless of style
                                verseContent += '\n';
                            }
                        }
                    }

                    i++;
                }

                // Collect "afterVerse" metadata (closing meta:v)
                let afterVerse = '';
                if (i < csrNodes.length && isMetaVerseStyle(csrNodes[i])) {
                    afterVerse = serializeEl(csrNodes[i]);
                    this.debugLog(`Found verse meta after: ${csrNodes[i].textContent}`);
                    i++;
                }

                // Skip trailing <Br/> or whitespace before next verse
                while (i < csrNodes.length && !isVerseNumberStyle(csrNodes[i]) && !isMetaVerseStyle(csrNodes[i])) {
                    const style = csrNodes[i].getAttribute('AppliedCharacterStyle') || '';
                    if (style.includes('$ID/[No character style]')) {
                        const hasOnlyBr = csrNodes[i].getElementsByTagName('Br').length > 0 &&
                            csrNodes[i].getElementsByTagName('Content').length === 0;
                        const contentNode = csrNodes[i].getElementsByTagName('Content')[0];
                        const isEmpty = !contentNode || !(contentNode.textContent || '').trim();

                        if (hasOnlyBr || isEmpty) {
                            i++;
                            continue;
                        }
                    }
                    break;
                }

                // Store the verse segment if we have valid content
                // Don't trim - preserve leading/trailing spaces for exact round-trip
                if (verseNumber && verseContent) {
                    verseSegments.push({
                        bookAbbreviation: currentBook,
                        chapterNumber: chapterInParagraph,
                        verseNumber,
                        beforeVerse,
                        verseContent: verseContent,
                        afterVerse
                    });
                    this.debugLog(`Extracted verse ${currentBook} ${chapterInParagraph}:${verseNumber} - "${verseContent.substring(0, 50)}..."`);
                }
            }

            if (verseSegments.length > 0) {
                this.debugLog(`Successfully extracted ${verseSegments.length} verse(s) from paragraph`);
            }

            const metadata = this.extractElementMetadata(paragraphElement) || {};
            (metadata as any).biblicaVerseSegments = verseSegments;
            // Store the last chapter number seen in this paragraph so the story can track it
            if (lastChapterSeen !== currentChapter) {
                (metadata as any).lastChapterNumber = lastChapterSeen;
            }

            return {
                id: paragraphId,
                paragraphStyleRange,
                characterStyleRanges,
                metadata
            };
        } catch (err) {
            // Fallback to default behavior
            this.debugLog(`Verse segment parsing failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return {
                id: paragraphId,
                paragraphStyleRange,
                characterStyleRanges,
                metadata: this.extractElementMetadata(paragraphElement)
            };
        }
    }

    /**
     * Extract paragraph style range
     */
    private async extractParagraphStyleRange(paragraphElement: Element): Promise<IDMLParagraphStyleRange> {
        const id = paragraphElement.getAttribute('id') || paragraphElement.getAttribute('Self') || undefined; // Only use ID if it exists in original
        // Read AppliedParagraphStyle regardless of attribute casing
        const appliedParagraphStyle =
            paragraphElement.getAttribute('AppliedParagraphStyle') ||
            paragraphElement.getAttribute('appliedParagraphStyle') ||
            'ParagraphStyle/$ID/NormalParagraphStyle';

        const properties = this.extractParagraphProperties(paragraphElement);
        const content = this.extractTextContent(paragraphElement);

        return {
            id, // undefined if no ID in original
            appliedParagraphStyle,
            properties,
            content
        };
    }

    /**
     * Extract character style ranges from paragraph
     * Filters out special-styled ranges (e.g., "source serif" for apostrophes)
     * while preserving line breaks by merging adjacent default-styled ranges
     */
    private async extractCharacterStyleRanges(paragraphElement: Element): Promise<IDMLCharacterStyleRange[]> {
        const characterElements = paragraphElement.getElementsByTagName('CharacterStyleRange');

        // First pass: extract all ranges
        const allRanges: IDMLCharacterStyleRange[] = [];
        for (let i = 0; i < characterElements.length; i++) {
            const characterElement = characterElements[i];
            const characterRange = await this.extractCharacterStyleRange(characterElement);
            allRanges.push(characterRange);
        }

        // Second pass: merge default-styled ranges and handle special styles
        const mergedRanges: IDMLCharacterStyleRange[] = [];
        let currentMergedRange: IDMLCharacterStyleRange | null = null;

        for (const range of allRanges) {
            const isDefaultStyle = range.appliedCharacterStyle.includes('$ID/[No character style]');
            const isSourceSerifStyle = range.appliedCharacterStyle.includes('source serif');

            if (isDefaultStyle) {
                if (currentMergedRange && currentMergedRange.appliedCharacterStyle === range.appliedCharacterStyle) {
                    // Merge with the current range (same style)
                    currentMergedRange.content += range.content;
                    currentMergedRange.endIndex = range.endIndex;
                } else {
                    // Push previous merged range if it exists
                    if (currentMergedRange) {
                        mergedRanges.push(currentMergedRange);
                    }
                    // Start a new merged range
                    currentMergedRange = { ...range };
                }
            } else if (isSourceSerifStyle) {
                // Skip "source serif" style (apostrophes), but preserve any line breaks
                const lineBreakCount = (range.content.match(/\n/g) || []).length;
                if (lineBreakCount > 0 && currentMergedRange) {
                    currentMergedRange.content += '\n'.repeat(lineBreakCount);
                }
                // Continue merging - don't break the current range
            } else {
                // Other non-default styles (e.g., "ior") should be preserved as separate ranges
                // Push the current merged range if it exists
                if (currentMergedRange) {
                    mergedRanges.push(currentMergedRange);
                    currentMergedRange = null;
                }
                // Add this special-styled range as-is
                mergedRanges.push(range);
            }
        }

        // Add the final merged range if it exists
        if (currentMergedRange) {
            mergedRanges.push(currentMergedRange);
        }

        return mergedRanges;
    }

    /**
     * Extract individual character style range
     */
    private async extractCharacterStyleRange(characterElement: Element): Promise<IDMLCharacterStyleRange> {
        const id = characterElement.getAttribute('id') || undefined; // Only use ID if it exists in original
        // Read AppliedCharacterStyle regardless of attribute casing
        const appliedCharacterStyle =
            characterElement.getAttribute('AppliedCharacterStyle') ||
            characterElement.getAttribute('appliedCharacterStyle') ||
            'CharacterStyle/$ID/NormalCharacterStyle';

        const properties = this.extractCharacterProperties(characterElement);
        const content = this.extractTextContent(characterElement);

        // Calculate start and end indices based on position in paragraph
        const startIndex = this.calculateCharacterIndex(characterElement, true);
        const endIndex = startIndex + content.length;

        return {
            id, // undefined if no ID in original
            appliedCharacterStyle,
            properties,
            content,
            startIndex,
            endIndex
        };
    }

    /**
     * Extract paragraph properties
     */
    private extractParagraphProperties(element: Element): Record<string, any> {
        const properties: Record<string, any> = {};

        // Extract common paragraph properties
        const justification = element.getAttribute('justification');
        if (justification) properties.justification = justification;

        const spaceBefore = element.getAttribute('spaceBefore');
        if (spaceBefore) properties.spaceBefore = parseFloat(spaceBefore);

        const spaceAfter = element.getAttribute('spaceAfter');
        if (spaceAfter) properties.spaceAfter = parseFloat(spaceAfter);

        const firstLineIndent = element.getAttribute('firstLineIndent');
        if (firstLineIndent) properties.firstLineIndent = parseFloat(firstLineIndent);

        const leftIndent = element.getAttribute('leftIndent');
        if (leftIndent) properties.leftIndent = parseFloat(leftIndent);

        const rightIndent = element.getAttribute('rightIndent');
        if (rightIndent) properties.rightIndent = parseFloat(rightIndent);

        // Extract tab stops
        const tabStops = this.extractTabStops(element);
        if (tabStops.length > 0) properties.tabStops = tabStops;

        return properties;
    }

    /**
     * Extract character properties
     */
    private extractCharacterProperties(element: Element): Record<string, any> {
        const properties: Record<string, any> = {};

        // Extract common character properties
        const fontFamily = element.getAttribute('fontFamily');
        if (fontFamily) properties.fontFamily = fontFamily;

        const fontSize = element.getAttribute('fontSize');
        if (fontSize) properties.fontSize = parseFloat(fontSize);

        const fontWeight = element.getAttribute('fontWeight');
        if (fontWeight) properties.fontWeight = fontWeight;

        const fontStyle = element.getAttribute('fontStyle');
        if (fontStyle) properties.fontStyle = fontStyle;

        const color = element.getAttribute('color');
        if (color) properties.color = color;

        const backgroundColor = element.getAttribute('backgroundColor');
        if (backgroundColor) properties.backgroundColor = backgroundColor;

        const underline = element.getAttribute('underline');
        if (underline) properties.underline = underline === 'true';

        const strikethrough = element.getAttribute('strikethrough');
        if (strikethrough) properties.strikethrough = strikethrough === 'true';

        const superscript = element.getAttribute('superscript');
        if (superscript) properties.superscript = superscript === 'true';

        const subscript = element.getAttribute('subscript');
        if (subscript) properties.subscript = subscript === 'true';

        // Extract Tracking attribute (case-sensitive, as it appears in IDML)
        const tracking = element.getAttribute('Tracking');
        if (tracking) properties.tracking = tracking;

        return properties;
    }

    /**
     * Extract tab stops from element
     */
    private extractTabStops(element: Element): Array<{ position: number; alignment: string; leader?: string; }> {
        const tabStops: Array<{ position: number; alignment: string; leader?: string; }> = [];
        const tabStopElements = element.getElementsByTagName('TabStop');

        for (let i = 0; i < tabStopElements.length; i++) {
            const tabStopElement = tabStopElements[i];
            const position = parseFloat(tabStopElement.getAttribute('position') || '0');
            const alignment = tabStopElement.getAttribute('alignment') || 'left';
            const leader = tabStopElement.getAttribute('leader') || undefined;

            tabStops.push({ position, alignment, leader });
        }

        return tabStops;
    }

    /**
     * Extract text content from element
     */
    private extractTextContent(element: Element): string {
        // Walk children in order, appending Content text and newline for <Br />
        let combined = '';
        const visit = (el: Element) => {
            for (let i = 0; i < el.childNodes.length; i++) {
                const node = el.childNodes[i] as any;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const child = node as Element;
                    const tag = child.tagName;
                    if (tag === 'Content') {
                        combined += child.textContent || '';
                    } else if (tag === 'Br') {
                        combined += '\n';
                    } else {
                        visit(child);
                    }
                }
            }
        };
        visit(element);
        return combined
            .replace(/\r\n?/g, '\n')
            .replace(/[\t]+/g, ' ');
    }

    /**
     * Calculate character index within paragraph
     */
    private calculateCharacterIndex(characterElement: Element, isStart: boolean): number {
        let index = 0;
        const paragraphElement = characterElement.parentElement;
        if (!paragraphElement) return 0;

        const allCharacterElements = paragraphElement.getElementsByTagName('CharacterStyleRange');

        for (let i = 0; i < allCharacterElements.length; i++) {
            const currentElement = allCharacterElements[i];
            if (currentElement === characterElement) {
                return index;
            }
            index += this.extractTextContent(currentElement).length;
        }

        return index;
    }

    /**
     * Extract styles from document
     */
    private async extractStyles(doc: Document): Promise<IDMLStyles> {
        const paragraphStyles = await this.extractParagraphStyles(doc);
        const characterStyles = await this.extractCharacterStyles(doc);

        return {
            paragraphStyles,
            characterStyles
        };
    }

    /**
     * Extract paragraph styles
     */
    private async extractParagraphStyles(doc: Document): Promise<any[]> {
        const styles: any[] = [];
        const styleElements = doc.getElementsByTagName('ParagraphStyle');

        for (let i = 0; i < styleElements.length; i++) {
            const styleElement = styleElements[i];
            const style = {
                id: styleElement.getAttribute('id') || `ParaStyle${i}`,
                name: styleElement.getAttribute('name') || `Paragraph Style ${i}`,
                properties: this.extractParagraphProperties(styleElement),
                basedOn: styleElement.getAttribute('basedOn') || undefined,
                nextStyle: styleElement.getAttribute('nextStyle') || undefined
            };
            styles.push(style);
        }

        return styles;
    }

    /**
     * Extract character styles
     */
    private async extractCharacterStyles(doc: Document): Promise<any[]> {
        const styles: any[] = [];
        const styleElements = doc.getElementsByTagName('CharacterStyle');

        for (let i = 0; i < styleElements.length; i++) {
            const styleElement = styleElements[i];
            const style = {
                id: styleElement.getAttribute('id') || `CharStyle${i}`,
                name: styleElement.getAttribute('name') || `Character Style ${i}`,
                properties: this.extractCharacterProperties(styleElement),
                basedOn: styleElement.getAttribute('basedOn') || undefined
            };
            styles.push(style);
        }

        return styles;
    }

    /**
     * Extract resources from document
     */
    private async extractResources(doc: Document): Promise<IDMLResources> {
        return {
            fonts: await this.extractFonts(doc),
            colors: await this.extractColors(doc),
            images: await this.extractImages(doc)
        };
    }

    /**
     * Extract fonts
     */
    private async extractFonts(doc: Document): Promise<any[]> {
        const fonts: any[] = [];
        const fontElements = doc.getElementsByTagName('Font');

        for (let i = 0; i < fontElements.length; i++) {
            const fontElement = fontElements[i];
            const font = {
                id: fontElement.getAttribute('id') || `Font${i}`,
                name: fontElement.getAttribute('name') || `Font ${i}`,
                family: fontElement.getAttribute('family') || 'Arial',
                style: fontElement.getAttribute('style') || 'Regular',
                embedded: fontElement.getAttribute('embedded') === 'true'
            };
            fonts.push(font);
        }

        return fonts;
    }

    /**
     * Extract colors
     */
    private async extractColors(doc: Document): Promise<any[]> {
        const colors: any[] = [];
        const colorElements = doc.getElementsByTagName('Color');

        for (let i = 0; i < colorElements.length; i++) {
            const colorElement = colorElements[i];
            const color = {
                id: colorElement.getAttribute('id') || `Color${i}`,
                name: colorElement.getAttribute('name') || `Color ${i}`,
                type: colorElement.getAttribute('type') || 'RGB',
                values: this.parseColorValues(colorElement.getAttribute('values') || '0,0,0')
            };
            colors.push(color);
        }

        return colors;
    }

    /**
     * Extract images
     */
    private async extractImages(doc: Document): Promise<any[]> {
        const images: any[] = [];
        const imageElements = doc.getElementsByTagName('Image');

        for (let i = 0; i < imageElements.length; i++) {
            const imageElement = imageElements[i];
            const image = {
                id: imageElement.getAttribute('id') || `Image${i}`,
                href: imageElement.getAttribute('href') || '',
                width: parseFloat(imageElement.getAttribute('width') || '0'),
                height: parseFloat(imageElement.getAttribute('height') || '0'),
                resolution: parseFloat(imageElement.getAttribute('resolution') || '72')
            };
            images.push(image);
        }

        return images;
    }

    /**
     * Extract metadata from document
     */
    private async extractMetadata(doc: Document): Promise<IDMLMetadata> {
        const metadata: IDMLMetadata = {};

        const titleElement = doc.getElementsByTagName('title')[0];
        if (titleElement) metadata.title = titleElement.textContent || undefined;

        const authorElement = doc.getElementsByTagName('author')[0];
        if (authorElement) metadata.author = authorElement.textContent || undefined;

        const createdDateElement = doc.getElementsByTagName('createdDate')[0];
        if (createdDateElement) metadata.createdDate = createdDateElement.textContent || undefined;

        const modifiedDateElement = doc.getElementsByTagName('modifiedDate')[0];
        if (modifiedDateElement) metadata.modifiedDate = modifiedDateElement.textContent || undefined;

        const documentIdElement = doc.getElementsByTagName('documentId')[0];
        if (documentIdElement) metadata.documentId = documentIdElement.textContent || undefined;

        return metadata;
    }

    /**
     * Extract metadata from any element
     */
    private extractElementMetadata(element: Element): Record<string, any> {
        const metadata: Record<string, any> = {};

        // Extract all attributes as metadata
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            metadata[attr.name] = attr.value;
        }

        return metadata;
    }

    /**
     * Parse color values from string
     */
    private parseColorValues(valuesString: string): number[] {
        return valuesString.split(',').map(v => parseFloat(v.trim()));
    }

    /**
     * Parse ZIP-compressed IDML file from ArrayBuffer
     */
    private async parseZippedIDMLFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<IDMLDocument> {
        try {
            this.debugLog(`parseZippedIDMLFromArrayBuffer: ArrayBuffer size: ${arrayBuffer.byteLength}`);

            // Load ZIP file directly from ArrayBuffer
            const zip = new JSZip();
            await zip.loadAsync(arrayBuffer);
            this.debugLog('parseZippedIDMLFromArrayBuffer: ZIP loaded successfully');

            // List all files in the ZIP
            const fileNames = Object.keys(zip.files);
            this.debugLog(`parseZippedIDMLFromArrayBuffer: Total files: ${fileNames.length}`);

            // Log each file with its size
            for (const fileName of fileNames) {
                const file = zip.files[fileName];
                this.debugLog(`File: ${fileName}, Dir: ${file.dir}`);
            }

            // Extract designmap.xml (main document structure)
            const designmapFile = zip.file('designmap.xml');
            if (!designmapFile) {
                this.debugLog('parseZippedIDMLFromArrayBuffer: designmap.xml not found');
                // Try alternative names
                const altNames = ['Designmap.xml', 'DESIGNMAP.XML', 'designmap'];
                for (const altName of altNames) {
                    const altFile = zip.file(altName);
                    if (altFile) {
                        this.debugLog(`parseZippedIDMLFromArrayBuffer: Found alternative: ${altName}`);
                        break;
                    }
                }
                throw new IDMLParseError('Missing designmap.xml', 'IDML file does not contain required designmap.xml');
            }
            this.debugLog('parseZippedIDMLFromArrayBuffer: designmap.xml found');

            const designmapContent = await designmapFile.async('text');
            this.debugLog(`parseZippedIDMLFromArrayBuffer: designmap.xml content length: ${designmapContent.length}`);

            const parser = new DOMParser();
            const designmapDoc = parser.parseFromString(designmapContent, 'text/xml');

            // Check for parsing errors
            const parseError = designmapDoc.getElementsByTagName('parsererror')[0];
            if (parseError) {
                this.debugLog(`parseZippedIDMLFromArrayBuffer: XML parsing error: ${parseError.textContent}`);
                throw new IDMLParseError('XML parsing error in designmap.xml', parseError.textContent || 'Unknown parsing error');
            }

            // Extract stories from designmap
            const stories: IDMLStory[] = [];

            // Build list of story srcs from designmap (prefer explicit idPkg:Story entries)
            const storySrcs: string[] = [];
            const storyPkgNodes = Array.from(designmapDoc.getElementsByTagName('idPkg:Story')) as Element[];
            if (storyPkgNodes.length > 0) {
                for (const node of storyPkgNodes) {
                    const src = node.getAttribute('src');
                    if (src) storySrcs.push(src);
                }
            } else {
                // Fallback for XML parsers that drop namespace prefix: look for Story nodes with src
                const genericStoryNodes = Array.from(designmapDoc.getElementsByTagName('Story')) as Element[];
                for (const node of genericStoryNodes) {
                    const src = node.getAttribute('src');
                    if (src) storySrcs.push(src);
                }
            }

            // Secondary fallback: some documents expose StoryList attribute of raw IDs
            const documentElement = designmapDoc.documentElement;
            const storyListAttr = documentElement.getAttribute('StoryList');
            if (storyListAttr) {
                const storyIds = storyListAttr.split(' ').filter(id => id.trim());
                for (const id of storyIds) {
                    const withPrefix = `Stories/Story_${id}.xml`;
                    const withUPrefix = `Stories/Story_u${id}.xml`;
                    if (zip.file(withPrefix)) storySrcs.push(withPrefix);
                    else if (zip.file(withUPrefix)) storySrcs.push(withUPrefix);
                    else this.debugLog(`parseZippedIDMLFromArrayBuffer: Story file not found for ID: ${id}`);
                }
            }

            // Deduplicate sources while preserving order
            const seen = new Set<string>();
            const uniqueSrcs = storySrcs.filter((s) => (s = s.replace(/^\.\//, ''), !seen.has(s) && seen.add(s)));

            for (const src of uniqueSrcs) {
                const normalizedSrc = src.replace(/^\.\//, '');
                const storyFile = zip.file(normalizedSrc);
                if (!storyFile) continue;
                const storyContent = await storyFile.async('text');
                const storyDoc = parser.parseFromString(storyContent, 'text/xml');
                // Find the inner Story element if present; fallback to root
                const innerStory = storyDoc.getElementsByTagName('Story')[0] || storyDoc.documentElement;
                const story = await this.extractStory(innerStory);
                stories.push(story);
            }

            this.debugLog(`parseZippedIDMLFromArrayBuffer: Total stories extracted: ${stories.length}`);

            // Extract styles and resources
            const styles = await this.extractStylesFromZip(zip);
            const resources = await this.extractResourcesFromZip(zip);

            // Create document
            const document: IDMLDocument = {
                id: designmapDoc.documentElement.getAttribute('Self') || 'document_1',
                version: designmapDoc.documentElement.getAttribute('Version') || '1.0',
                stories,
                styles,
                resources,
                metadata: {
                    title: designmapDoc.documentElement.getAttribute('Name') || 'Untitled Document',
                    creator: 'InDesign',
                    created: new Date().toISOString(),
                    modified: new Date().toISOString()
                },
                originalHash: await computeSHA256(arrayBuffer)
            };

            return document;

        } catch (error) {
            if (error instanceof IDMLParseError) {
                throw error;
            }
            throw new IDMLParseError('ZIP parsing error', error instanceof Error ? error.message : 'Unknown ZIP parsing error');
        }
    }

    /**
     * Parse ZIP-compressed IDML file
     */
    private async parseZippedIDML(zipContent: string): Promise<IDMLDocument> {
        try {
            // Convert string to ArrayBuffer for JSZip
            const arrayBuffer = new TextEncoder().encode(zipContent).buffer;

            // Load ZIP file
            const zip = new JSZip();
            await zip.loadAsync(arrayBuffer);

            // List all files in the ZIP
            const fileNames = Object.keys(zip.files);

            // Extract designmap.xml (main document structure)
            const designmapFile = zip.file('designmap.xml');
            if (!designmapFile) {
                throw new IDMLParseError('Missing designmap.xml', 'IDML file does not contain required designmap.xml');
            }

            const designmapContent = await designmapFile.async('text');
            const parser = new DOMParser();
            const designmapDoc = parser.parseFromString(designmapContent, 'text/xml');

            // Check for parsing errors
            const parseError = designmapDoc.getElementsByTagName('parsererror')[0];
            if (parseError) {
                throw new IDMLParseError('XML parsing error in designmap.xml', parseError.textContent || 'Unknown parsing error');
            }

            // Extract stories from designmap
            const stories: IDMLStory[] = [];
            const storyElements = designmapDoc.getElementsByTagName('Story');

            for (let i = 0; i < storyElements.length; i++) {
                const storyElement = storyElements[i];
                const storyId = storyElement.getAttribute('Self') || `story_${i}`;
                const storyName = storyElement.getAttribute('Name') || `Story ${i + 1}`;

                // Extract story content from separate XML files
                const storyFile = zip.file(`Stories/Story_${storyId}.xml`);
                if (storyFile) {
                    const storyContent = await storyFile.async('text');
                    const storyDoc = parser.parseFromString(storyContent, 'text/xml');

                    const story = await this.extractStory(storyDoc.documentElement);
                    stories.push(story);
                }
            }

            // Extract styles and resources
            const styles = await this.extractStylesFromZip(zip);
            const resources = await this.extractResourcesFromZip(zip);

            // Create document
            const document: IDMLDocument = {
                id: designmapDoc.documentElement.getAttribute('Self') || 'document_1',
                version: designmapDoc.documentElement.getAttribute('Version') || '1.0',
                stories,
                styles,
                resources,
                metadata: {
                    title: designmapDoc.documentElement.getAttribute('Name') || 'Untitled Document',
                    creator: 'InDesign',
                    created: new Date().toISOString(),
                    modified: new Date().toISOString()
                },
                originalHash: await computeSHA256(zipContent)
            };

            return document;

        } catch (error) {
            if (error instanceof IDMLParseError) {
                throw error;
            }
            throw new IDMLParseError('ZIP parsing error', error instanceof Error ? error.message : 'Unknown ZIP parsing error');
        }
    }

    /**
     * Extract styles from ZIP file
     */
    private async extractStylesFromZip(zip: JSZip): Promise<IDMLStyles> {
        const styles: IDMLStyles = {
            paragraphStyles: [],
            characterStyles: []
        };

        // Extract paragraph styles
        const paraStylesFile = zip.file('Styles/ParagraphStyles.xml');
        if (paraStylesFile) {
            const content = await paraStylesFile.async('text');
            const doc = new DOMParser().parseFromString(content, 'text/xml');
            const styleElements = doc.getElementsByTagName('ParagraphStyle');

            for (let i = 0; i < styleElements.length; i++) {
                const styleElement = styleElements[i];
                const styleId = styleElement.getAttribute('Self') || `para_style_${i}`;
                const styleName = styleElement.getAttribute('Name') || `Paragraph Style ${i + 1}`;

                styles.paragraphStyles.push({
                    id: styleId,
                    name: styleName,
                    properties: this.extractElementMetadata(styleElement)
                });
            }
        }

        // Extract character styles
        const charStylesFile = zip.file('Styles/CharacterStyles.xml');
        if (charStylesFile) {
            const content = await charStylesFile.async('text');
            const doc = new DOMParser().parseFromString(content, 'text/xml');
            const styleElements = doc.getElementsByTagName('CharacterStyle');

            for (let i = 0; i < styleElements.length; i++) {
                const styleElement = styleElements[i];
                const styleId = styleElement.getAttribute('Self') || `char_style_${i}`;
                const styleName = styleElement.getAttribute('Name') || `Character Style ${i + 1}`;

                styles.characterStyles.push({
                    id: styleId,
                    name: styleName,
                    properties: this.extractElementMetadata(styleElement)
                });
            }
        }

        return styles;
    }

    /**
     * Extract resources from ZIP file
     */
    private async extractResourcesFromZip(zip: JSZip): Promise<IDMLResources> {
        const resources: IDMLResources = {
            fonts: [],
            colors: [],
            images: []
        };

        // Extract fonts
        const fontsFile = zip.file('Resources/Fonts.xml');
        if (fontsFile) {
            const content = await fontsFile.async('text');
            const doc = new DOMParser().parseFromString(content, 'text/xml');
            const fontElements = doc.getElementsByTagName('Font');

            for (let i = 0; i < fontElements.length; i++) {
                const fontElement = fontElements[i];
                const fontId = fontElement.getAttribute('Self') || `font_${i}`;
                const fontName = fontElement.getAttribute('Name') || `Font ${i + 1}`;

                resources.fonts.push({
                    id: fontId,
                    name: fontName,
                    family: fontElement.getAttribute('Family') || fontName,
                    style: fontElement.getAttribute('Style') || 'Regular',
                    embedded: fontElement.getAttribute('Embedded') === 'true'
                });
            }
        }

        // Extract colors
        const colorsFile = zip.file('Resources/Color.xml');
        if (colorsFile) {
            const content = await colorsFile.async('text');
            const doc = new DOMParser().parseFromString(content, 'text/xml');
            const colorElements = doc.getElementsByTagName('Color');

            for (let i = 0; i < colorElements.length; i++) {
                const colorElement = colorElements[i];
                const colorId = colorElement.getAttribute('Self') || `color_${i}`;
                const colorName = colorElement.getAttribute('Name') || `Color ${i + 1}`;

                resources.colors.push({
                    id: colorId,
                    name: colorName,
                    type: (colorElement.getAttribute('Type') as 'CMYK' | 'RGB' | 'Spot' | 'MixedInk') || 'RGB',
                    values: this.parseColorValues(colorElement.getAttribute('Values') || '0,0,0')
                });
            }
        }

        return resources;
    }
}
