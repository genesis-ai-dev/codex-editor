/**
 * HTML Mapper for IDML documents
 * Converts IDML structure to HTML for editing while preserving all formatting and IDs
 */

import {
    IDMLDocument,
    IDMLStory,
    IDMLParagraph,
    IDMLParagraphStyleRange,
    IDMLCharacterStyleRange,
    IDMLHTMLRepresentation,
    IDMLHTMLStory
} from './types';

export class HTMLMapper {
    /**
     * Convert IDML document to HTML representation
     */
    convertToHTML(document: IDMLDocument): IDMLHTMLRepresentation {
        const stories = document.stories.map(story => this.convertStoryToHTML(story));

        return {
            documentId: document.id,
            stories,
            styles: document.styles,
            resources: document.resources,
            metadata: document.metadata,
            originalHash: document.originalHash
        };
    }

    /**
     * Convert individual story to HTML
     */
    private convertStoryToHTML(story: IDMLStory): IDMLHTMLStory {
        const html = this.buildStoryHTML(story);

        return {
            id: story.id || '',
            name: story.name || '',
            html,
            metadata: story.metadata
        };
    }

    /**
     * Build HTML for a story
     */
    private buildStoryHTML(story: IDMLStory): string {
        const paragraphsHTML = story.paragraphs.map(paragraph => this.buildParagraphHTML(paragraph)).join('\n');

        return `<div class="story" data-story-id="${this.escapeHTML(story.id)}" data-story-name="${this.escapeHTML(story.name || '')}">
${paragraphsHTML}
</div>`;
    }

    /**
     * Build HTML for a paragraph
     */
    private buildParagraphHTML(paragraph: IDMLParagraph): string {
        const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;
        const paragraphClass = this.styleToCSSClass(paragraphStyle);
        const paragraphAttrs = this.buildParagraphAttributes(paragraph.paragraphStyleRange.properties);

        const contentHTML = this.buildParagraphContentHTML(paragraph);

        return `  <div class="paragraph ${paragraphClass}" data-paragraph-id="${this.escapeHTML(paragraph.id)}" data-paragraph-style="${this.escapeHTML(paragraphStyle)}"${paragraphAttrs}>
${contentHTML}
  </div>`;
    }

    /**
     * Build HTML content for paragraph (character style ranges)
     */
    private buildParagraphContentHTML(paragraph: IDMLParagraph): string {
        if (paragraph.characterStyleRanges.length === 0) {
            return '    <span class="character normal">No content</span>';
        }

        const characterRangesHTML = paragraph.characterStyleRanges.map(range => this.buildCharacterRangeHTML(range));

        return characterRangesHTML.join('\n');
    }

    /**
     * Build HTML for character style range
     */
    private buildCharacterRangeHTML(range: IDMLCharacterStyleRange): string {
        const characterStyle = range.appliedCharacterStyle;
        const characterClass = this.styleToCSSClass(characterStyle);
        const characterAttrs = this.buildCharacterAttributes(range.properties);

        return `    <span class="character ${characterClass}" data-character-id="${this.escapeHTML(range.id)}" data-character-style="${this.escapeHTML(characterStyle)}" data-start-index="${range.startIndex}" data-end-index="${range.endIndex}"${characterAttrs}>${this.escapeHTML(range.content)}</span>`;
    }

    /**
     * Build paragraph attributes from properties
     */
    private buildParagraphAttributes(properties: Record<string, any>): string {
        const attrs: string[] = [];

        if (properties.justification) {
            attrs.push(`data-justification="${this.escapeHTML(properties.justification)}"`);
        }
        if (properties.spaceBefore !== undefined) {
            attrs.push(`data-space-before="${properties.spaceBefore}"`);
        }
        if (properties.spaceAfter !== undefined) {
            attrs.push(`data-space-after="${properties.spaceAfter}"`);
        }
        if (properties.firstLineIndent !== undefined) {
            attrs.push(`data-first-line-indent="${properties.firstLineIndent}"`);
        }
        if (properties.leftIndent !== undefined) {
            attrs.push(`data-left-indent="${properties.leftIndent}"`);
        }
        if (properties.rightIndent !== undefined) {
            attrs.push(`data-right-indent="${properties.rightIndent}"`);
        }
        if (properties.tabStops && properties.tabStops.length > 0) {
            attrs.push(`data-tab-stops="${this.buildTabStopsDataAttribute(properties.tabStops)}"`);
        }

        return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    }

    /**
     * Build character attributes from properties
     */
    private buildCharacterAttributes(properties: Record<string, any>): string {
        const attrs: string[] = [];

        if (properties.fontFamily) {
            attrs.push(`data-font-family="${this.escapeHTML(properties.fontFamily)}"`);
        }
        if (properties.fontSize !== undefined) {
            attrs.push(`data-font-size="${properties.fontSize}"`);
        }
        if (properties.fontWeight) {
            attrs.push(`data-font-weight="${this.escapeHTML(properties.fontWeight)}"`);
        }
        if (properties.fontStyle) {
            attrs.push(`data-font-style="${this.escapeHTML(properties.fontStyle)}"`);
        }
        if (properties.color) {
            attrs.push(`data-color="${this.escapeHTML(properties.color)}"`);
        }
        if (properties.backgroundColor) {
            attrs.push(`data-background-color="${this.escapeHTML(properties.backgroundColor)}"`);
        }
        if (properties.underline !== undefined) {
            attrs.push(`data-underline="${properties.underline}"`);
        }
        if (properties.strikethrough !== undefined) {
            attrs.push(`data-strikethrough="${properties.strikethrough}"`);
        }
        if (properties.superscript !== undefined) {
            attrs.push(`data-superscript="${properties.superscript}"`);
        }
        if (properties.subscript !== undefined) {
            attrs.push(`data-subscript="${properties.subscript}"`);
        }

        return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    }

    /**
     * Convert InDesign style name to CSS class
     */
    private styleToCSSClass(styleName: string): string {
        // Convert InDesign style names to CSS-friendly class names
        return styleName
            .replace(/[^a-zA-Z0-9]/g, '-')
            .replace(/\$ID\//g, '')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
    }

    /**
     * Build tab stops data attribute
     */
    private buildTabStopsDataAttribute(tabStops: Array<{ position: number; alignment: string; leader?: string; }>): string {
        return tabStops.map(tab => {
            let tabString = `${tab.position},${tab.alignment}`;
            if (tab.leader) {
                tabString += `,${tab.leader}`;
            }
            return tabString;
        }).join(';');
    }

    /**
     * Escape HTML special characters
     */
    private escapeHTML(text: string | undefined): string {
        if (text === undefined || text === null) {
            return '';
        }
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Generate CSS styles for the HTML representation
     */
    generateCSS(document: IDMLDocument): string {
        const styles: string[] = [];

        // Base styles
        styles.push(`
/* Base styles for IDML HTML representation */
.story {
    margin: 0;
    padding: 0;
}

.paragraph {
    margin: 0;
    padding: 0;
    line-height: 1.2;
}

.character {
    display: inline;
}`);

        // Paragraph styles
        document.styles.paragraphStyles.forEach(style => {
            const className = this.styleToCSSClass(style.name);
            const css = this.buildParagraphCSS(style.properties);
            styles.push(`
.paragraph.${className} {
${css}
}`);
        });

        // Character styles
        document.styles.characterStyles.forEach(style => {
            const className = this.styleToCSSClass(style.name);
            const css = this.buildCharacterCSS(style.properties);
            styles.push(`
.character.${className} {
${css}
}`);
        });

        return styles.join('\n');
    }

    /**
     * Build CSS for paragraph properties
     */
    private buildParagraphCSS(properties: Record<string, any>): string {
        const css: string[] = [];

        if (properties.justification) {
            switch (properties.justification) {
                case 'left':
                    css.push('    text-align: left;');
                    break;
                case 'center':
                    css.push('    text-align: center;');
                    break;
                case 'right':
                    css.push('    text-align: right;');
                    break;
                case 'justify':
                    css.push('    text-align: justify;');
                    break;
            }
        }

        if (properties.spaceBefore !== undefined) {
            css.push(`    margin-top: ${properties.spaceBefore}pt;`);
        }

        if (properties.spaceAfter !== undefined) {
            css.push(`    margin-bottom: ${properties.spaceAfter}pt;`);
        }

        if (properties.firstLineIndent !== undefined) {
            css.push(`    text-indent: ${properties.firstLineIndent}pt;`);
        }

        if (properties.leftIndent !== undefined) {
            css.push(`    margin-left: ${properties.leftIndent}pt;`);
        }

        if (properties.rightIndent !== undefined) {
            css.push(`    margin-right: ${properties.rightIndent}pt;`);
        }

        return css.join('\n');
    }

    /**
     * Build CSS for character properties
     */
    private buildCharacterCSS(properties: Record<string, any>): string {
        const css: string[] = [];

        if (properties.fontFamily) {
            css.push(`    font-family: "${properties.fontFamily}";`);
        }

        if (properties.fontSize !== undefined) {
            css.push(`    font-size: ${properties.fontSize}pt;`);
        }

        if (properties.fontWeight) {
            css.push(`    font-weight: ${properties.fontWeight};`);
        }

        if (properties.fontStyle) {
            css.push(`    font-style: ${properties.fontStyle};`);
        }

        if (properties.color) {
            css.push(`    color: ${properties.color};`);
        }

        if (properties.backgroundColor) {
            css.push(`    background-color: ${properties.backgroundColor};`);
        }

        if (properties.underline) {
            css.push('    text-decoration: underline;');
        }

        if (properties.strikethrough) {
            css.push('    text-decoration: line-through;');
        }

        if (properties.superscript) {
            css.push('    vertical-align: super;');
            css.push('    font-size: smaller;');
        }

        if (properties.subscript) {
            css.push('    vertical-align: sub;');
            css.push('    font-size: smaller;');
        }

        return css.join('\n');
    }

    /**
     * Convert HTML back to IDML structure (for round-trip)
     */
    convertHTMLToIDML(htmlRepresentation: IDMLHTMLRepresentation): IDMLDocument {
        const stories = htmlRepresentation.stories.map(story => this.convertHTMLStoryToIDML(story));

        return {
            id: htmlRepresentation.documentId,
            version: '1.0',
            stories,
            styles: htmlRepresentation.styles,
            resources: htmlRepresentation.resources,
            metadata: htmlRepresentation.metadata,
            originalHash: htmlRepresentation.originalHash
        };
    }

    /**
     * Convert HTML story back to IDML story
     */
    private convertHTMLStoryToIDML(htmlStory: IDMLHTMLStory): IDMLStory {
        // Parse HTML to extract paragraphs
        const paragraphs = this.parseHTMLParagraphs(htmlStory.html);

        return {
            id: htmlStory.id,
            name: htmlStory.name,
            paragraphs,
            metadata: htmlStory.metadata
        };
    }

    /**
     * Parse HTML to extract paragraphs
     */
    private parseHTMLParagraphs(html: string): IDMLParagraph[] {
        // This is a simplified parser - in a real implementation, you'd use a proper HTML parser
        const paragraphs: IDMLParagraph[] = [];

        // Extract paragraph divs
        const paragraphRegex = /<div class="paragraph[^"]*" data-paragraph-id="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
        let match;

        while ((match = paragraphRegex.exec(html)) !== null) {
            const paragraphId = match[1];
            const paragraphHTML = match[2];

            const paragraph = this.parseHTMLParagraph(paragraphId, paragraphHTML);
            paragraphs.push(paragraph);
        }

        return paragraphs;
    }

    /**
     * Parse individual HTML paragraph
     */
    private parseHTMLParagraph(paragraphId: string, paragraphHTML: string): IDMLParagraph {
        // Extract paragraph style from data attributes
        const styleMatch = paragraphHTML.match(/data-paragraph-style="([^"]*)"/);
        const appliedParagraphStyle = styleMatch ? styleMatch[1] : 'ParagraphStyle/$ID/NormalParagraphStyle';

        // Extract paragraph properties from data attributes
        const properties = this.extractParagraphPropertiesFromHTML(paragraphHTML);

        // Extract character style ranges
        const characterRanges = this.parseHTMLCharacterRanges(paragraphHTML);

        return {
            id: paragraphId,
            paragraphStyleRange: {
                id: paragraphId,
                appliedParagraphStyle,
                properties,
                content: this.extractTextContent(paragraphHTML)
            },
            characterStyleRanges: characterRanges,
            metadata: this.extractMetadataFromHTML(paragraphHTML)
        };
    }

    /**
     * Parse HTML character style ranges
     */
    private parseHTMLCharacterRanges(paragraphHTML: string): IDMLCharacterStyleRange[] {
        const ranges: IDMLCharacterStyleRange[] = [];

        const characterRegex = /<span class="character[^"]*" data-character-id="([^"]*)"[^>]*>([^<]*)<\/span>/g;
        let match;

        while ((match = characterRegex.exec(paragraphHTML)) !== null) {
            const characterId = match[1];
            const content = match[2];

            // Extract character style from data attributes
            const styleMatch = paragraphHTML.match(/data-character-style="([^"]*)"/);
            const appliedCharacterStyle = styleMatch ? styleMatch[1] : 'CharacterStyle/$ID/NormalCharacterStyle';

            // Extract character properties
            const properties = this.extractCharacterPropertiesFromHTML(paragraphHTML);

            ranges.push({
                id: characterId,
                appliedCharacterStyle,
                properties,
                content,
                startIndex: 0, // Would need to calculate based on position
                endIndex: content.length
            });
        }

        return ranges;
    }

    /**
     * Extract paragraph properties from HTML data attributes
     */
    private extractParagraphPropertiesFromHTML(html: string): Record<string, any> {
        const properties: Record<string, any> = {};

        const justificationMatch = html.match(/data-justification="([^"]*)"/);
        if (justificationMatch) properties.justification = justificationMatch[1];

        const spaceBeforeMatch = html.match(/data-space-before="([^"]*)"/);
        if (spaceBeforeMatch) properties.spaceBefore = parseFloat(spaceBeforeMatch[1]);

        const spaceAfterMatch = html.match(/data-space-after="([^"]*)"/);
        if (spaceAfterMatch) properties.spaceAfter = parseFloat(spaceAfterMatch[1]);

        const firstLineIndentMatch = html.match(/data-first-line-indent="([^"]*)"/);
        if (firstLineIndentMatch) properties.firstLineIndent = parseFloat(firstLineIndentMatch[1]);

        const leftIndentMatch = html.match(/data-left-indent="([^"]*)"/);
        if (leftIndentMatch) properties.leftIndent = parseFloat(leftIndentMatch[1]);

        const rightIndentMatch = html.match(/data-right-indent="([^"]*)"/);
        if (rightIndentMatch) properties.rightIndent = parseFloat(rightIndentMatch[1]);

        return properties;
    }

    /**
     * Extract character properties from HTML data attributes
     */
    private extractCharacterPropertiesFromHTML(html: string): Record<string, any> {
        const properties: Record<string, any> = {};

        const fontFamilyMatch = html.match(/data-font-family="([^"]*)"/);
        if (fontFamilyMatch) properties.fontFamily = fontFamilyMatch[1];

        const fontSizeMatch = html.match(/data-font-size="([^"]*)"/);
        if (fontSizeMatch) properties.fontSize = parseFloat(fontSizeMatch[1]);

        const fontWeightMatch = html.match(/data-font-weight="([^"]*)"/);
        if (fontWeightMatch) properties.fontWeight = fontWeightMatch[1];

        const fontStyleMatch = html.match(/data-font-style="([^"]*)"/);
        if (fontStyleMatch) properties.fontStyle = fontStyleMatch[1];

        const colorMatch = html.match(/data-color="([^"]*)"/);
        if (colorMatch) properties.color = colorMatch[1];

        const backgroundColorMatch = html.match(/data-background-color="([^"]*)"/);
        if (backgroundColorMatch) properties.backgroundColor = backgroundColorMatch[1];

        const underlineMatch = html.match(/data-underline="([^"]*)"/);
        if (underlineMatch) properties.underline = underlineMatch[1] === 'true';

        const strikethroughMatch = html.match(/data-strikethrough="([^"]*)"/);
        if (strikethroughMatch) properties.strikethrough = strikethroughMatch[1] === 'true';

        const superscriptMatch = html.match(/data-superscript="([^"]*)"/);
        if (superscriptMatch) properties.superscript = superscriptMatch[1] === 'true';

        const subscriptMatch = html.match(/data-subscript="([^"]*)"/);
        if (subscriptMatch) properties.subscript = subscriptMatch[1] === 'true';

        return properties;
    }

    /**
     * Extract text content from HTML
     */
    private extractTextContent(html: string): string {
        return html.replace(/<[^>]*>/g, '').trim();
    }

    /**
     * Extract metadata from HTML data attributes
     */
    private extractMetadataFromHTML(html: string): Record<string, any> {
        const metadata: Record<string, any> = {};

        // Extract all data-* attributes as metadata
        const dataAttrRegex = /data-([^=]+)="([^"]*)"/g;
        let match;

        while ((match = dataAttrRegex.exec(html)) !== null) {
            const key = match[1];
            const value = match[2];

            // Skip ID and style attributes as they're handled separately
            if (!['paragraph-id', 'paragraph-style', 'character-id', 'character-style'].includes(key)) {
                metadata[key] = value;
            }
        }

        return metadata;
    }
}
