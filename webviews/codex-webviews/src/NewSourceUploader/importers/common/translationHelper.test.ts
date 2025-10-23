import { describe, it, expect } from 'vitest';
import { notebookToImportedContent } from './translationHelper';
import { NotebookPair } from '../../types/common';

describe('notebookToImportedContent', () => {
    it('surfaces start/end from metadata.data as top-level fields', () => {
        const pair: NotebookPair = {
            source: {
                name: 'Test',
                metadata: { id: 'id', originalFileName: 'f', importerType: 'subtitles', createdAt: new Date().toISOString() },
                cells: [
                    {
                        id: 'TheSelected-201-en 1:cue-30.697-31.99',
                        content: 'The first time?',
                        images: [],
                        metadata: {
                            id: 'TheSelected-201-en 1:cue-30.697-31.99',
                            type: 'text',
                            data: { startTime: 30.697, endTime: 31.99, format: 'VTT', originalText: 'The first time?' }
                        }
                    }
                ]
            },
            codex: {
                name: 'Test',
                metadata: { id: 'id2', originalFileName: 'f', importerType: 'subtitles', createdAt: new Date().toISOString() },
                cells: []
            }
        };

        const imported = notebookToImportedContent(pair);
        expect(imported[0].startTime).toBe(30.697);
        expect(imported[0].endTime).toBe(31.99);
        expect(imported[0].format).toBe('VTT');
        expect(imported[0].originalText).toBe('The first time?');
    });
});


