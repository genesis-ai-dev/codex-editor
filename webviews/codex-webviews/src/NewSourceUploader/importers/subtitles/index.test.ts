import { describe, it, expect } from 'vitest';
import { subtitlesImporter } from './index';

// Minimal File-like shim for tests
class MockFile {
    readonly lastModified: number;
    readonly name: string;
    readonly size: number;
    readonly type: string;
    readonly webkitRelativePath: string = '';
    private readonly _content: string;
    arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Not implemented'); }
    slice(start?: number | undefined, end?: number | undefined, contentType?: string | undefined): Blob { throw new Error('Not implemented'); }
    stream(): ReadableStream<any> { throw new Error('Not implemented'); }
    constructor(parts: string, name: string, type = 'text/vtt') {
        this._content = parts;
        this.name = name;
        this.type = type;
        this.size = parts.length;
        this.lastModified = Date.now();
    }
    text(): Promise<string> { return Promise.resolve(this._content); }
    [Symbol.toStringTag]: string = 'File';
}

describe('subtitlesImporter.parseFile', () => {
    it('nests start/end under metadata.data for VTT', async () => {
        const vtt = `WEBVTT\n\n00:00:30.697 --> 00:00:31.990\nThe first time?\n\n00:00:32.783 --> 00:00:34.785\nYou know the first time.`;
        const file = new MockFile(vtt, 'TheChosen-201-en-SingleSpeaker.vtt');

        const result = await subtitlesImporter.parseFile(file as unknown as File);
        expect(result.success).toBe(true);
        const pair = result.notebookPair!;
        const first = pair.source.cells[0];
        expect(first.metadata?.type).toBe('milestone');
        expect(first.metadata?.data?.startTime).toBeTypeOf('number');
        expect(first.metadata?.data?.endTime).toBeTypeOf('number');
        expect(first.metadata?.data?.format).toBe('VTT');
        expect(typeof first.metadata?.data?.originalText).toBe('string');
    });
});


