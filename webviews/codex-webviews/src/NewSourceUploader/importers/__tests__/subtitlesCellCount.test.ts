import { describe, it, expect } from 'vitest';
import { subtitlesImporter } from '../subtitles/index';
import { assertMatchingCellCounts } from './cellCountUtils';

class MockFile {
    readonly lastModified: number;
    readonly name: string;
    readonly size: number;
    readonly type: string;
    readonly webkitRelativePath: string = '';
    private readonly _content: string;
    arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Not implemented'); }
    slice(): Blob { throw new Error('Not implemented'); }
    stream(): ReadableStream<any> { throw new Error('Not implemented'); }
    constructor(content: string, name: string, type = 'text/vtt') {
        this._content = content;
        this.name = name;
        this.type = type;
        this.size = content.length;
        this.lastModified = Date.now();
    }
    text(): Promise<string> { return Promise.resolve(this._content); }
    [Symbol.toStringTag]: string = 'File';
}

describe('Subtitles Importer - Cell Count Consistency', () => {
    it('should produce matching cell counts when same file imported twice', async () => {
        const vtt = `WEBVTT

00:00:30.697 --> 00:00:31.990
The first time?

00:00:32.783 --> 00:00:34.785
You know the first time.`;
        
        const file = new MockFile(vtt, 'test.vtt') as unknown as File;
        const result1 = await subtitlesImporter.parseFile(file);
        const result2 = await subtitlesImporter.parseFile(file);

        expect(result1.success && result2.success).toBe(true);
        assertMatchingCellCounts(result1.notebookPair!);
        assertMatchingCellCounts(result2.notebookPair!);
        expect(result1.notebookPair!.source.cells.length).toBe(result2.notebookPair!.source.cells.length);
        expect(result1.notebookPair!.source.cells[0].id).toBe(result2.notebookPair!.source.cells[0].id);
    });
});

