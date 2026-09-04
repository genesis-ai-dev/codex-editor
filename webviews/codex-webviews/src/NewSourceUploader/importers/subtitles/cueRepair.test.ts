import { describe, it, expect } from 'vitest';
import { repairDisplacedCueTimings } from './cueRepair';

/**
 * Tests for the corrupted-export fingerprint: two cues sharing identical timestamps, one of them
 * displaced from an enclosing cell by the pre-#1144 importer (see cueRepair.ts).
 */

// The real 204 case: TRAINEES cell 16:01.792–16:31.042, ZEE nested cell 16:23.417–16:24.083.
const PARENT = { id: 'parent', start: 961.792, end: 991.042 };
const NESTED = { id: 'nested', start: 983.417, end: 984.083 };

describe('repairDisplacedCueTimings', () => {
    it('re-times the displaced cue to the enclosing cell and keeps the genuine one', () => {
        const cues = [
            { start: NESTED.start, end: NESTED.end }, // displaced parent cue (file order: first)
            { start: NESTED.start, end: NESTED.end }, // genuine nested cue
        ];

        const retimings = repairDisplacedCueTimings(cues, [PARENT, NESTED]);

        expect(retimings).toHaveLength(1);
        expect(retimings[0]).toMatchObject({
            cueIndex: 0,
            startTime: PARENT.start,
            endTime: PARENT.end,
            cellId: 'parent',
            originalStartTime: NESTED.start,
            originalEndTime: NESTED.end,
        });
    });

    it('does nothing for a single cue at the nested timing (a legitimate nested translation)', () => {
        const cues = [{ start: NESTED.start, end: NESTED.end }];
        expect(repairDisplacedCueTimings(cues, [PARENT, NESTED])).toHaveLength(0);
    });

    it('does nothing when the enclosing cell already has a cue of its own', () => {
        const cues = [
            { start: PARENT.start, end: PARENT.end },
            { start: NESTED.start, end: NESTED.end },
            { start: NESTED.start, end: NESTED.end },
        ];
        // The parent is not starving, so the duplicate cannot be a displaced parent cue.
        expect(repairDisplacedCueTimings(cues, [PARENT, NESTED])).toHaveLength(0);
    });

    it('does nothing when no cell matches the duplicated timing exactly', () => {
        const cues = [
            { start: 983.0, end: 984.5 },
            { start: 983.0, end: 984.5 },
        ];
        expect(repairDisplacedCueTimings(cues, [PARENT, NESTED])).toHaveLength(0);
    });

    it('bails out when two starving enclosing cells make the situation ambiguous', () => {
        const grandparent = { id: 'grandparent', start: 950, end: 1000 };
        const cues = [
            { start: NESTED.start, end: NESTED.end },
            { start: NESTED.start, end: NESTED.end },
        ];
        // Three candidate cells for two cues — no confident assignment exists.
        expect(repairDisplacedCueTimings(cues, [grandparent, PARENT, NESTED])).toHaveLength(0);
    });

    it('requires the enclosing cell to be materially longer than the cue', () => {
        const barelyLonger = { id: 'barely', start: 983.4, end: 984.1 }; // cue fills > 90% of it
        const cues = [
            { start: NESTED.start, end: NESTED.end },
            { start: NESTED.start, end: NESTED.end },
        ];
        expect(repairDisplacedCueTimings(cues, [barelyLonger, NESTED])).toHaveLength(0);
    });

    it('tolerates sub-millisecond float noise when matching ranges', () => {
        const cues = [
            { start: NESTED.start + 0.0004, end: NESTED.end - 0.0004 },
            { start: NESTED.start + 0.0004, end: NESTED.end - 0.0004 },
        ];
        const retimings = repairDisplacedCueTimings(cues, [PARENT, NESTED]);
        expect(retimings).toHaveLength(1);
        expect(retimings[0].cellId).toBe('parent');
    });

    it('repairs several independent damaged pairs in one file', () => {
        const parent2 = { id: 'parent2', start: 1287.042, end: 1292.583 };
        const nested2 = { id: 'nested2', start: 1290.417, end: 1290.75 };
        const cues = [
            { start: NESTED.start, end: NESTED.end },
            { start: NESTED.start, end: NESTED.end },
            { start: nested2.start, end: nested2.end },
            { start: nested2.start, end: nested2.end },
        ];

        const retimings = repairDisplacedCueTimings(cues, [PARENT, NESTED, parent2, nested2]);

        expect(retimings).toHaveLength(2);
        expect(retimings.map((r) => [r.cueIndex, r.cellId])).toEqual([
            [0, 'parent'],
            [2, 'parent2'],
        ]);
    });
});
