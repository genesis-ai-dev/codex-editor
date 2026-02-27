import * as assert from 'assert';
import {
    OffsetTracker,
    createSegmentMetadata,
    buildStructureTree,
    reconstructDocument,
    validateRoundTrip,
    serializeDocumentStructure,
    deserializeDocumentStructure,
    DocumentStructureMetadata,
    generateChecksum
} from '../../webviews/codex-webviews/src/NewSourceUploader/utils/documentStructurePreserver';

describe('Document Structure Preservation', () => {

    describe('OffsetTracker', () => {
        it('should track segment offsets correctly', () => {
            const tracker = new OffsetTracker();

            tracker.recordSegment('cell1', 'Hello world', {
                structuralPath: 'p[0]'
            });

            tracker.recordSegment('cell2', 'This is a test', {
                structuralPath: 'p[1]'
            });

            const segments = tracker.getSegments();

            assert.strictEqual(segments.size, 2);

            const cell1Meta = segments.get('cell1');
            assert.strictEqual(cell1Meta?.originalStart, 0);
            assert.strictEqual(cell1Meta?.originalEnd, 11);
            assert.strictEqual(cell1Meta?.originalContent, 'Hello world');

            const cell2Meta = segments.get('cell2');
            assert.strictEqual(cell2Meta?.originalStart, 11);
            assert.strictEqual(cell2Meta?.originalEnd, 25);
            assert.strictEqual(cell2Meta?.originalContent, 'This is a test');
        });

        it('should handle advancing offset without recording', () => {
            const tracker = new OffsetTracker();

            tracker.recordSegment('cell1', 'First segment', {});
            tracker.advanceOffset(10); // Skip 10 characters
            tracker.recordSegment('cell2', 'Second segment', {});

            const segments = tracker.getSegments();
            const cell2Meta = segments.get('cell2');

            assert.strictEqual(cell2Meta?.originalStart, 23); // 13 + 10
            assert.strictEqual(cell2Meta?.originalEnd, 37); // 23 + 14
        });
    });

    describe('Document Reconstruction', () => {
        it('replaces identical segments in structural order', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    { type: 'element' as const, name: 'p', children: [{ type: 'text' as const, content: 'A', segmentId: 'seg1' }] },
                    { type: 'element' as const, name: 'p', children: [{ type: 'text' as const, content: 'A', segmentId: 'seg2' }] },
                    { type: 'element' as const, name: 'p', children: [{ type: 'text' as const, content: 'B', segmentId: 'seg3' }] },
                ]
            };

            const updated = new Map<string, string>([
                ['seg1', '<em>A1</em>'],
                ['seg2', '<strong>A2</strong>'],
                ['seg3', 'B3']
            ]);

            const result = reconstructDocument(structureTree as any, updated);
            assert.strictEqual(result, '<p><em>A1</em></p><p><strong>A2</strong></p><p>B3</p>');
        });
        it('should reconstruct simple HTML document', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    {
                        type: 'element' as const,
                        name: 'p',
                        children: [
                            {
                                type: 'text' as const,
                                content: 'Original text',
                                segmentId: 'cell1'
                            }
                        ]
                    },
                    {
                        type: 'element' as const,
                        name: 'p',
                        children: [
                            {
                                type: 'text' as const,
                                content: 'Another paragraph',
                                segmentId: 'cell2'
                            }
                        ]
                    }
                ]
            };

            const updatedSegments = new Map([
                ['cell1', 'Translated text'],
                ['cell2', 'Another translated paragraph']
            ]);

            const reconstructed = reconstructDocument(structureTree, updatedSegments);

            assert.strictEqual(
                reconstructed,
                '<p>Translated text</p><p>Another translated paragraph</p>'
            );
        });

        it('should preserve attributes and nested structure', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    {
                        type: 'element' as const,
                        name: 'div',
                        attributes: { class: 'container', id: 'main' },
                        children: [
                            {
                                type: 'element' as const,
                                name: 'h1',
                                children: [
                                    {
                                        type: 'text' as const,
                                        content: 'Title',
                                        segmentId: 'cell1'
                                    }
                                ]
                            },
                            {
                                type: 'element' as const,
                                name: 'p',
                                attributes: { style: 'color: blue;' },
                                children: [
                                    {
                                        type: 'text' as const,
                                        content: 'Content',
                                        segmentId: 'cell2'
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const updatedSegments = new Map([
                ['cell1', 'New Title'],
                ['cell2', 'New Content']
            ]);

            const reconstructed = reconstructDocument(structureTree, updatedSegments);

            assert.strictEqual(
                reconstructed,
                '<div class="container" id="main"><h1>New Title</h1><p style="color: blue;">New Content</p></div>'
            );
        });

        it('should handle mixed content with translatable and non-translatable segments', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    {
                        type: 'element' as const,
                        name: 'p',
                        children: [
                            {
                                type: 'text' as const,
                                content: 'Translatable: ',
                                segmentId: 'cell1'
                            },
                            {
                                type: 'element' as const,
                                name: 'strong',
                                children: [
                                    {
                                        type: 'text' as const,
                                        content: 'important'
                                    }
                                ]
                            },
                            {
                                type: 'text' as const,
                                content: ' end of sentence.',
                                segmentId: 'cell2'
                            }
                        ]
                    }
                ]
            };

            const updatedSegments = new Map([
                ['cell1', 'Translated: '],
                ['cell2', ' fin de la phrase.']
            ]);

            const reconstructed = reconstructDocument(structureTree, updatedSegments);

            assert.strictEqual(
                reconstructed,
                '<p>Translated: <strong>important</strong> fin de la phrase.</p>'
            );
        });
    });

    describe('Round-trip Validation', () => {
        it('should validate exact match', async () => {
            const original = '<p>Hello world</p>';
            const reconstructed = '<p>Hello world</p>';

            const result = await validateRoundTrip(original, reconstructed);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.similarity, 1.0);
        });

        it('should handle whitespace normalization', async () => {
            const original = '<p>Hello   world</p>\n\n<p>Test</p>';
            const reconstructed = '<p>Hello world</p> <p>Test</p>';

            const result = await validateRoundTrip(original, reconstructed, {
                whitespaceNormalization: true
            });

            assert.strictEqual(result.isValid, true);
        });

        it('should detect significant differences', async () => {
            const original = '<p>Hello world</p>';
            const reconstructed = '<p>Goodbye world</p>';

            const result = await validateRoundTrip(original, reconstructed);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.similarity < 0.95);
            assert.ok(result.differences && result.differences.length > 0);
        });
    });

    describe('Complex Document Round-trip', () => {
        it('should handle a complete Word-like document structure', async () => {
            // Simulate a Word document converted to HTML
            const originalHTML = `
                <div class="document">
                    <h1 style="text-align: center;">Mission Statement</h1>
                    <p><strong>Mission Statement</strong>: <br />
                    Regent University serves as a center of Christian thought and action to provide excellent education through a Biblical perspective and global context equipping Christian leaders to change the world.</p>
                    <h2>Section 1: Course Overview</h2>
                    <p>This course provides comprehensive coverage of New Testament Greek.</p>
                    <ul>
                        <li>Grammar fundamentals</li>
                        <li>Vocabulary building</li>
                        <li>Translation practice</li>
                    </ul>
                    <table border="1">
                        <tr><th>Week</th><th>Topic</th></tr>
                        <tr><td>1</td><td>Introduction</td></tr>
                        <tr><td>2</td><td>Alphabet</td></tr>
                    </table>
                    <p class="footnote">Note: Additional materials available online.</p>
                </div>
            `.trim();

            // Track segments
            const tracker = new OffsetTracker();
            const segmentMap = new Map<string, string>();

            // Simulate segmentation (simplified)
            const segments = [
                { id: 'BIBL670-1:1', content: 'Mission Statement' },
                { id: 'BIBL670-1:2', content: 'Regent University serves as a center of Christian thought and action to provide excellent education through a Biblical perspective and global context equipping Christian leaders to change the world.' },
                { id: 'BIBL670-1:3', content: 'Section 1: Course Overview' },
                { id: 'BIBL670-1:4', content: 'This course provides comprehensive coverage of New Testament Greek.' },
                { id: 'BIBL670-1:5', content: 'Grammar fundamentals' },
                { id: 'BIBL670-1:6', content: 'Vocabulary building' },
                { id: 'BIBL670-1:7', content: 'Translation practice' },
                { id: 'BIBL670-1:8', content: 'Note: Additional materials available online.' }
            ];

            segments.forEach(seg => {
                tracker.recordSegment(seg.id, seg.content, {
                    structuralPath: `segment[${seg.id}]`
                });
                segmentMap.set(seg.content, seg.id);
            });

            // Create document structure metadata
            const metadata: DocumentStructureMetadata = {
                originalFileRef: 'attachments/files/originals/BIBL670.docx',
                originalMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                originalFileHash: await generateChecksum(originalHTML),
                importedAt: new Date().toISOString(),
                segments: tracker.getSegments(),
                preservationFormatVersion: '1.0.0'
            };

            // Serialize and deserialize to test persistence
            const serialized = serializeDocumentStructure(metadata);
            const deserialized = deserializeDocumentStructure(serialized);

            assert.strictEqual(deserialized.segments.size, segments.length);
            assert.strictEqual(deserialized.originalFileRef, metadata.originalFileRef);

            // Simulate translation updates
            const translations = new Map([
                ['BIBL670-1:1', 'Declaración de Misión'],
                ['BIBL670-1:2', 'La Universidad Regent sirve como centro de pensamiento y acción cristiana para proporcionar educación excelente a través de una perspectiva bíblica y contexto global equipando líderes cristianos para cambiar el mundo.'],
                ['BIBL670-1:3', 'Sección 1: Descripción del Curso'],
                ['BIBL670-1:4', 'Este curso proporciona cobertura integral del griego del Nuevo Testamento.'],
                ['BIBL670-1:5', 'Fundamentos de gramática'],
                ['BIBL670-1:6', 'Construcción de vocabulario'],
                ['BIBL670-1:7', 'Práctica de traducción'],
                ['BIBL670-1:8', 'Nota: Materiales adicionales disponibles en línea.']
            ]);

            // Test that we can track which segments changed
            const changedSegments = new Set<string>();
            translations.forEach((translation, cellId) => {
                const original = deserialized.segments.get(cellId);
                if (original && original.originalContent !== translation) {
                    changedSegments.add(cellId);
                }
            });

            assert.strictEqual(changedSegments.size, 8); // All segments changed (translated)
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty segments gracefully', () => {
            const tracker = new OffsetTracker();
            tracker.recordSegment('empty', '', {});

            const segments = tracker.getSegments();
            const emptyMeta = segments.get('empty');

            assert.strictEqual(emptyMeta?.originalStart, 0);
            assert.strictEqual(emptyMeta?.originalEnd, 0);
            assert.strictEqual(emptyMeta?.originalContent, '');
        });

        it('should handle self-closing tags', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    {
                        type: 'element' as const,
                        name: 'br',
                        children: []
                    },
                    {
                        type: 'element' as const,
                        name: 'img',
                        attributes: { src: 'image.jpg', alt: 'Test' },
                        children: []
                    }
                ]
            };

            const reconstructed = reconstructDocument(structureTree, new Map());

            assert.ok(reconstructed.includes('<br />'));
            assert.ok(reconstructed.includes('<img src="image.jpg" alt="Test" />'));
        });

        it('should preserve special characters in content', () => {
            const structureTree = {
                type: 'element' as const,
                name: 'root',
                children: [
                    {
                        type: 'element' as const,
                        name: 'p',
                        children: [
                            {
                                type: 'text' as const,
                                content: 'Special chars: < > & " \'',
                                segmentId: 'cell1'
                            }
                        ]
                    }
                ]
            };

            const updatedSegments = new Map([
                ['cell1', 'Caractères spéciaux: < > & " \'']
            ]);

            const reconstructed = reconstructDocument(structureTree, updatedSegments);

            assert.ok(reconstructed.includes('Caractères spéciaux: < > & " \''));
        });
    });
});
