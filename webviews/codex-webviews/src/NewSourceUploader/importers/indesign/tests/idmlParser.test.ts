/**
 * Test suite for IDML parser with round-trip validation
 * Tests ensure loss-free editing capabilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDMLParser } from '../idmlParser';
import { IDMLExporter } from '../idmlExporter';
import { compareIDMLStructures } from './hashUtils';
import type { IDMLDocument, IDMLTestData, RoundTripValidationResult } from '../types';

describe('IDML Parser - Round Trip Validation', () => {
    let parser: IDMLParser;
    let exporter: IDMLExporter;

    beforeEach(() => {
        parser = new IDMLParser();
        exporter = new IDMLExporter();
    });

    describe('Basic IDML Parsing', () => {
        it('should parse a simple IDML document without loss', async () => {
            const simpleIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Hello World
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const document = await parser.parseIDML(simpleIDML);

            expect(document).toBeDefined();
            expect(document.stories).toHaveLength(1);
            expect(document.stories[0].paragraphs).toHaveLength(1);
            expect(document.stories[0].paragraphs[0].characterStyleRanges[0].content).toBe('Hello World');
        });

        it('should preserve all object IDs during parsing', async () => {
            const idmlWithIds = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange id="Para1" appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange id="Char1" appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Test Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const document = await parser.parseIDML(idmlWithIds);

            expect(document.stories[0].id).toBe('Story1');
            expect(document.stories[0].paragraphs[0].id).toBe('Para1');
            expect(document.stories[0].paragraphs[0].characterStyleRanges[0].id).toBe('Char1');
        });
    });

    describe('Round Trip Validation', () => {
        it('should maintain perfect round-trip for simple documents', async () => {
            const originalIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Round Trip Test
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            console.log('🔍 ORIGINAL IDML:');
            console.log(originalIDML);
            console.log('');

            // Parse original
            const document = await parser.parseIDML(originalIDML);
            console.log('📄 PARSED DOCUMENT:');
            console.log(JSON.stringify(document, null, 2));
            console.log('');

            // Export back to IDML
            const reconstructedIDML = await exporter.exportToIDML(document);
            console.log('🔄 RECONSTRUCTED IDML:');
            console.log(reconstructedIDML);
            console.log('');

            // Validate round trip
            const validation = await compareIDMLStructures(originalIDML, reconstructedIDML);
            console.log('🔐 HASH VALIDATION:');
            console.log(`Content Hash Match: ${validation.contentMatch}`);
            console.log(`Structural Hash Match: ${validation.structuralMatch}`);
            console.log(`Differences: ${validation.differences.join(', ') || 'None'}`);
            console.log('');

            expect(validation.contentMatch).toBe(true);
            expect(validation.structuralMatch).toBe(true);
            expect(validation.differences).toHaveLength(0);
        });

        it('should detect content changes in round trip', async () => {
            const originalIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Original Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const modifiedIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Modified Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const validation = await compareIDMLStructures(originalIDML, modifiedIDML);

            expect(validation.contentMatch).toBe(false);
            expect(validation.differences).toContain('Content hash mismatch - text content differs');
        });

        it('should detect structural changes in round trip', async () => {
            const originalIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/NormalCharacterStyle">
                    Test Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const modifiedIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
        <Story id="Story1">
            <ParagraphStyleRange appliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                <CharacterStyleRange appliedCharacterStyle="CharacterStyle/$ID/BoldCharacterStyle">
                    Test Content
                </CharacterStyleRange>
            </ParagraphStyleRange>
        </Story>
    </Document>
</idPkg:Document>`;

            const validation = await compareIDMLStructures(originalIDML, modifiedIDML);

            expect(validation.structuralMatch).toBe(false);
            expect(validation.differences).toContain('Structural hash mismatch - formatting or structure differs');
        });
    });

    describe('Complex Document Parsing', () => {
        it('should handle multiple stories with different formatting', async () => {
            const complexIDML = `<?xml version="1.0" encoding="UTF-8"?>
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

            const document = await parser.parseIDML(complexIDML);

            expect(document.stories).toHaveLength(2);
            expect(document.stories[0].paragraphs).toHaveLength(2);
            expect(document.stories[1].paragraphs).toHaveLength(1);

            // Test round trip
            const reconstructedIDML = await exporter.exportToIDML(document);
            const validation = await compareIDMLStructures(complexIDML, reconstructedIDML);

            expect(validation.contentMatch).toBe(true);
            expect(validation.structuralMatch).toBe(true);
        });

        it('should preserve nested character style ranges', async () => {
            const nestedIDML = `<?xml version="1.0" encoding="UTF-8"?>
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

            const document = await parser.parseIDML(nestedIDML);
            const paragraph = document.stories[0].paragraphs[0];

            expect(paragraph.characterStyleRanges).toHaveLength(3);
            expect(paragraph.characterStyleRanges[0].content).toBe('Normal text with ');
            expect(paragraph.characterStyleRanges[1].content).toBe('bold text');
            expect(paragraph.characterStyleRanges[2].content).toBe(' and normal again.');
        });
    });

    describe('Error Handling', () => {
        it('should throw error for malformed XML', async () => {
            const malformedIDML = `<?xml version="1.0" encoding="UTF-8"?>
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

            await expect(parser.parseIDML(malformedIDML)).rejects.toThrow();
        });

        it('should handle empty documents gracefully', async () => {
            const emptyIDML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
    <Document id="Document1">
    </Document>
</idPkg:Document>`;

            const document = await parser.parseIDML(emptyIDML);

            expect(document.stories).toHaveLength(0);
            expect(document.id).toBe('Document1');
        });
    });

    describe('Performance Tests', () => {
        it('should parse large documents efficiently', async () => {
            // Generate a large IDML document
            const largeIDML = generateLargeIDML(1000); // 1000 paragraphs

            const startTime = performance.now();
            const document = await parser.parseIDML(largeIDML);
            const parseTime = performance.now() - startTime;

            expect(document.stories[0].paragraphs).toHaveLength(1000);
            expect(parseTime).toBeLessThan(5000); // Should parse in under 5 seconds
        });

        it('should export large documents efficiently', async () => {
            const largeIDML = generateLargeIDML(1000);
            const document = await parser.parseIDML(largeIDML);

            const startTime = performance.now();
            const exportedIDML = await exporter.exportToIDML(document);
            const exportTime = performance.now() - startTime;

            expect(exportedIDML).toBeDefined();
            expect(exportTime).toBeLessThan(5000); // Should export in under 5 seconds
        });
    });
});

// Helper function to generate large IDML documents for testing
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
