import { describe, it, expect } from 'vitest';
import { subtitlesImporter, validateSubtitleTimestamps } from './index';

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
        // First cell is a milestone cell, second cell is the first subtitle cell
        const firstSubtitleCell = pair.source.cells[1];
        expect(firstSubtitleCell.metadata?.type).toBe('text');
        expect(firstSubtitleCell.metadata?.data?.startTime).toBeTypeOf('number');
        expect(firstSubtitleCell.metadata?.data?.endTime).toBeTypeOf('number');
        expect(firstSubtitleCell.metadata?.data?.format).toBe('VTT');
        expect(typeof firstSubtitleCell.metadata?.data?.originalText).toBe('string');
    });
});

describe('validateSubtitleTimestamps', () => {
    it('returns no warnings for a well-ordered VTT', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '00:00:01.000 --> 00:00:03.000',
            'First cue',
            '',
            '2',
            '00:00:04.000 --> 00:00:06.000',
            'Second cue',
            '',
            '3',
            '00:00:07.000 --> 00:00:09.000',
            'Third cue',
        ].join('\n');

        expect(validateSubtitleTimestamps(vtt)).toEqual([]);
    });

    it('returns no warnings for a well-ordered SRT', () => {
        const srt = [
            '1',
            '00:00:01,000 --> 00:00:03,000',
            'First cue',
            '',
            '2',
            '00:00:04,000 --> 00:00:06,000',
            'Second cue',
        ].join('\n');

        expect(validateSubtitleTimestamps(srt)).toEqual([]);
    });

    it('catches small overlaps from multi-speaker cues (<5s)', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '00:00:10.000 --> 00:00:14.000',
            'Speaker A',
            '',
            '1',
            '00:00:10.000 --> 00:00:14.000',
            'Speaker B (same timestamp, overlap of 4s)',
        ].join('\n');

        const warnings = validateSubtitleTimestamps(vtt);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/non-sequential timestamps/);
        expect(warnings[0]).toMatch(/4 seconds/);
    });

    it('warns when timestamps jump backwards significantly (corrupted hour)', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '01:00:23.625 --> 01:00:28.458',
            'Cue with wrong hour',
            '',
            '2',
            '00:00:52.886 --> 00:00:54.763',
            'Cue with correct hour (jumps back ~3573s)',
        ].join('\n');

        const warnings = validateSubtitleTimestamps(vtt);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/non-sequential timestamps/);
        expect(warnings[0]).toMatch(/1 hour/);
    });

    it('counts multiple out-of-order cues', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '01:00:23.000 --> 01:00:28.000',
            'Wrong hour',
            '',
            '2',
            '00:00:30.000 --> 00:00:35.000',
            'Correct (jump back)',
            '',
            '3',
            '01:00:40.000 --> 01:00:45.000',
            'Wrong hour again',
            '',
            '4',
            '00:00:50.000 --> 00:00:55.000',
            'Correct (jump back again)',
        ].join('\n');

        const warnings = validateSubtitleTimestamps(vtt);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/2 subtitle cue/);
    });

    it('reports minutes for moderate jumps', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '00:05:00.000 --> 00:05:30.000',
            'Later cue first',
            '',
            '2',
            '00:01:00.000 --> 00:01:05.000',
            'Earlier cue second (jumps back ~270s)',
        ].join('\n');

        const warnings = validateSubtitleTimestamps(vtt);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/\d+ minutes/);
    });

    it('reports seconds for small jumps', () => {
        const vtt = [
            'WEBVTT',
            '',
            '1',
            '00:00:30.000 --> 00:00:40.000',
            'Later cue first',
            '',
            '2',
            '00:00:10.000 --> 00:00:15.000',
            'Earlier cue second (jumps back ~30s)',
        ].join('\n');

        const warnings = validateSubtitleTimestamps(vtt);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/\d+ seconds/);
    });
});
