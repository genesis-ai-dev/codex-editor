/**
 * IDML Exporter for round-trip functionality
 * Converts structured IDML document back to XML format
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
import { computeSHA256 } from './tests/hashUtils';

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
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.0" Self="${this.escapeXML(document.id)}" StoryList="${this.buildStoryList(document.stories)}" Name="${this.escapeXML(document.name || 'Document')}" ZeroPoint="0 0" ActiveLayer="ub7" CMYKProfile="$ID/" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendIntent="UseColorSettings">
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

        return `<ParagraphStyleRange id="${this.escapeXML(styleRange.id)}" appliedParagraphStyle="${this.escapeXML(styleRange.appliedParagraphStyle)}"${propertiesAttrs}>
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
