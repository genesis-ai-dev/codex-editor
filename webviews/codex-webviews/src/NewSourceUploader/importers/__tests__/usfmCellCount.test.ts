import { describe, it, expect } from 'vitest';
import { parseFile } from '../usfm/index';
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
    constructor(content: string, name: string, type = 'text/plain') {
        this._content = content;
        this.name = name;
        this.type = type;
        this.size = content.length;
        this.lastModified = Date.now();
    }
    text(): Promise<string> { return Promise.resolve(this._content); }
    [Symbol.toStringTag]: string = 'File';
}

describe('USFM Importer - Cell Count Consistency', () => {
    it('should produce matching cell counts when same file imported twice', async () => {
        const usfm = `\\id GEN
\\c 1
\\v 1 In the beginning God created the heavens and the earth.
\\p
\\v 2 Now the earth was formless and empty.`;
        
        const file = new MockFile(usfm, 'GEN.usfm') as unknown as File;
        const result1 = await parseFile(file);
        const result2 = await parseFile(file);

        expect(result1.success && result2.success).toBe(true);
        assertMatchingCellCounts(result1.notebookPair!);
        assertMatchingCellCounts(result2.notebookPair!);
        expect(result1.notebookPair!.source.cells.length).toBe(result2.notebookPair!.source.cells.length);
    });
});

