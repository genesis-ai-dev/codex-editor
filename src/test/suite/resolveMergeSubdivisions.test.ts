import * as assert from "assert";
import { resolveCodexCustomMerge } from "../../projectManager/utils/merge/resolvers";
import { buildMilestoneCellPayload } from "../../utils/milestoneCellUtils";
import { EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";

const MILESTONE_ID = "milestone-uuid-genesis-1";

/** Fresh copy of the real milestone payload (INITIAL_IMPORT anchor included). */
function buildAnchoredMilestone(): any {
    const payload = buildMilestoneCellPayload({
        referenceCell: { metadata: { id: "GEN 1:1", data: {} } },
        milestoneOrdinal: 1,
        author: "importer",
        uuid: MILESTONE_ID,
    });
    return JSON.parse(JSON.stringify(payload));
}

function subdivisionsEdit(placements: any[], timestamp: number, author: string): any {
    return {
        editMap: EditMapUtils.dataSubdivisions(),
        value: placements,
        timestamp,
        type: EditType.USER_EDIT,
        author,
        validatedBy: [],
    };
}

function subdivisionNamesEdit(
    names: { [key: string]: string; },
    timestamp: number,
    author: string
): any {
    return {
        editMap: EditMapUtils.dataSubdivisionNames(),
        value: names,
        timestamp,
        type: EditType.USER_EDIT,
        author,
        validatedBy: [],
    };
}

function notebook(cells: any[]): string {
    return JSON.stringify({ cells, metadata: { id: "GEN", originalName: "GEN" } });
}

function cellById(mergedJson: string, id: string): any {
    const parsed = JSON.parse(mergedJson);
    return parsed.cells.find((c: any) => c.metadata?.id === id);
}

suite("Codex Custom Merge - subdivision edits carried by edit history", () => {
    test("subdivision breaks added on one side survive the merge in both directions", async () => {
        const plain = buildAnchoredMilestone();
        const anchorTs = plain.metadata.edits[0].timestamp;

        const placements = [{ startCellId: "GEN 1:6" }];
        const names = { "GEN 1:6": "Second Half" };

        const withBreaks = JSON.parse(JSON.stringify(plain));
        withBreaks.metadata.data = {
            ...withBreaks.metadata.data,
            subdivisions: placements,
            subdivisionNames: names,
        };
        withBreaks.metadata.edits.push(
            subdivisionsEdit(placements, anchorTs + 1000, "user1"),
            subdivisionNamesEdit(names, anchorTs + 1000, "user1")
        );

        for (const [ours, theirs] of [
            [withBreaks, plain],
            [plain, withBreaks],
        ]) {
            const merged = await resolveCodexCustomMerge(
                notebook([JSON.parse(JSON.stringify(ours))]),
                notebook([JSON.parse(JSON.stringify(theirs))])
            );
            const cell = cellById(merged, MILESTONE_ID);
            assert.ok(cell, "Milestone cell should survive the merge");
            assert.deepStrictEqual(
                cell.metadata.data?.subdivisions,
                placements,
                "Subdivision placements must survive regardless of merge direction"
            );
            assert.deepStrictEqual(
                cell.metadata.data?.subdivisionNames,
                names,
                "Subdivision names must survive regardless of merge direction"
            );
        }
    });

    test("the newest subdivisions edit wins when both sides changed placements", async () => {
        const base = buildAnchoredMilestone();
        const anchorTs = base.metadata.edits[0].timestamp;

        const olderPlacements = [{ startCellId: "GEN 1:4" }];
        const newerPlacements = [{ startCellId: "GEN 1:6" }, { startCellId: "GEN 1:9" }];

        const older = JSON.parse(JSON.stringify(base));
        older.metadata.data = { ...older.metadata.data, subdivisions: olderPlacements };
        older.metadata.edits.push(subdivisionsEdit(olderPlacements, anchorTs + 1000, "user1"));

        const newer = JSON.parse(JSON.stringify(base));
        newer.metadata.data = { ...newer.metadata.data, subdivisions: newerPlacements };
        newer.metadata.edits.push(subdivisionsEdit(newerPlacements, anchorTs + 2000, "user2"));

        for (const [ours, theirs] of [
            [older, newer],
            [newer, older],
        ]) {
            const merged = await resolveCodexCustomMerge(
                notebook([JSON.parse(JSON.stringify(ours))]),
                notebook([JSON.parse(JSON.stringify(theirs))])
            );
            const cell = cellById(merged, MILESTONE_ID);
            assert.deepStrictEqual(
                cell.metadata.data?.subdivisions,
                newerPlacements,
                "Most recent subdivisions edit should win regardless of merge direction"
            );
        }
    });

    test("clearing subdivisions on one side wins over an older break when recorded as an edit", async () => {
        const base = buildAnchoredMilestone();
        const anchorTs = base.metadata.edits[0].timestamp;

        const placements = [{ startCellId: "GEN 1:6" }];
        const withBreak = JSON.parse(JSON.stringify(base));
        withBreak.metadata.data = { ...withBreak.metadata.data, subdivisions: placements };
        withBreak.metadata.edits.push(subdivisionsEdit(placements, anchorTs + 1000, "user1"));

        // The other side saw the break, then removed it.
        const cleared = JSON.parse(JSON.stringify(withBreak));
        cleared.metadata.data = { ...cleared.metadata.data, subdivisions: [] };
        cleared.metadata.edits.push(subdivisionsEdit([], anchorTs + 2000, "user2"));

        const merged = await resolveCodexCustomMerge(
            notebook([JSON.parse(JSON.stringify(withBreak))]),
            notebook([JSON.parse(JSON.stringify(cleared))])
        );
        assert.deepStrictEqual(
            cellById(merged, MILESTONE_ID).metadata.data?.subdivisions,
            [],
            "The newer clear-breaks edit should win over the older add-break edit"
        );
    });
});
