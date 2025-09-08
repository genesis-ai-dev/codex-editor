import * as assert from "assert";
import { resolveCodexCustomMerge } from "../../../src/projectManager/utils/merge/resolvers";

// Load .codex JSON as raw strings via webpack asset/source
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OUR_CONTENT: string = require("../../projectManager/utils/merge/__mocks__/GEN1to20_user1.codex");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const THEIR_CONTENT: string = require("../../projectManager/utils/merge/__mocks__/GEN1to20_user2.codex");

suite("Codex Custom Merge - Edit and Label Conflict Resolution", () => {

    test("merges label edits by most recent timestamp and keeps latest content edit per path", async () => {
        const merged = await resolveCodexCustomMerge(OUR_CONTENT, THEIR_CONTENT);
        const notebook = JSON.parse(merged);

        const cellById = (id: string) => notebook.cells.find((c: any) => c.metadata?.id === id);

        // GEN 1:2 label: should take "second change" (newer label edit from THEIR_CONTENT)
        const gen1v2 = cellById("GEN 1:2");
        assert.ok(gen1v2, "Expected GEN 1:2 to exist in merged notebook");
        assert.strictEqual(gen1v2.metadata.cellLabel, "second change");

        // GEN 1:2 value: should take newer value edit from OUR_CONTENT ("<span>hi there</span>")
        assert.strictEqual(gen1v2.value, "<span>hi there</span>");

        // Edit history should include both label edits and both value edits, deduped and sorted
        const edits = gen1v2.metadata.edits as any[];
        const labelEdits = edits.filter((e) => Array.isArray(e.editMap) && e.editMap.join(".") === "metadata.cellLabel");
        const valueEdits = edits.filter((e) => Array.isArray(e.editMap) && e.editMap.join(".") === "value");
        assert.ok(labelEdits.some((e) => e.value === "first change"), "Should contain 'first change' label edit");
        assert.ok(labelEdits.some((e) => e.value === "second change"), "Should contain 'second change' label edit");
        assert.ok(valueEdits.some((e) => e.value === "<span>gen 2</span>"));
        assert.ok(valueEdits.some((e) => e.value === "<span>gen 2 hi</span>"));
        assert.ok(valueEdits.some((e) => e.value === "<span>this is a test</span>"));
        assert.ok(valueEdits.some((e) => e.value === "<span>hi there</span>"));
    });

    test("preserves identical cells, adds unique cells from both sides, and keeps our-only content", async () => {
        const merged = await resolveCodexCustomMerge(OUR_CONTENT, THEIR_CONTENT);
        const notebook = JSON.parse(merged);
        const cellById = (id: string) => notebook.cells.find((c: any) => c.metadata?.id === id);

        // GEN 1:1 should remain unchanged
        const gen1v1 = cellById("GEN 1:1");
        assert.ok(gen1v1);
        assert.strictEqual(gen1v1.metadata.cellLabel, "1");
        assert.strictEqual(gen1v1.value, "<span>test</span>");

        // Unique cells from THEIR side should be included
        const gen1v3 = cellById("GEN 1:3");
        assert.ok(gen1v3);
        assert.strictEqual(gen1v3.value, "<span>this is a test</span>");

        const gen1v4 = cellById("GEN 1:4");
        assert.ok(gen1v4);
        assert.strictEqual(
            gen1v4.value,
            "<span>Et Dieu, regardant la lumière, vit que c'était bon: et Dieu fit une séparation entre la lumière et l'obscurité,</span>"
        );

        // Our-only content should be preserved
        const gen1v10 = cellById("GEN 1:10");
        assert.ok(gen1v10);
        assert.strictEqual(gen1v10.value, "<span>test from user 1</span>");
    });
});
