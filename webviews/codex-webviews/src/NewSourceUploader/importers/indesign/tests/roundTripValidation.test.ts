/**
 * Comprehensive Round-Trip Validation Tests for InDesign Importer
 * Tests ensure loss-free editing capabilities with hash-based validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDMLParser } from '../idmlParser';
import { IDMLExporter } from '../idmlExporter';
import { HTMLMapper } from '../htmlMapper';
import { RoundTripValidator } from './roundTripValidator';
import { computeSHA256, compareIDMLStructures } from './hashUtils';

describe('InDesign Round-Trip Validation Suite', () => {
    let parser: IDMLParser;
    let exporter: IDMLExporter;
    let htmlMapper: HTMLMapper;
    let validator: RoundTripValidator;

    beforeEach(() => {
        parser = new IDMLParser({
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateRoundTrip: true,
            strictMode: false
        });

        exporter = new IDMLExporter({
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateOutput: true,
            strictMode: false
        });

        htmlMapper = new HTMLMapper();
        validator = new RoundTripValidator();
    });

    describe('Basic Round-Trip Tests', () => {
        it('should maintain perfect round-trip for simple text', async () => {
            const simpleIDML = generateSimpleIDML('Hello World');

            // Parse → Export → Validate
            const document = await parser.parseIDML(simpleIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(simpleIDML, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);
            expect(validation.differences).toHaveLength(0);
            expect(validation.errors).toHaveLength(0);
        });

        it('should preserve formatting in round-trip', async () => {
            const formattedIDML = generateFormattedIDML('Bold Text', 'Italic Text');

            const document = await parser.parseIDML(formattedIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(formattedIDML, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);
            expect(reconstructedIDML).toContain('appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle"');
            expect(reconstructedIDML).toContain('appliedCharacterStyle="CharacterStyle/$ID/ItalicCharacterStyle"');
        });

        it('should preserve object IDs in round-trip', async () => {
            const idmlWithIds = generateIDMLWithIds(['Story1', 'Para1', 'Char1']);

            const document = await parser.parseIDML(idmlWithIds);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(idmlWithIds, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);
            expect(reconstructedIDML).toContain('id="Story1"');
            expect(reconstructedIDML).toContain('id="Para1"');
            expect(reconstructedIDML).toContain('id="Char1"');
        });
    });

    describe('HTML Mapping Round-Trip Tests', () => {
        it('should convert IDML to HTML and back without loss', async () => {
            const originalIDML = generateComplexIDML();

            // IDML → Document → HTML → Document → IDML
            const document1 = await parser.parseIDML(originalIDML);
            const htmlRepresentation = htmlMapper.convertToHTML(document1);
            const document2 = htmlMapper.convertHTMLToIDML(htmlRepresentation);
            const reconstructedIDML = await exporter.exportToIDML(document2);

            const validation = await validator.validateRoundTrip(originalIDML, reconstructedIDML, document1);

            expect(validation.isLossFree).toBe(true);
            expect(htmlRepresentation.stories).toHaveLength(document1.stories.length);
        });

        it('should preserve all formatting in HTML conversion', async () => {
            const formattedIDML = generateFormattedIDML('Bold Text', 'Italic Text');

            const document = await parser.parseIDML(formattedIDML);
            const htmlRepresentation = htmlMapper.convertToHTML(document);
            const css = htmlMapper.generateCSS(document);

            expect(htmlRepresentation.stories[0].html).toContain('data-character-style="CharacterStyle/$ID/BoldCharacterStyle"');
            expect(htmlRepresentation.stories[0].html).toContain('data-character-style="CharacterStyle/$ID/ItalicCharacterStyle"');
            expect(css).toContain('font-weight: bold');
            expect(css).toContain('font-style: italic');
        });

        it('should preserve object IDs in HTML conversion', async () => {
            const idmlWithIds = generateIDMLWithIds(['Story1', 'Para1', 'Char1']);

            const document = await parser.parseIDML(idmlWithIds);
            const htmlRepresentation = htmlMapper.convertToHTML(document);

            expect(htmlRepresentation.stories[0].html).toContain('data-story-id="Story1"');
            expect(htmlRepresentation.stories[0].html).toContain('data-paragraph-id="Para1"');
            expect(htmlRepresentation.stories[0].html).toContain('data-character-id="Char1"');
        });
    });

    describe('Hash-Based Validation Tests', () => {
        it('should detect content changes using hash comparison', async () => {
            const originalIDML = generateSimpleIDML('Original Content');
            const modifiedIDML = generateSimpleIDML('Modified Content');

            const comparison = await compareIDMLStructures(originalIDML, modifiedIDML);

            expect(comparison.contentMatch).toBe(false);
            expect(comparison.structuralMatch).toBe(false);
            expect(comparison.differences).toContain('Content hash mismatch - text content differs');
        });

        it('should detect formatting changes using hash comparison', async () => {
            const originalIDML = generateSimpleIDML('Test Content');
            const formattedIDML = generateFormattedIDML('Test Content', '');

            const comparison = await compareIDMLStructures(originalIDML, formattedIDML);

            expect(comparison.structuralMatch).toBe(false);
            expect(comparison.differences).toContain('Structural hash mismatch - formatting or structure differs');
        });

        it('should generate consistent hashes for identical content', async () => {
            const idml1 = generateSimpleIDML('Identical Content');
            const idml2 = generateSimpleIDML('Identical Content');

            const hash1 = await computeSHA256(idml1);
            const hash2 = await computeSHA256(idml2);

            expect(hash1).toBe(hash2);
        });
    });

    describe('Complex Document Tests', () => {
        it('should handle multiple stories with different formatting', async () => {
            const complexIDML = generateMultiStoryIDML();

            const document = await parser.parseIDML(complexIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(complexIDML, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);
            expect(document.stories).toHaveLength(3);
            expect(document.stories[0].paragraphs).toHaveLength(2);
            expect(document.stories[1].paragraphs).toHaveLength(1);
            expect(document.stories[2].paragraphs).toHaveLength(1);
        });

        it('should preserve nested character style ranges', async () => {
            const nestedIDML = generateNestedCharacterRangesIDML();

            const document = await parser.parseIDML(nestedIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(nestedIDML, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);

            const paragraph = document.stories[0].paragraphs[0];
            expect(paragraph.characterStyleRanges).toHaveLength(3);
            expect(paragraph.characterStyleRanges[0].content).toBe('Normal text with ');
            expect(paragraph.characterStyleRanges[1].content).toBe('bold text');
            expect(paragraph.characterStyleRanges[2].content).toBe(' and normal again.');
        });

        it('should handle large documents efficiently', async () => {
            const largeIDML = generateLargeIDML(100); // 100 paragraphs

            const startTime = performance.now();
            const document = await parser.parseIDML(largeIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(largeIDML, reconstructedIDML, document);
            const endTime = performance.now();

            expect(validation.isLossFree).toBe(true);
            expect(document.stories[0].paragraphs).toHaveLength(100);
            expect(endTime - startTime).toBeLessThan(2000); // Should complete in under 2 seconds
        });
    });

    describe('Error Handling Tests', () => {
        it('should handle malformed XML gracefully', async () => {
            const malformedIDML = generateMalformedIDML();

            await expect(parser.parseIDML(malformedIDML)).rejects.toThrow();
        });

        it('should validate round-trip and report differences', async () => {
            const originalIDML = generateSimpleIDML('Original');
            const modifiedIDML = generateSimpleIDML('Modified');

            const validation = await validator.validateRoundTrip(originalIDML, modifiedIDML);

            expect(validation.isLossFree).toBe(false);
            expect(validation.differences.length).toBeGreaterThan(0);
            expect(validation.differences[0].type).toBe('content');
        });

        it('should generate detailed validation reports', async () => {
            const originalIDML = generateSimpleIDML('Original');
            const modifiedIDML = generateSimpleIDML('Modified');

            const validation = await validator.validateRoundTrip(originalIDML, modifiedIDML);
            const report = validator.generateValidationReport(validation);

            expect(report).toContain('InDesign Round-Trip Validation Report');
            expect(report).toContain('Is Loss-Free: NO');
            expect(report).toContain('DIFFERENCES:');
        });
    });

    describe('Performance and Stress Tests', () => {
        it('should handle documents with many character style ranges', async () => {
            const manyRangesIDML = generateManyCharacterRangesIDML(50);

            const document = await parser.parseIDML(manyRangesIDML);
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await validator.validateRoundTrip(manyRangesIDML, reconstructedIDML, document);

            expect(validation.isLossFree).toBe(true);
            expect(document.stories[0].paragraphs[0].characterStyleRanges).toHaveLength(50);
        });

        it('should maintain performance with complex formatting', async () => {
            const complexFormattingIDML = generateComplexFormattingIDML();

            const startTime = performance.now();
            const document = await parser.parseIDML(complexFormattingIDML);
            const htmlRepresentation = htmlMapper.convertToHTML(document);
            const css = htmlMapper.generateCSS(document);
            const endTime = performance.now();

            expect(htmlRepresentation.stories.length).toBeGreaterThan(0);
            expect(css.length).toBeGreaterThan(0);
            expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
        });
    });
});

// Helper functions to generate test IDML content
function generateSimpleIDML(content: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    ${content}
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateFormattedIDML(boldContent: string, italicContent: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle">
                    ${boldContent}
                </CharacterStyleRange>
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/ItalicCharacterStyle">
                    ${italicContent}
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateIDMLWithIds(ids: string[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="${ids[0]}">
            <ParagraphStyleRange id="${ids[1]}" appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange id="${ids[2]}" appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Test Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateComplexIDML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    First paragraph with normal text.
                </CharacterStyleRange>
            </ParagraphStyleRange>
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/Heading1">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle">
                    Heading text
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
        <Story id="Story2">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/ItalicCharacterStyle">
                    Second story with italic text.
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateMultiStoryIDML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Story 1, Paragraph 1
                </CharacterStyleRange>
            </ParagraphStyleRange>
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/Heading1">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle">
                    Story 1, Paragraph 2
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
        <Story id="Story2">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/ItalicCharacterStyle">
                    Story 2, Paragraph 1
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
        <Story id="Story3">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Story 3, Paragraph 1
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateNestedCharacterRangesIDML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Normal text with 
                </CharacterStyleRange>
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle">
                    bold text
                </CharacterStyleRange>
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                     and normal again.
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateLargeIDML(paragraphCount: number): string {
    let idml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">`;

    for (let i = 0; i < paragraphCount; i++) {
        idml += `
            <ParagraphStyleRange id="Para${i}" appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange id="Char${i}" appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Paragraph ${i} content with some text to make it realistic.
                </CharacterStyleRange>
            </ParagraphStyleRange>`;
    }

    idml += `
        </Story>
    </Document>
</idPkg:Document>`;

    return idml;
}

function generateMalformedIDML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Unclosed tag
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}

function generateManyCharacterRangesIDML(rangeCount: number): string {
    let idml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">`;

    for (let i = 0; i < rangeCount; i++) {
        idml += `
                <CharacterStyleRange id="Char${i}" appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Range ${i}
                </CharacterStyleRange>`;
    }

    idml += `
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

    return idml;
}

function generateComplexFormattingIDML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" justification="justify" spaceBefore="12" spaceAfter="12">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle" fontFamily="Times New Roman" fontSize="12">
                    Normal text with complex formatting.
                </CharacterStyleRange>
            </ParagraphStyleRange>
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/Heading1" justification="center" spaceBefore="24" spaceAfter="12">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle" fontFamily="Arial" fontSize="18" fontWeight="bold">
                    Centered Heading
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;
}
