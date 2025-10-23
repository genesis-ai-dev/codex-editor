/**
 * IDML Exporter for round-trip functionality with Biblica verse support
 * Converts structured IDML document back to XML format
 * This file contains two types of exporters:
 * 1. IDMLExporter class: Browser-based exporter using parsed IDMLDocument (for webviews)
 * 2. exportIdmlRoundtrip function: Node.js-compatible exporter supporting both:
 *    - Biblica verse-based replacement (using cv:v and meta:v structure tags)
 *    - Generic paragraph-based replacement (fallback for non-Biblica content)
 */

import {
    IDMLDocument,
    IDMLStory,
    IDMLParagraph,
    IDMLParagraphStyleRange,
    IDMLCharacterStyleRange,
    IDMLStyles,
    IDMLResources,
    IDMLMetadata,
    IDMLExportError,
    IDMLExportConfig
} from './types';

// Import JSZip for Node.js environment
import JSZip from 'jszip';

// Local hashing (matches idmlParser.ts behavior)
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
    // Fallback: simple non-crypto hash for environments without SubtleCrypto
    const bytes = new Uint8Array(data);
    let h1 = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h1 ^= bytes[i];
        h1 = (h1 * 0x01000193) >>> 0; // FNV-1a like
    }
    return h1.toString(16).padStart(8, '0');
}

export class IDMLExporter {
    private config: IDMLExportConfig;

    constructor(config: Partial<IDMLExportConfig> = {}) {
        this.config = {
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateOutput: true,
            strictMode: false,
            ...config
        };
    }

    /**
     * Export IDML document to XML string
     */
    async exportToIDML(document: IDMLDocument): Promise<string> {
        try {
            const xmlContent = this.buildIDMLXML(document);

            if (this.config.validateOutput) {
                await this.validateExportedXML(xmlContent, document);
            }

            return xmlContent;
        } catch (error) {
            throw new IDMLExportError(
                `Failed to export IDML: ${error instanceof Error ? error.message : 'Unknown error'}`,
                this.config,
                document
            );
        }
    }

    /**
     * Build complete IDML XML structure
     */
    private buildIDMLXML(document: IDMLDocument): string {
        const storiesXML = this.buildStoriesXML(document.stories);
        const stylesXML = this.buildStylesXML(document.styles);
        const resourcesXML = this.buildResourcesXML(document.resources);
        const metadataXML = this.buildMetadataXML(document.metadata);

        // Only include sections that have content
        const sections = [];
        if (stylesXML.trim()) sections.push(stylesXML);
        if (resourcesXML.trim()) sections.push(resourcesXML);
        if (metadataXML.trim()) sections.push(metadataXML);

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="20.0(32)" ?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.0" Self="${this.escapeXML(document.id)}" StoryList="${this.buildStoryList(document.stories)}" Name="${this.escapeXML(document.metadata?.title || 'Document')}" ZeroPoint="0 0" ActiveLayer="ub7" CMYKProfile="$ID/" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendIntent="UseColorSettings">
        ${storiesXML}${sections.length > 0 ? '\n    ' + sections.join('\n    ') : ''}
</idPkg:Document>`;
    }

    /**
     * Build story list string for Document attributes
     */
    private buildStoryList(stories: IDMLStory[]): string {
        return stories.filter(story => story.id).map(story => story.id).join(' ');
    }

    /**
     * Build stories XML
     */
    private buildStoriesXML(stories: IDMLStory[]): string {
        return stories.map(story => this.buildStoryXML(story)).join('\n        ');
    }

    /**
     * Build individual story XML
     */
    private buildStoryXML(story: IDMLStory): string {
        const idAttr = story.id ? ` id="${this.escapeXML(story.id)}"` : '';
        const nameAttr = story.name ? ` name="${this.escapeXML(story.name)}"` : '';
        const metadataAttrs = this.buildMetadataAttributes(story.metadata);

        const paragraphsXML = story.paragraphs.map(paragraph => this.buildParagraphXML(paragraph)).join('\n            ');

        return `<Story${idAttr}${nameAttr}${metadataAttrs}>
            ${paragraphsXML}
        </Story>`;
    }

    /**
     * Build paragraph XML
     */
    private buildParagraphXML(paragraph: IDMLParagraph): string {
        const metadataAttrs = this.buildMetadataAttributes(paragraph.metadata);
        const paragraphStyleAttrs = this.buildParagraphPropertiesAttributes(paragraph.paragraphStyleRange.properties);

        const characterRangesXML = paragraph.characterStyleRanges
            .map(range => this.buildCharacterStyleRangeXML(range))
            .join('\n                ');

        // Only include id if it was present in the original (not auto-generated)
        const idAttr = paragraph.id ? ` id="${this.escapeXML(paragraph.id)}"` : '';

        return `<ParagraphStyleRange${idAttr} appliedParagraphStyle="${this.escapeXML(paragraph.paragraphStyleRange.appliedParagraphStyle)}"${paragraphStyleAttrs}${metadataAttrs}>
                ${characterRangesXML}
            </ParagraphStyleRange>`;
    }

    /**
     * Build paragraph style range XML
     */
    private buildParagraphStyleRangeXML(styleRange: IDMLParagraphStyleRange): string {
        const propertiesAttrs = this.buildParagraphPropertiesAttributes(styleRange.properties);
        const idAttr = styleRange.id ? ` id="${this.escapeXML(styleRange.id)}"` : '';

        return `<ParagraphStyleRange${idAttr} appliedParagraphStyle="${this.escapeXML(styleRange.appliedParagraphStyle)}"${propertiesAttrs}>
                    ${this.escapeXML(styleRange.content)}
                </ParagraphStyleRange>`;
    }

    /**
     * Build character style range XML
     */
    private buildCharacterStyleRangeXML(styleRange: IDMLCharacterStyleRange): string {
        const propertiesAttrs = this.buildCharacterPropertiesAttributes(styleRange.properties);

        // Only include id if it was present in the original (not auto-generated)
        const idAttr = styleRange.id ? ` id="${this.escapeXML(styleRange.id)}"` : '';

        return `<CharacterStyleRange${idAttr} appliedCharacterStyle="${this.escapeXML(styleRange.appliedCharacterStyle)}"${propertiesAttrs}>
                    ${this.escapeXML(styleRange.content)}
                </CharacterStyleRange>`;
    }

    /**
     * Build paragraph properties attributes
     */
    private buildParagraphPropertiesAttributes(properties: Record<string, any>): string {
        const attrs: string[] = [];

        if (properties.justification) {
            attrs.push(`justification="${this.escapeXML(properties.justification)}"`);
        }
        if (properties.spaceBefore !== undefined) {
            attrs.push(`spaceBefore="${properties.spaceBefore}"`);
        }
        if (properties.spaceAfter !== undefined) {
            attrs.push(`spaceAfter="${properties.spaceAfter}"`);
        }
        if (properties.firstLineIndent !== undefined) {
            attrs.push(`firstLineIndent="${properties.firstLineIndent}"`);
        }
        if (properties.leftIndent !== undefined) {
            attrs.push(`leftIndent="${properties.leftIndent}"`);
        }
        if (properties.rightIndent !== undefined) {
            attrs.push(`rightIndent="${properties.rightIndent}"`);
        }
        if (properties.tabStops && properties.tabStops.length > 0) {
            attrs.push(`tabStops="${this.buildTabStopsString(properties.tabStops)}"`);
        }

        return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    }

    /**
     * Build character properties attributes
     */
    private buildCharacterPropertiesAttributes(properties: Record<string, any>): string {
        const attrs: string[] = [];

        if (properties.fontFamily) {
            attrs.push(`fontFamily="${this.escapeXML(properties.fontFamily)}"`);
        }
        if (properties.fontSize !== undefined) {
            attrs.push(`fontSize="${properties.fontSize}"`);
        }
        if (properties.fontWeight) {
            attrs.push(`fontWeight="${this.escapeXML(properties.fontWeight)}"`);
        }
        if (properties.fontStyle) {
            attrs.push(`fontStyle="${this.escapeXML(properties.fontStyle)}"`);
        }
        if (properties.color) {
            attrs.push(`color="${this.escapeXML(properties.color)}"`);
        }
        if (properties.backgroundColor) {
            attrs.push(`backgroundColor="${this.escapeXML(properties.backgroundColor)}"`);
        }
        if (properties.underline !== undefined) {
            attrs.push(`underline="${properties.underline}"`);
        }
        if (properties.strikethrough !== undefined) {
            attrs.push(`strikethrough="${properties.strikethrough}"`);
        }
        if (properties.superscript !== undefined) {
            attrs.push(`superscript="${properties.superscript}"`);
        }
        if (properties.subscript !== undefined) {
            attrs.push(`subscript="${properties.subscript}"`);
        }
        if (properties.tracking !== undefined) {
            attrs.push(`Tracking="${properties.tracking}"`);
        }

        return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    }

    /**
     * Build tab stops string
     */
    private buildTabStopsString(tabStops: Array<{ position: number; alignment: string; leader?: string; }>): string {
        return tabStops.map(tab => {
            let tabString = `${tab.position},${tab.alignment}`;
            if (tab.leader) {
                tabString += `,${tab.leader}`;
            }
            return tabString;
        }).join(';');
    }

    /**
     * Build styles XML
     */
    private buildStylesXML(styles: IDMLStyles): string {
        const paragraphStylesXML = this.buildParagraphStylesXML(styles.paragraphStyles);
        const characterStylesXML = this.buildCharacterStylesXML(styles.characterStyles);

        // Only include styles section if there are actual styles
        if (styles.paragraphStyles.length === 0 && styles.characterStyles.length === 0) {
            return '';
        }

        return `<Styles>
    <ParagraphStyles>
        ${paragraphStylesXML}
    </ParagraphStyles>
    <CharacterStyles>
        ${characterStylesXML}
    </CharacterStyles>
</Styles>`;
    }

    /**
     * Build paragraph styles XML
     */
    private buildParagraphStylesXML(styles: any[]): string {
        return styles.map(style => {
            const basedOnAttr = style.basedOn ? ` basedOn="${this.escapeXML(style.basedOn)}"` : '';
            const nextStyleAttr = style.nextStyle ? ` nextStyle="${this.escapeXML(style.nextStyle)}"` : '';
            const propertiesAttrs = this.buildParagraphPropertiesAttributes(style.properties);

            return `<ParagraphStyle id="${this.escapeXML(style.id)}" name="${this.escapeXML(style.name)}"${basedOnAttr}${nextStyleAttr}${propertiesAttrs} />`;
        }).join('\n        ');
    }

    /**
     * Build character styles XML
     */
    private buildCharacterStylesXML(styles: any[]): string {
        return styles.map(style => {
            const basedOnAttr = style.basedOn ? ` basedOn="${this.escapeXML(style.basedOn)}"` : '';
            const propertiesAttrs = this.buildCharacterPropertiesAttributes(style.properties);

            return `<CharacterStyle id="${this.escapeXML(style.id)}" name="${this.escapeXML(style.name)}"${basedOnAttr}${propertiesAttrs} />`;
        }).join('\n        ');
    }

    /**
     * Build resources XML
     */
    private buildResourcesXML(resources: IDMLResources): string {
        const fontsXML = this.buildFontsXML(resources.fonts);
        const colorsXML = this.buildColorsXML(resources.colors);
        const imagesXML = this.buildImagesXML(resources.images);

        // Only include resources section if there are actual resources
        if (resources.fonts.length === 0 && resources.colors.length === 0 && resources.images.length === 0) {
            return '';
        }

        return `<Resources>
    <Fonts>
        ${fontsXML}
    </Fonts>
    <Colors>
        ${colorsXML}
    </Colors>
    <Images>
        ${imagesXML}
    </Images>
</Resources>`;
    }

    /**
     * Build fonts XML
     */
    private buildFontsXML(fonts: any[]): string {
        return fonts.map(font => {
            const embeddedAttr = font.embedded !== undefined ? ` embedded="${font.embedded}"` : '';

            return `<Font id="${this.escapeXML(font.id)}" name="${this.escapeXML(font.name)}" family="${this.escapeXML(font.family)}" style="${this.escapeXML(font.style)}"${embeddedAttr} />`;
        }).join('\n        ');
    }

    /**
     * Build colors XML
     */
    private buildColorsXML(colors: any[]): string {
        return colors.map(color => {
            const valuesString = color.values.join(',');

            return `<Color id="${this.escapeXML(color.id)}" name="${this.escapeXML(color.name)}" type="${this.escapeXML(color.type)}" values="${valuesString}" />`;
        }).join('\n        ');
    }

    /**
     * Build images XML
     */
    private buildImagesXML(images: any[]): string {
        return images.map(image => {
            return `<Image id="${this.escapeXML(image.id)}" href="${this.escapeXML(image.href)}" width="${image.width}" height="${image.height}" resolution="${image.resolution}" />`;
        }).join('\n        ');
    }

    /**
     * Build metadata XML
     */
    private buildMetadataXML(metadata: IDMLMetadata): string {
        const metadataElements: string[] = [];

        if (metadata.title) {
            metadataElements.push(`<title>${this.escapeXML(metadata.title)}</title>`);
        }
        if (metadata.author) {
            metadataElements.push(`<author>${this.escapeXML(metadata.author)}</author>`);
        }
        if (metadata.createdDate) {
            metadataElements.push(`<createdDate>${this.escapeXML(metadata.createdDate)}</createdDate>`);
        }
        if (metadata.modifiedDate) {
            metadataElements.push(`<modifiedDate>${this.escapeXML(metadata.modifiedDate)}</modifiedDate>`);
        }
        if (metadata.documentId) {
            metadataElements.push(`<documentId>${this.escapeXML(metadata.documentId)}</documentId>`);
        }

        // Add any additional metadata
        Object.keys(metadata).forEach(key => {
            if (!['title', 'author', 'createdDate', 'modifiedDate', 'documentId'].includes(key)) {
                metadataElements.push(`<${key}>${this.escapeXML(metadata[key])}</${key}>`);
            }
        });

        return metadataElements.length > 0 ? `<Metadata>\n    ${metadataElements.join('\n    ')}\n</Metadata>` : '';
    }

    /**
     * Build metadata attributes string
     */
    private buildMetadataAttributes(metadata?: Record<string, any>): string {
        if (!metadata || Object.keys(metadata).length === 0) {
            return '';
        }

        const attrs: string[] = [];
        Object.keys(metadata).forEach(key => {
            if (key !== 'id' && key !== 'name') { // Avoid duplicating id and name
                attrs.push(`${key}="${this.escapeXML(metadata[key])}"`);
            }
        });

        return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    }

    /**
     * Escape XML special characters
     */
    private escapeXML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Validate exported XML
     */
    private async validateExportedXML(xmlContent: string, originalDocument: IDMLDocument): Promise<void> {
        // Basic XML validation
        if (!xmlContent.includes('<?xml')) {
            throw new IDMLExportError('Exported XML missing declaration', this.config, originalDocument);
        }

        if (!xmlContent.includes('<idPkg:Document')) {
            throw new IDMLExportError('Exported XML missing root element', this.config, originalDocument);
        }

        // Check for unescaped characters
        if (xmlContent.includes('<') && !xmlContent.includes('&lt;')) {
            // This is a basic check - in a real implementation, you'd use a proper XML parser
            console.warn('Potential unescaped XML characters detected');
        }

        // Validate structure preservation
        if (this.config.preserveObjectIds) {
            await this.validateObjectIdsPreserved(xmlContent, originalDocument);
        }

        if (this.config.preserveAllFormatting) {
            await this.validateFormattingPreserved(xmlContent, originalDocument);
        }
    }

    /**
     * Validate that object IDs are preserved
     */
    private async validateObjectIdsPreserved(xmlContent: string, originalDocument: IDMLDocument): Promise<void> {
        // Check that all story IDs are present (only if they exist in original)
        for (const story of originalDocument.stories) {
            if (story.id && !xmlContent.includes(`id="${story.id}"`)) {
                throw new IDMLExportError(`Story ID ${story.id} not preserved in export`, this.config, originalDocument);
            }
        }

        // Check that all paragraph IDs are present (only for non-auto-generated IDs)
        for (const story of originalDocument.stories) {
            for (const paragraph of story.paragraphs) {
                // Skip validation for auto-generated IDs
                if (paragraph.id && !paragraph.id.startsWith('Para')) {
                    if (!xmlContent.includes(`id="${paragraph.id}"`)) {
                        throw new IDMLExportError(`Paragraph ID ${paragraph.id} not preserved in export`, this.config, originalDocument);
                    }
                }
            }
        }
    }

    /**
     * Validate that formatting is preserved
     */
    private async validateFormattingPreserved(xmlContent: string, originalDocument: IDMLDocument): Promise<void> {
        // Check that style references are preserved
        for (const story of originalDocument.stories) {
            for (const paragraph of story.paragraphs) {
                const styleRef = paragraph.paragraphStyleRange.appliedParagraphStyle;
                if (!xmlContent.includes(`appliedParagraphStyle="${styleRef}"`)) {
                    throw new IDMLExportError(`Paragraph style ${styleRef} not preserved in export`, this.config, originalDocument);
                }

                for (const charRange of paragraph.characterStyleRanges) {
                    const charStyleRef = charRange.appliedCharacterStyle;
                    if (!xmlContent.includes(`appliedCharacterStyle="${charStyleRef}"`)) {
                        throw new IDMLExportError(`Character style ${charStyleRef} not preserved in export`, this.config, originalDocument);
                    }
                }
            }
        }
    }
}

// ============================================================================
// NODE.JS-COMPATIBLE EXPORT FUNCTIONS (for VS Code Extension)
// ============================================================================

/**
 * Interface for paragraph updates from Codex cells
 */
export interface ParagraphUpdate {
    paragraphId?: string;
    paragraphOrder?: number;
    translated: string;
    dataAfter?: string[];
}

/**
 * Export IDML with updated content from Codex cells (Node.js compatible)
 * This function works directly with ZIP files and XML strings without browser APIs
 * Supports both paragraph-based updates and Biblica verse-based updates
 * 
 * @param originalIdmlData - The original IDML file as Uint8Array
 * @param codexCells - Array of Codex cell data
 * @returns Updated IDML as Uint8Array
 */
export async function exportIdmlRoundtrip(
    originalIdmlData: Uint8Array,
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>
): Promise<Uint8Array> {
    // Load original IDML (ZIP file)
    const zip = await JSZip.loadAsync(originalIdmlData);

    // Build mapping from IDML structure metadata to translated content
    const storyIdToUpdates = new Map<string, ParagraphUpdate[]>();
    const storyIndexToUpdates = new Map<number, ParagraphUpdate[]>();

    // Build mapping for verse-based updates (Biblica format)
    const verseUpdates: Record<string, { content: string; beforeVerse?: string; afterVerse?: string; }> = {};
    let hasVerseBasedCells = false;

    // XML escape helper
    const xmlEscape = (s: string) =>
        s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Helper to extract storyId from HTML
    const extractStoryIdFromHtml = (html: string): string | undefined => {
        const m = html.match(/data-story-id="([^"]+)"/i);
        return m ? m[1] : undefined;
    };

    // Helper to get translated HTML from cell value or latest edit entry
    const getTranslatedHtml = (cell: any): string => {
        const direct = (cell.value || "").trim();
        if (direct) return direct;
        const edits = cell.metadata?.edits;
        if (Array.isArray(edits) && edits.length > 0) {
            for (let i = edits.length - 1; i >= 0; i--) {
                const v = edits[i]?.value;
                if (typeof v === 'string' && v.trim()) {
                    return v;
                }
            }
        }
        return "";
    };

    // Helper to remove HTML tags while preserving line breaks
    const removeHtmlTags = (html: string): string => {
        // First convert <br>, <br/>, <br /> tags to newlines
        let text = html.replace(/<br\s*\/?>/gi, '\n');
        // Then remove all other HTML tags
        text = text.replace(/<[^>]*>/g, '');
        return text.trim();
    };

    // Track story order counters for fallback
    const storyOrderCounters = new Map<string, number>();

    // Collect updates from codex cells - check for verse metadata first
    for (const cell of codexCells) {
        const meta: any = cell.metadata;
        const isText = cell.kind === 2 && meta?.type === "text";
        if (!isText) continue;

        const translated = removeHtmlTags(getTranslatedHtml(cell)).trim();
        if (!translated) continue;

        // Check if this is a Biblica verse-based cell
        const isBibleVerse = meta?.isBibleVerse;
        const verseId = meta?.verseId;
        const bookAbbrev = meta?.bookAbbreviation;
        const chapterNum = meta?.chapterNumber;
        const verseNum = meta?.verseNumber;
        const beforeVerse = meta?.beforeVerse;
        const afterVerse = meta?.afterVerse;

        // If we have verse metadata, use verse-based replacement
        if (isBibleVerse && verseId) {
            hasVerseBasedCells = true;
            verseUpdates[verseId] = {
                content: translated,
                beforeVerse,
                afterVerse
            };
            console.log(`[Export] Collected verse update: ${verseId}`);
            continue;
        }

        // Otherwise use paragraph-based replacement (fallback)
        const structure = meta?.data?.idmlStructure;
        const relationships = meta?.data?.relationships;

        // Get storyId from various sources
        const storyId: string | undefined =
            structure?.storyId ||
            meta?.storyId ||
            relationships?.parentStory ||
            extractStoryIdFromHtml(cell.value || "");

        const storyOrder: number | undefined = typeof relationships?.storyOrder === 'number'
            ? relationships.storyOrder
            : undefined;

        if (!storyId && storyOrder === undefined) continue;

        const paragraphId: string | undefined = structure?.paragraphId || meta?.paragraphId;
        const dataAfterRuns: string[] | undefined = structure?.paragraphStyleRange?.dataAfter;

        let paragraphOrder: number | undefined = typeof relationships?.paragraphOrder === 'number'
            ? relationships.paragraphOrder
            : undefined;

        // If paragraphOrder is not provided, assign sequential order per story
        if (paragraphOrder === undefined && storyId) {
            const current = storyOrderCounters.get(storyId) || 0;
            paragraphOrder = current;
            storyOrderCounters.set(storyId, current + 1);
        }

        // Add to appropriate map
        if (storyId) {
            const updates = storyIdToUpdates.get(storyId) || [];
            updates.push({ paragraphId, paragraphOrder, translated, dataAfter: dataAfterRuns });
            storyIdToUpdates.set(storyId, updates);
        } else if (storyOrder !== undefined) {
            const updates = storyIndexToUpdates.get(storyOrder) || [];
            updates.push({ paragraphOrder, translated, dataAfter: dataAfterRuns });
            storyIndexToUpdates.set(storyOrder, updates);
        }
    }

    console.log(`[Export] Collected ${Object.keys(verseUpdates).length} verse-based updates, ${storyIdToUpdates.size} story-based updates`);

    /**
     * Replace verse content in XML while preserving Biblica meta structure
     * 
     * Biblica IDML format uses URL-encoded character styles (e.g., meta%3av where %3a = colon)
     * 
     * Pattern to find:
     * 1. <CharacterStyleRange ... cv%3av>...<Content>VERSE_NUM</Content>...</CharacterStyleRange>
     * 2. (optional spacing)
     * 3. <CharacterStyleRange ... meta%3av>...<Content>VERSE_NUM</Content>...</CharacterStyleRange>
     * 4. VERSE CONTENT (one or more CharacterStyleRange blocks)
     * 5. <CharacterStyleRange ... meta%3av>...<Content>VERSE_NUM</Content>...</CharacterStyleRange>
     * 
     * We replace everything between steps 3 and 5 with updated content.
     */
    const replaceVerseContent = (xmlContent: string, currentBook: string, currentChapter: string): string => {
        let result = xmlContent;
        const processedVerses = new Set<string>();

        // Process each verse that has an update
        for (const verseIdKey in verseUpdates) {
            const update = verseUpdates[verseIdKey];
            const parts = verseIdKey.split(/[:\s]+/);
            if (parts.length < 3) continue;

            const book = parts[0];
            const chapter = parts[1];
            const verseNumber = parts[2];

            // Only process verses for the current book and chapter
            if (book !== currentBook || chapter !== currentChapter) continue;
            if (processedVerses.has(verseNumber)) continue;

            const updatedContent = update.content;

            // Build regex to find the full verse pattern
            // Pattern: cv%3av → (optional spacing) → meta%3av → content (may span paragraphs) → meta%3av
            // Note: Content may include </ParagraphStyleRange> and <ParagraphStyleRange> tags for cross-paragraph verses
            const versePattern = new RegExp(
                // 1. cv%3av marker with verse number (Biblica format uses URL-encoded %3a)
                `(<CharacterStyleRange[^>]*AppliedCharacterStyle="[^"]*cv%3av[^"]*"[^>]*>\\s*<Content>${escapeRegExp(verseNumber)}</Content>\\s*</CharacterStyleRange>)` +
                // 2. Optional spacing/content ranges (non-greedy)
                `([\\s\\S]*?)` +
                // 3. First meta%3av marker (before verse content)
                `(<CharacterStyleRange[^>]*AppliedCharacterStyle="[^"]*meta%3av[^"]*"[^>]*>\\s*<Content>${escapeRegExp(verseNumber)}</Content>\\s*</CharacterStyleRange>)` +
                // 4. Verse content (everything until the closing meta%3av) - non-greedy
                //    This may include </ParagraphStyleRange> and <ParagraphStyleRange> tags
                `([\\s\\S]*?)` +
                // 5. Closing meta%3av marker (after verse content)
                `(<CharacterStyleRange[^>]*AppliedCharacterStyle="[^"]*meta%3av[^"]*"[^>]*>\\s*<Content>${escapeRegExp(verseNumber)}</Content>\\s*</CharacterStyleRange>)`,
                'i'
            );

            const match = result.match(versePattern);

            if (match) {
                const [fullMatch, cvMarker, spacing, openingMeta, _oldContent, closingMeta] = match;

                // Check if verse spans multiple paragraphs
                const spansParagraphs = _oldContent.includes('</ParagraphStyleRange>');
                if (spansParagraphs) {
                    console.log(`[Export] Verse ${book} ${chapter}:${verseNumber} spans multiple paragraphs - consolidating`);
                } else {
                    console.log(`[Export] Replacing verse ${book} ${chapter}:${verseNumber}`);
                }

                // Extract attributes from the original verse content CharacterStyleRange
                // Look for the main content CharacterStyleRange (the one with the actual verse text)
                const originalAttrsMatch = _oldContent.match(
                    /<CharacterStyleRange([^>]*AppliedCharacterStyle="CharacterStyle\/\$ID\/\[No character style\]"[^>]*)>/
                );

                let preservedAttrs = '';
                if (originalAttrsMatch && originalAttrsMatch[1]) {
                    // Extract all attributes from the original tag
                    const attrs = originalAttrsMatch[1];
                    // Keep everything except the AppliedCharacterStyle (we'll add that back)
                    const trackingMatch = attrs.match(/Tracking="[^"]*"/);
                    if (trackingMatch) {
                        preservedAttrs = ' ' + trackingMatch[0];
                    }
                }

                // Count <Br/> tags in original content to preserve line break structure
                const originalBrCount = (_oldContent.match(/<Br\s*\/?>/gi) || []).length;

                // Build replacement content with proper structure
                // Split by newlines to handle <Br/> tags
                let contentParts = updatedContent.split('\n');

                // If the updated content doesn't have newlines but the original had Br tags,
                // try to intelligently split the text to match the original structure
                if (contentParts.length === 1 && originalBrCount > 0) {
                    // Try to split by sentence boundaries (. followed by space or capital letter)
                    const sentences = updatedContent.split(/(?<=\.)\s+(?=[A-ZŠČŤŽÝÁÍÉÚÔÄŇ])/);
                    if (sentences.length > 1 && sentences.length <= originalBrCount + 1) {
                        contentParts = sentences;
                        console.log(`[Export] Split verse ${book} ${chapter}:${verseNumber} into ${sentences.length} parts based on sentences (original had ${originalBrCount} breaks)`);
                    }
                }

                const contentXML: string[] = [];

                for (let i = 0; i < contentParts.length; i++) {
                    const part = contentParts[i];

                    // Always add content tags (preserving spaces and empty strings)
                    contentXML.push(`<Content>${xmlEscape(part)}</Content>`);

                    // Add line break between parts (but not after the last one)
                    if (i < contentParts.length - 1) {
                        contentXML.push(`<Br/>`);
                    }
                }

                // Wrap content in CharacterStyleRange with preserved attributes
                const newVerseContent = `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"${preservedAttrs}>
${contentXML.map(line => `                    ${line}`).join('\n')}
                </CharacterStyleRange>`;

                // Replace the matched section, preserving the meta tags
                const replacement = `${cvMarker}${spacing}${openingMeta}
                ${newVerseContent}
                ${closingMeta}`;

                result = result.replace(fullMatch, replacement);
                processedVerses.add(verseNumber);
            } else {
                console.warn(`[Export] Could not find verse pattern for ${book} ${chapter}:${verseNumber}`);
            }
        }

        return result;
    };

    // Helper to build replacement content (for paragraph-based updates)
    const buildReplacementInner = (newText: string, dataAfter?: string[]): string => {
        // Handle multi-line content by splitting and adding <Br/> tags
        const contentParts = newText.split('\n');
        const contentXML: string[] = [];

        for (let i = 0; i < contentParts.length; i++) {
            const part = contentParts[i];

            // Always add content tags (preserving spaces and empty strings)
            contentXML.push(`<Content>${xmlEscape(part)}</Content>`);

            // Add line break between parts (but not after the last one)
            if (i < contentParts.length - 1) {
                contentXML.push(`<Br/>`);
            }
        }

        // Add trailing <Br/> if not present in dataAfter
        const hasBreakInDataAfter = Array.isArray(dataAfter) && dataAfter.some(s => /<Br\b/i.test(s));
        const trailingBr = hasBreakInDataAfter ? '' : '<Br/>';
        const after = Array.isArray(dataAfter) ? dataAfter.join('') : '';

        return `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">${contentXML.join('')}${trailingBr}</CharacterStyleRange>${after}`;
    };

    // Helper to replace paragraph by ID
    const replaceParagraphById = (xml: string, pid: string, newText: string, dataAfter?: string[]): string => {
        const escapedPid = escapeRegExp(pid);
        const blockRe = new RegExp(`(<ParagraphStyleRange[^>]*\\bid=["']${escapedPid}["'][^>]*>)([\\s\\S]*?)(<\\/ParagraphStyleRange>)`, 'i');
        const replacementInner = buildReplacementInner(newText, dataAfter);
        return xml.replace(blockRe, (_m, openTag, _inner, closeTag) => `${openTag}${replacementInner}${closeTag}`);
    };

    // Helper to replace paragraph by order index
    const replaceNthParagraph = (xml: string, index: number, newText: string, dataAfter?: string[]): string => {
        const reBlock = /<ParagraphStyleRange\b[^>]*>[\s\S]*?<\/ParagraphStyleRange>/gi;
        const blocks: { start: number; end: number; }[] = [];
        let match: RegExpExecArray | null;
        while ((match = reBlock.exec(xml)) !== null) {
            blocks.push({ start: match.index, end: reBlock.lastIndex });
        }
        if (index < 0 || index >= blocks.length) return xml;

        const target = blocks[index];
        const before = xml.slice(0, target.start);
        const block = xml.slice(target.start, target.end);
        const after = xml.slice(target.end);

        const updatedBlock = block.replace(/^(<ParagraphStyleRange\b[^>]*>)[\s\S]*?(<\/ParagraphStyleRange>)$/i, (_m, openTag, closeTag) => {
            const replacementInner = buildReplacementInner(newText, dataAfter);
            return `${openTag}${replacementInner}${closeTag}`;
        });

        return before + updatedBlock + after;
    };

    // Process verse-based updates first (Biblica format)
    if (hasVerseBasedCells && Object.keys(verseUpdates).length > 0) {
        console.log('[Export] Processing verse-based updates...');

        // Get all story files
        const storyFiles = Object.keys(zip.files).filter(name =>
            name.startsWith('Stories/Story_') && name.endsWith('.xml')
        );

        for (const storyPath of storyFiles) {
            const file = zip.file(storyPath);
            if (!file) continue;

            let xmlContent = await file.async('text');
            const originalXml = xmlContent;

            // Extract book abbreviation from the XML content
            // Look for book abbreviation in paragraph styles or metadata (meta%3abk - Biblica format)
            const bookMatch = xmlContent.match(/AppliedParagraphStyle="[^"]*meta%3abk[^"]*"[^>]*>[\s\S]*?<Content>([A-Z]{2,4})<\/Content>/i);
            const currentBook = bookMatch ? bookMatch[1] : '';

            if (!currentBook) {
                console.log(`[Export] No book abbreviation found in ${storyPath}, skipping verse-based replacement`);
                continue;
            }

            // Look for chapter numbers in cv%3adc markers (Biblica format)
            const chapterMatches = [...xmlContent.matchAll(/<CharacterStyleRange[^>]*AppliedCharacterStyle="[^"]*cv%3adc[^"]*"[^>]*>\s*<Content>(\d+)<\/Content>/gi)];

            if (chapterMatches.length > 0) {
                // Process each chapter section separately
                let modifiedXml = xmlContent;
                let cumulativeOffset = 0;

                for (let i = 0; i < chapterMatches.length; i++) {
                    const chapterMatch = chapterMatches[i];
                    const chapterNumber = chapterMatch[1];

                    // Find the section for this chapter
                    const startIndex = (chapterMatch.index || 0) + cumulativeOffset;
                    const nextChapterMatch = chapterMatches[i + 1];
                    const endIndex = nextChapterMatch && nextChapterMatch.index !== undefined
                        ? nextChapterMatch.index + cumulativeOffset
                        : modifiedXml.length;

                    if (startIndex >= 0 && startIndex < modifiedXml.length) {
                        const before = modifiedXml.substring(0, startIndex);
                        const chapterSection = modifiedXml.substring(startIndex, endIndex);
                        const after = modifiedXml.substring(endIndex);

                        // Replace verses in this chapter section
                        const updatedSection = replaceVerseContent(chapterSection, currentBook, chapterNumber);

                        // Calculate offset change for next iteration
                        const lengthDiff = updatedSection.length - chapterSection.length;
                        cumulativeOffset += lengthDiff;

                        modifiedXml = before + updatedSection + after;
                    }
                }

                xmlContent = modifiedXml;
            } else {
                // No chapter markers found, try to process the whole file with chapter "1"
                console.log(`[Export] No chapter markers in ${storyPath}, trying chapter 1`);
                xmlContent = replaceVerseContent(xmlContent, currentBook, '1');
            }

            // Update the file if changed
            if (xmlContent !== originalXml) {
                console.log(`[Export] Updated ${storyPath} with verse replacements`);
                zip.file(storyPath, xmlContent);
            }
        }
    }

    // Apply paragraph-based updates per story (fallback or alternative)
    for (const [storyId, updates] of storyIdToUpdates.entries()) {
        // Find corresponding story file in the zip
        const storyKey = Object.keys(zip.files).find(k =>
            /stories\//i.test(k) &&
            (new RegExp(`Stories/Story_${escapeRegExp(storyId)}\\.xml$`, 'i').test(k) ||
                new RegExp(`Stories/Story_u${escapeRegExp(storyId)}\\.xml$`, 'i').test(k))
        );

        if (!storyKey) {
            console.warn(`IDML roundtrip: Story file not found for storyId=${storyId}`);
            continue;
        }

        const xmlText = await zip.file(storyKey)!.async("string");
        let updated = xmlText;

        // Prefer id-based replacement, otherwise fallback to order
        for (const u of updates) {
            if (u.paragraphId) {
                updated = replaceParagraphById(updated, u.paragraphId, u.translated, u.dataAfter);
            } else if (typeof u.paragraphOrder === 'number') {
                updated = replaceNthParagraph(updated, u.paragraphOrder, u.translated, u.dataAfter);
            }
        }

        if (updated !== xmlText) {
            zip.file(storyKey, updated);
        }
    }

    // Fallback: apply updates by story order index if storyId was missing
    if (storyIndexToUpdates.size > 0) {
        try {
            const designMap = zip.file("designmap.xml");
            if (designMap) {
                const dm = await designMap.async("string");
                // Extract story srcs in order from designmap
                const storySrcs: string[] = [];
                const regex = /<idPkg:Story[^>]*\bsrc="([^"]+)"/gi;
                let m: RegExpExecArray | null;
                while ((m = regex.exec(dm)) !== null) {
                    if (m[1]) storySrcs.push(m[1]);
                }

                for (const [index, updates] of storyIndexToUpdates.entries()) {
                    const src = storySrcs[index];
                    if (!src) continue;

                    const normalizedSrc = src.replace(/^\.\//, "");
                    const storyFile = zip.file(normalizedSrc);
                    if (!storyFile) continue;

                    const xmlText = await storyFile.async("string");
                    let updated = xmlText;

                    for (const u of updates) {
                        if (typeof u.paragraphOrder === 'number') {
                            updated = replaceNthParagraph(updated, u.paragraphOrder, u.translated, u.dataAfter);
                        }
                    }

                    if (updated !== xmlText) {
                        zip.file(normalizedSrc, updated);
                    }
                }
            }
        } catch (e) {
            console.warn("IDML roundtrip: failed fallback mapping via designmap.xml", e);
        }
    }

    // Generate updated IDML
    const updatedIdmlData = await zip.generateAsync({ type: "uint8array" });
    return updatedIdmlData;
}