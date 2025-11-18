import { describe, it, expect } from 'vitest';
import { createNotebookPair } from '../common/usfmUtils';
import { createProcessedCell } from '../../utils/workflowHelpers';

describe('eBible Download - Text Direction Preservation', () => {
    describe('createBookNotebooks textDirection handling', () => {
        it('should pass RTL textDirection to createNotebookPair', () => {
            // This test verifies the logic in createBookNotebooks
            // We'll test createNotebookPair directly since createBookNotebooks is not exported

            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                    cellLabel: '1',
                    originalText: 'In the beginning',
                }),
            ];

            const metadata = {
                bookName: 'GEN',
                languageCode: 'arb',
                translationId: 'arbnav',
                verseCount: 1,
                chapters: [1],
                corpusMarker: 'OT',
                textDirection: 'rtl' as const,
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadata);

            // Verify textDirection is preserved in source notebook metadata
            expect(notebookPair.source.metadata.textDirection).toBe('rtl');
            expect(notebookPair.codex.metadata.textDirection).toBe('rtl');
        });

        it('should pass LTR textDirection to createNotebookPair', () => {
            const cells = [
                createProcessedCell('MAT 1:1', 'The book of the generation', {
                    type: 'verse',
                    book: 'MAT',
                    chapter: 1,
                    verse: 1,
                    cellLabel: '1',
                    originalText: 'The book of the generation',
                }),
            ];

            const metadata = {
                bookName: 'MAT',
                languageCode: 'eng',
                translationId: 'web',
                verseCount: 1,
                chapters: [1],
                corpusMarker: 'NT',
                textDirection: 'ltr' as const,
            };

            const notebookPair = createNotebookPair('MAT', cells, 'ebibleCorpus', metadata);

            // Verify textDirection is preserved in source notebook metadata
            expect(notebookPair.source.metadata.textDirection).toBe('ltr');
            expect(notebookPair.codex.metadata.textDirection).toBe('ltr');
        });

        it('should handle missing textDirection gracefully', () => {
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                    cellLabel: '1',
                    originalText: 'In the beginning',
                }),
            ];

            const metadata = {
                bookName: 'GEN',
                languageCode: 'eng',
                translationId: 'web',
                verseCount: 1,
                chapters: [1],
                corpusMarker: 'OT',
                // textDirection is intentionally omitted
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadata);

            // When textDirection is missing, it should be undefined in metadata
            // (convertToNotebookPreview will default it to 'ltr')
            expect(notebookPair.source.metadata.textDirection).toBeUndefined();
            expect(notebookPair.codex.metadata.textDirection).toBeUndefined();
        });

        it('should preserve textDirection when conditional spread is used', () => {
            // Test the conditional spread pattern: ...(metadata.textDirection && { textDirection: metadata.textDirection })
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                    cellLabel: '1',
                    originalText: 'In the beginning',
                }),
            ];

            // Simulate the conditional spread pattern from createBookNotebooks
            const baseMetadata = {
                bookName: 'GEN',
                languageCode: 'arb',
                translationId: 'arbnav',
                verseCount: 1,
                chapters: [1],
                corpusMarker: 'OT',
            };

            const textDirection = 'rtl';
            const metadataWithConditional = {
                ...baseMetadata,
                ...(textDirection && { textDirection }),
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadataWithConditional);

            // Verify textDirection is preserved
            expect(notebookPair.source.metadata.textDirection).toBe('rtl');
            expect(notebookPair.codex.metadata.textDirection).toBe('rtl');
        });

        it('should not include textDirection when conditional spread evaluates to false', () => {
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                    cellLabel: '1',
                    originalText: 'In the beginning',
                }),
            ];

            // Simulate the conditional spread pattern with empty string (falsy)
            const baseMetadata = {
                bookName: 'GEN',
                languageCode: 'eng',
                translationId: 'web',
                verseCount: 1,
                chapters: [1],
                corpusMarker: 'OT',
            };

            const textDirection = ''; // Empty string is falsy
            const metadataWithConditional = {
                ...baseMetadata,
                ...(textDirection && { textDirection }),
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadataWithConditional);

            // Verify textDirection is not included when empty string
            expect(notebookPair.source.metadata.textDirection).toBeUndefined();
            expect(notebookPair.codex.metadata.textDirection).toBeUndefined();
        });
    });

    describe('createNotebookPair textDirection preservation', () => {
        it('should preserve textDirection in source notebook metadata', () => {
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                }),
            ];

            const metadata = {
                textDirection: 'rtl' as const,
                languageCode: 'arb',
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadata);

            expect(notebookPair.source.metadata.textDirection).toBe('rtl');
        });

        it('should preserve textDirection in codex notebook metadata', () => {
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                }),
            ];

            const metadata = {
                textDirection: 'rtl' as const,
                languageCode: 'arb',
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadata);

            // Codex notebook should inherit textDirection from source metadata
            expect(notebookPair.codex.metadata.textDirection).toBe('rtl');
        });

        it('should preserve other metadata fields along with textDirection', () => {
            const cells = [
                createProcessedCell('GEN 1:1', 'In the beginning', {
                    type: 'verse',
                    book: 'GEN',
                    chapter: 1,
                    verse: 1,
                }),
            ];

            const metadata = {
                textDirection: 'rtl' as const,
                languageCode: 'arb',
                translationId: 'arbnav',
                verseCount: 1,
            };

            const notebookPair = createNotebookPair('GEN', cells, 'ebibleCorpus', metadata);

            expect(notebookPair.source.metadata.textDirection).toBe('rtl');
            expect(notebookPair.source.metadata.languageCode).toBe('arb');
            expect(notebookPair.source.metadata.translationId).toBe('arbnav');
            expect(notebookPair.source.metadata.verseCount).toBe(1);
        });
    });
});

