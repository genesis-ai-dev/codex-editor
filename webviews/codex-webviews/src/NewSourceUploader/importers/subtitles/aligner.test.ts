import { describe, it, expect } from 'vitest';
import { subtitlesCellAligner } from './aligner';
import { AlignedCell, ImportedContent } from '../../types/plugin';

/**
 * Regression tests for issue #1144 — a VTT imported as a target used to overwrite a cell with the
 * last cue that happened to overlap it.
 */

const cell = (id: string, startTime: number, endTime: number, value = '') =>
    ({
        kind: 2,
        languageId: 'html',
        value,
        metadata: { id, type: 'text', data: { startTime, endTime } },
    }) as any;

const cue = (id: string, startTime: number, endTime: number, content: string): ImportedContent => ({
    id,
    content,
    startTime,
    endTime,
});

const idOf = (aligned: AlignedCell) => aligned.notebookCell?.metadata?.id;
const primaries = (aligned: AlignedCell[]) =>
    aligned.filter((a) => !a.isParatext && !a.isAdditionalOverlap);
const overlaps = (aligned: AlignedCell[]) => aligned.filter((a) => a.isAdditionalOverlap);

describe('subtitlesCellAligner — two cues over one cell', () => {
    it('makes the wider overlap the primary match and flags the sub-cue as additional', async () => {
        const targets = [cell('A', 10, 18)];
        const imported = [
            cue('c1', 10, 18, 'TRANSLATION A'),
            cue('c2', 12, 14, 'SUB-CUE B'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        const primary = primaries(aligned).find((a) => idOf(a) === 'A');
        expect(primary?.importedContent.content).toBe('TRANSLATION A');

        const additional = overlaps(aligned);
        expect(additional).toHaveLength(1);
        expect(additional[0].importedContent.content).toBe('SUB-CUE B');
        // The extra cue points back at the cell whose text it will be folded into.
        expect(additional[0].importedContent.parentId).toBe('A');
    });

    it('picks the primary by overlap regardless of the order the cues arrive in', async () => {
        const targets = [cell('A', 10, 18)];
        const reversed = [
            cue('c2', 12, 14, 'SUB-CUE B'),
            cue('c1', 10, 18, 'TRANSLATION A'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], reversed);

        expect(primaries(aligned).find((a) => idOf(a) === 'A')?.importedContent.content).toBe(
            'TRANSLATION A'
        );
        expect(overlaps(aligned)[0].importedContent.content).toBe('SUB-CUE B');
    });
});

describe('subtitlesCellAligner — a cue nested inside the previous cue', () => {
    it('gives the nested cue its own cell instead of the enclosing one', async () => {
        // Cell B's range sits entirely inside cell A's, so a cue timed like B overlaps both by
        // exactly the same amount. Before the fix the tie went to A and B was left empty forever.
        const targets = [cell('A', 10, 18), cell('B', 12, 14)];
        const imported = [
            cue('c1', 10, 18, 'TRANSLATION A'),
            cue('c2', 12, 14, 'TRANSLATION B'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'A')?.importedContent.content).toBe(
            'TRANSLATION A'
        );
        expect(primaries(aligned).find((a) => idOf(a) === 'B')?.importedContent.content).toBe(
            'TRANSLATION B'
        );
        expect(overlaps(aligned)).toHaveLength(0);
    });

    it('handles the timings from the reported 204 case', async () => {
        // Source cell 155 is nested inside 154; VTT cue 217 is nested inside cue 216.
        const t = (m: number, s: number) => m * 60 + s;
        const targets = [
            cell('cell154', t(23, 16.167), t(23, 23.833)),
            cell('cell155', t(23, 21.125), t(23, 22.167)),
        ];
        const imported = [
            cue('cue216', t(23, 16.167), t(23, 23.834), 'cue 216 text'),
            cue('cue217', t(23, 21.125), t(23, 22.167), 'cue 217 text'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'cell154')?.importedContent.content).toBe(
            'cue 216 text'
        );
        expect(primaries(aligned).find((a) => idOf(a) === 'cell155')?.importedContent.content).toBe(
            'cue 217 text'
        );
        expect(overlaps(aligned)).toHaveLength(0);
    });
});

describe('subtitlesCellAligner — alignments that were already correct', () => {
    it('leaves ordinary one-to-one alignment untouched', async () => {
        const targets = [cell('A', 0, 5), cell('B', 5, 10), cell('C', 10, 15)];
        const imported = [
            cue('c1', 0.1, 5.1, 'one'),
            cue('c2', 5.2, 9.8, 'two'),
            cue('c3', 10, 15, 'three'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'A')?.importedContent.content).toBe('one');
        expect(primaries(aligned).find((a) => idOf(a) === 'B')?.importedContent.content).toBe('two');
        expect(primaries(aligned).find((a) => idOf(a) === 'C')?.importedContent.content).toBe('three');
        expect(overlaps(aligned)).toHaveLength(0);
    });

    it('still gives a straddling cue to the cell it overlaps most', async () => {
        const targets = [cell('A', 0, 10), cell('B', 10, 14)];
        const imported = [cue('c1', 8, 13, 'straddles')];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        // 2s of overlap with A, 3s with B — B wins on overlap, no tie involved.
        expect(primaries(aligned).find((a) => idOf(a) === 'B')?.importedContent.content).toBe(
            'straddles'
        );
    });

    it('keeps a cue that matches nothing as paratext', async () => {
        const targets = [cell('A', 0, 5)];
        const imported = [cue('c1', 100, 105, 'nowhere near')];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        const paratext = aligned.filter((a) => a.isParatext);
        expect(paratext).toHaveLength(1);
        expect(paratext[0].importedContent.content).toBe('nowhere near');
    });
});
