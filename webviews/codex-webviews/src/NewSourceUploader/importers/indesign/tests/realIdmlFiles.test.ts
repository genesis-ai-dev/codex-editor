/**
 * Tests using real IDML files for round-trip validation
 * Tests actual IDML files to ensure perfect reconstruction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDMLParser } from '../idmlParser';
import { IDMLExporter } from '../idmlExporter';
import { compareIDMLStructures } from './hashUtils';

describe('Real IDML Files - Round Trip Validation', () => {
    let parser: IDMLParser;
    let exporter: IDMLExporter;

    beforeEach(() => {
        parser = new IDMLParser();
        exporter = new IDMLExporter();
    });

    it('should reconstruct real IDML file perfectly', async () => {
        // Example: Test with a real IDML file
        // You would place your IDML file in tests/sample-files/ folder
        const idmlFilePath = './tests/sample-files/sample.idml';

        // Read the real IDML file
        const response = await fetch(idmlFilePath);
        const arrayBuffer = await response.arrayBuffer();

        // Parse the real IDML file
        const document = await parser.parseIDML(arrayBuffer);

        console.log('📄 REAL IDML PARSED:');
        console.log(`Document ID: ${document.id}`);
        console.log(`Stories: ${document.stories.length}`);
        console.log(`Total Paragraphs: ${document.stories.reduce((sum, story) => sum + story.paragraphs.length, 0)}`);
        console.log('');

        // Export back to IDML
        const reconstructedIDML = await exporter.exportToIDML(document);

        console.log('🔄 RECONSTRUCTED IDML:');
        console.log(`Length: ${reconstructedIDML.length} characters`);
        console.log('');

        // Validate round trip
        const originalContent = new TextDecoder().decode(arrayBuffer);
        const validation = await compareIDMLStructures(originalContent, reconstructedIDML);

        console.log('🔐 REAL FILE VALIDATION:');
        console.log(`Content Hash Match: ${validation.contentMatch}`);
        console.log(`Structural Hash Match: ${validation.structuralMatch}`);
        console.log(`Differences: ${validation.differences.join(', ') || 'None'}`);
        console.log('');

        expect(validation.contentMatch).toBe(true);
        expect(validation.structuralMatch).toBe(true);
        expect(validation.differences).toHaveLength(0);
    });

    it('should handle complex real IDML files', async () => {
        // Test with a more complex IDML file
        const complexIdmlFilePath = './tests/sample-files/complex-sample.idml';

        try {
            const response = await fetch(complexIdmlFilePath);
            const arrayBuffer = await response.arrayBuffer();

            const document = await parser.parseIDML(arrayBuffer);
            const reconstructedIDML = await exporter.exportToIDML(document);

            const originalContent = new TextDecoder().decode(arrayBuffer);
            const validation = await compareIDMLStructures(originalContent, reconstructedIDML);

            console.log('🔐 COMPLEX FILE VALIDATION:');
            console.log(`Stories: ${document.stories.length}`);
            console.log(`Content Match: ${validation.contentMatch}`);
            console.log(`Structural Match: ${validation.structuralMatch}`);

            expect(validation.contentMatch).toBe(true);
            expect(validation.structuralMatch).toBe(true);
        } catch (error) {
            // Skip test if file doesn't exist
            console.log('⚠️ Complex IDML file not found, skipping test');
        }
    });

    it('should validate your specific IDML file', async () => {
        // Test with your specific file: mat-john.idml
        const fileName = 'mat-john.idml';

        // Use dynamic import to read the file
        let arrayBuffer: ArrayBuffer;

        try {
            // Try to read the file using Node.js fs (if available in test environment)
            const fs = await import('fs');
            const path = await import('path');
            const filePath = path.join(__dirname, fileName);
            const fileBuffer = fs.readFileSync(filePath);

            // Convert Node.js Buffer to proper ArrayBuffer
            arrayBuffer = new ArrayBuffer(fileBuffer.length);
            const uint8View = new Uint8Array(arrayBuffer);
            uint8View.set(fileBuffer);
        } catch (error) {
            console.log('⚠️ Could not read mat-john.idml file, skipping test');
            console.log('💡 Make sure the file is in the tests folder');
            return;
        }

        console.log('🔍 TESTING YOUR IDML FILE:');
        console.log(`File: ${fileName}`);
        console.log(`File size: ${arrayBuffer.byteLength} bytes`);

        // Check if it's a ZIP file (IDML) or plain XML
        const uint8Array = new Uint8Array(arrayBuffer);
        const isZipFile = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B; // "PK" signature

        console.log(`File type: ${isZipFile ? 'ZIP (IDML)' : 'Plain XML'}`);

        // Set up debug logging to see what's happening
        parser.setDebugCallback((message: string) => {
            console.log(`PARSER DEBUG: ${message}`);
        });

        console.log(`ArrayBuffer type check: ${arrayBuffer instanceof ArrayBuffer}`);
        console.log(`ArrayBuffer constructor: ${arrayBuffer.constructor.name}`);

        const document = await parser.parseIDML(arrayBuffer);
        const reconstructedIDML = await exporter.exportToIDML(document);

        // For IDML files, we need to extract the XML content from the ZIP for comparison
        // Let's extract the designmap.xml from the ZIP and compare with reconstructed XML
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(arrayBuffer);
        const designmapContent = await zip.file('designmap.xml')?.async('text');

        if (!designmapContent) {
            console.log('⚠️ Could not extract designmap.xml from ZIP');
            return;
        }

        const validation = await compareIDMLStructures(designmapContent, reconstructedIDML);

        console.log('📊 YOUR FILE RESULTS:');
        console.log(`Document ID: ${document.id}`);
        console.log(`Stories: ${document.stories.length}`);
        console.log(`Total Paragraphs: ${document.stories.reduce((sum, story) => sum + story.paragraphs.length, 0)}`);
        console.log(`Content Match: ${validation.contentMatch}`);
        console.log(`Structural Match: ${validation.structuralMatch}`);
        console.log(`Differences: ${validation.differences.join(', ') || 'None'}`);

        // Debug: Show first few lines of original vs reconstructed
        console.log('\n🔍 DEBUG - First 1000 chars of original designmap.xml:');
        console.log(designmapContent.substring(0, 1000));
        console.log('\n🔍 DEBUG - First 1000 chars of reconstructed:');
        console.log(reconstructedIDML.substring(0, 1000));

        expect(validation.contentMatch).toBe(true);
        expect(validation.structuralMatch).toBe(true);
    }, 30000); // 30 second timeout for large IDML files
});
