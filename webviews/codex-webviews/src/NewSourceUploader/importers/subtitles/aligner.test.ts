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

/**
 * A cue whose identifier is one of the notebook's own cell ids — a re-import of this project's
 * exported file. The parser keeps the identifier as data.originalCueId.
 */
const exportedCue = (
    cellId: string,
    startTime: number,
    endTime: number,
    content: string
): ImportedContent => ({
    id: `import-${cellId}`,
    content,
    startTime,
    endTime,
    data: { originalCueId: cellId },
});

// The real 204 timings: TRAINEES cell 16:01.792–16:31.042, ZEE cell nested at 16:23.417–16:24.083.
const P = { start: 961.792, end: 991.042 };
const N = { start: 983.417, end: 984.083 };

describe('subtitlesCellAligner — cues matched by exported cell id', () => {
    it('routes a cue straight to the cell whose id it carries, regardless of timing', async () => {
        const targets = [cell('A', 0, 5), cell('B', 5, 10)];
        // Timed inside A, but the identifier says it is B's cue.
        const imported = [exportedCue('B', 1, 2, 'BELONGS TO B')];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        const primary = primaries(aligned).find((a) => idOf(a) === 'B');
        expect(primary?.importedContent.content).toBe('BELONGS TO B');
        expect(primary?.alignmentMethod).toBe('exact-id');
        expect(primary?.confidence).toBe(1);
        expect(primaries(aligned).find((a) => idOf(a) === 'A')?.importedContent.content).toBe('');
    });

    it('an id match outranks a timestamp match for the same cell', async () => {
        const targets = [cell('A', 0, 10)];
        const imported = [
            cue('c1', 0, 10, 'TIMESTAMP MATCH'),
            exportedCue('A', 4, 5, 'ID MATCH'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        const primary = primaries(aligned).find((a) => idOf(a) === 'A');
        expect(primary?.importedContent.content).toBe('ID MATCH');
        expect(primary?.alignmentMethod).toBe('exact-id');
        expect(overlaps(aligned)[0]?.importedContent.content).toBe('TIMESTAMP MATCH');
    });

    it('ignores cue identifiers that match no cell (plain numbered subtitle files)', async () => {
        const targets = [cell('A', 0, 5)];
        const imported = [{ ...cue('c1', 0, 5, 'normal'), data: { originalCueId: '84' } }];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        const primary = primaries(aligned).find((a) => idOf(a) === 'A');
        expect(primary?.importedContent.content).toBe('normal');
        expect(primary?.alignmentMethod).toBe('timestamp');
    });
});

describe('subtitlesCellAligner — corrupted-export repair (issue #1144 damage baked into the file)', () => {
    // The pre-#1144 importer stamped an enclosing cell with its nested cell's exact timing. An
    // export of such a project contains two identical-timed cues and no full-span cue at all.

    it('restores the displaced cue to the enclosing cell in a fresh project', async () => {
        const sources = [cell('srcP', P.start, P.end), cell('srcN', N.start, N.end)];
        const targets = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const imported = [
            cue('displaced', N.start, N.end, 'PARENT TEXT'), // file order: parent cell first
            cue('genuine', N.start, N.end, 'NESTED TEXT'),
        ];

        const aligned = await subtitlesCellAligner(targets, sources, imported);

        const parentPrimary = primaries(aligned).find((a) => idOf(a) === 'P');
        expect(parentPrimary?.importedContent.content).toBe('PARENT TEXT');
        // Re-timed to the cell's true span, so the write path heals the timestamps too.
        expect(parentPrimary?.importedContent.startTime).toBe(P.start);
        expect(parentPrimary?.importedContent.endTime).toBe(P.end);
        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED TEXT'
        );
        expect(overlaps(aligned)).toHaveLength(0);
    });

    it('falls back to target cell ranges when no source cells are provided', async () => {
        const targets = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const imported = [
            cue('displaced', N.start, N.end, 'PARENT TEXT'),
            cue('genuine', N.start, N.end, 'NESTED TEXT'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'P')?.importedContent.content).toBe(
            'PARENT TEXT'
        );
        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED TEXT'
        );
    });

    it('heals a re-import into the damaged project itself: id routing plus source timings', async () => {
        // The project's own parent cell carries the damage (nested range), so only the .source
        // ranges can restore the true span. The cues carry the cells' ids, being this project's
        // own export.
        const sources = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const targets = [cell('P', N.start, N.end, 'old damaged text'), cell('N', N.start, N.end)];
        const imported = [
            exportedCue('P', N.start, N.end, 'PARENT TEXT'),
            exportedCue('N', N.start, N.end, 'NESTED TEXT'),
        ];

        const aligned = await subtitlesCellAligner(targets, sources, imported);

        const parentPrimary = primaries(aligned).find((a) => idOf(a) === 'P');
        expect(parentPrimary?.importedContent.content).toBe('PARENT TEXT');
        expect(parentPrimary?.alignmentMethod).toBe('exact-id');
        // The restored timing rides on the imported content, healing the cell on write.
        expect(parentPrimary?.importedContent.startTime).toBe(P.start);
        expect(parentPrimary?.importedContent.endTime).toBe(P.end);
        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED TEXT'
        );
    });

    it('leaves a lone nested-timed cue alone — that is a legitimate nested translation', async () => {
        const targets = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const imported = [cue('genuine', N.start, N.end, 'NESTED TEXT')];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED TEXT'
        );
        expect(primaries(aligned).find((a) => idOf(a) === 'P')?.importedContent.content).toBe('');
    });

    it('keeps both duplicates on the nested cell when the enclosing cell has its own cue', async () => {
        const targets = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const imported = [
            cue('full', P.start, P.end, 'PARENT TEXT'),
            cue('n1', N.start, N.end, 'NESTED A'),
            cue('n2', N.start, N.end, 'NESTED B'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'P')?.importedContent.content).toBe(
            'PARENT TEXT'
        );
        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED A'
        );
        expect(overlaps(aligned).map((a) => a.importedContent.content)).toEqual(['NESTED B']);
    });

    it('handles a displaced cue whose text is empty without stealing the nested cell', async () => {
        // Two of the eight damaged cells in the real 204 export carry empty text.
        const targets = [cell('P', P.start, P.end), cell('N', N.start, N.end)];
        const imported = [
            cue('displaced', N.start, N.end, ''),
            cue('genuine', N.start, N.end, 'NESTED TEXT'),
        ];

        const aligned = await subtitlesCellAligner(targets, [], imported);

        expect(primaries(aligned).find((a) => idOf(a) === 'N')?.importedContent.content).toBe(
            'NESTED TEXT'
        );
        // Nothing to restore for P — its translation is genuinely absent from the file.
        expect(primaries(aligned).find((a) => idOf(a) === 'P')?.importedContent.content).toBe('');
        expect(overlaps(aligned)).toHaveLength(0);
    });
});
