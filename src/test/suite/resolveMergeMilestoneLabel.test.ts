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

function textCell(id: string, value: string, edits: any[] = []): any {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { type: "text", id, data: {}, edits },
    };
}

function valueEdit(value: string, timestamp: number, author: string, type = EditType.USER_EDIT) {
    return {
        editMap: EditMapUtils.value(),
        value,
        timestamp,
        type,
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

suite("Codex Custom Merge - milestone label anchored by initial-import edit", () => {
    test("milestone label survives a 3-way merge with concurrent verse edits on both sides", async () => {
        const milestone = buildAnchoredMilestone();
        const anchorTs = milestone.metadata.edits[0].timestamp;

        // Both users synced the same import, then each edited a verse.
        const ours = notebook([
            JSON.parse(JSON.stringify(milestone)),
            textCell("GEN 1:1", "<span>our edit</span>", [
                valueEdit("<span>our edit</span>", anchorTs + 1000, "user1"),
            ]),
        ]);
        const theirs = notebook([
            JSON.parse(JSON.stringify(milestone)),
            textCell("GEN 1:1", "<span>their newer edit</span>", [
                valueEdit("<span>their newer edit</span>", anchorTs + 2000, "user2"),
            ]),
        ]);

        const merged = await resolveCodexCustomMerge(ours, theirs);

        const mergedMilestone = cellById(merged, MILESTONE_ID);
        assert.ok(mergedMilestone, "Milestone cell should survive the merge");
        assert.strictEqual(mergedMilestone.value, "Genesis 1");

        const anchorEdits = mergedMilestone.metadata.edits.filter(
            (e: any) => e.type === EditType.INITIAL_IMPORT
        );
        assert.strictEqual(
            anchorEdits.length,
            1,
            "Identical initial-import anchors from both sides should dedupe to one"
        );
        assert.strictEqual(anchorEdits[0].value, "Genesis 1");

        const mergedVerse = cellById(merged, "GEN 1:1");
        assert.strictEqual(
            mergedVerse.value,
            "<span>their newer edit</span>",
            "Newest verse edit should win"
        );
    });

    test("initial-import anchor restores the label when the incoming copy lost it", async () => {
        const anchored = buildAnchoredMilestone();

        // Same cell id, but the label was lost and there is no edit history —
        // e.g. a write from a client that predates the anchor.
        const stripped = JSON.parse(JSON.stringify(anchored));
        stripped.value = "";
        stripped.metadata.edits = [];

        const mergedOursAnchored = await resolveCodexCustomMerge(
            notebook([JSON.parse(JSON.stringify(anchored))]),
            notebook([JSON.parse(JSON.stringify(stripped))])
        );
        assert.strictEqual(cellById(mergedOursAnchored, MILESTONE_ID).value, "Genesis 1");

        // The direction that proves the anchor does the work: the base cell is
        // the stripped copy, so only the anchor edit can restore the value.
        const mergedTheirsAnchored = await resolveCodexCustomMerge(
            notebook([JSON.parse(JSON.stringify(stripped))]),
            notebook([JSON.parse(JSON.stringify(anchored))])
        );
        assert.strictEqual(cellById(mergedTheirsAnchored, MILESTONE_ID).value, "Genesis 1");
    });

    test("milestone rename outranks the anchor in both merge directions", async () => {
        const stale = buildAnchoredMilestone();
        const anchorTs = stale.metadata.edits[0].timestamp;

        const renamed = JSON.parse(JSON.stringify(stale));
        renamed.value = "Creation Week";
        renamed.metadata.edits.push(valueEdit("Creation Week", anchorTs + 5000, "user1"));

        for (const [ours, theirs] of [
            [renamed, stale],
            [stale, renamed],
        ]) {
            const merged = await resolveCodexCustomMerge(
                notebook([JSON.parse(JSON.stringify(ours))]),
                notebook([JSON.parse(JSON.stringify(theirs))])
            );
            const cell = cellById(merged, MILESTONE_ID);
            assert.strictEqual(cell.value, "Creation Week");
            const editTypes = cell.metadata.edits.map((e: any) => e.type);
            assert.ok(
                editTypes.includes(EditType.INITIAL_IMPORT),
                "Anchor edit should remain in history after the rename wins"
            );
            assert.ok(editTypes.includes(EditType.USER_EDIT));
        }
    });
});
