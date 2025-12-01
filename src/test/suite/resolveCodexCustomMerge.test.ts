import * as assert from "assert";
import { resolveCodexCustomMerge } from "../../../src/projectManager/utils/merge/resolvers";

// Load .codex JSON as raw strings via webpack asset/source
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OUR_CONTENT: string = require("../../projectManager/utils/merge/__mocks__/GEN1to20_user1.codex");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const THEIR_CONTENT: string = require("../../projectManager/utils/merge/__mocks__/GEN1to20_user2.codex");

/**
 * Helper to create a simple cell structure for testing
 */
function createCell(id: string, value: string = "", type: string = "text") {
    return {
        kind: 2,
        languageId: "html",
        value: `<span>${value}</span>`,
        metadata: {
            type,
            id,
            data: {},
            edits: []
        }
    };
}

/**
 * Helper to create a notebook structure for testing
 */
function createNotebook(cells: any[]) {
    return JSON.stringify({
        cells,
        metadata: {
            id: "TEST",
            originalName: "TEST"
        }
    });
}

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

suite("Codex Custom Merge - Paratextual Cell Position Preservation", () => {

    test("preserves relative position when paratextual cell is added between existing cells", async () => {
        // Our version: has cells 1, 2, 3
        const ourContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        // Their version: has cells 1, PARA-A (paratextual between 1 and 2), 2, 3
        const theirContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("PARA-A", "Section heading", "paratext"),  // New paratextual cell
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        const merged = await resolveCodexCustomMerge(ourContent, theirContent);
        const notebook = JSON.parse(merged);

        // Verify all cells exist
        assert.strictEqual(notebook.cells.length, 4, "Should have 4 cells after merge");

        // Verify the paratextual cell is in the correct position (between CELL-1 and CELL-2)
        const cellIds = notebook.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            cellIds,
            ["CELL-1", "PARA-A", "CELL-2", "CELL-3"],
            "Paratextual cell PARA-A should be positioned between CELL-1 and CELL-2"
        );
    });

    test("preserves position when paratextual cell is added at the beginning", async () => {
        // Our version: has cells 1, 2, 3
        const ourContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        // Their version: has PARA-INTRO at the start, then cells 1, 2, 3
        const theirContent = createNotebook([
            createCell("PARA-INTRO", "Introduction", "paratext"),  // New paratextual cell at start
            createCell("CELL-1", "First verse"),
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        const merged = await resolveCodexCustomMerge(ourContent, theirContent);
        const notebook = JSON.parse(merged);

        // Verify all cells exist
        assert.strictEqual(notebook.cells.length, 4, "Should have 4 cells after merge");

        // Verify the paratextual cell is at the beginning (before CELL-1)
        const cellIds = notebook.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            cellIds,
            ["PARA-INTRO", "CELL-1", "CELL-2", "CELL-3"],
            "Paratextual cell PARA-INTRO should be at the beginning"
        );
    });

    test("preserves position when multiple paratextual cells are added", async () => {
        // Our version: has cells 1, 2, 3, 4
        const ourContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse"),
            createCell("CELL-4", "Fourth verse")
        ]);

        // Their version: has paratextual cells between various verses
        const theirContent = createNotebook([
            createCell("PARA-INTRO", "Book introduction", "paratext"),  // Before CELL-1
            createCell("CELL-1", "First verse"),
            createCell("PARA-CH1", "Chapter 1 heading", "paratext"),    // Between 1 and 2
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse"),
            createCell("PARA-SEC", "Section break", "paratext"),        // Between 3 and 4
            createCell("CELL-4", "Fourth verse")
        ]);

        const merged = await resolveCodexCustomMerge(ourContent, theirContent);
        const notebook = JSON.parse(merged);

        // Verify all cells exist
        assert.strictEqual(notebook.cells.length, 7, "Should have 7 cells after merge");

        // Verify paratextual cells are in their correct positions
        const cellIds = notebook.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            cellIds,
            ["PARA-INTRO", "CELL-1", "PARA-CH1", "CELL-2", "CELL-3", "PARA-SEC", "CELL-4"],
            "All paratextual cells should be in their correct relative positions"
        );
    });

    test("handles paratextual cell position when previous neighbor is missing in our version", async () => {
        // Our version: has cells 2, 3 (missing cell 1)
        const ourContent = createNotebook([
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        // Their version: has cells 1, PARA-A, 2, 3
        const theirContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("PARA-A", "Section heading", "paratext"),  // Between 1 and 2
            createCell("CELL-2", "Second verse"),
            createCell("CELL-3", "Third verse")
        ]);

        const merged = await resolveCodexCustomMerge(ourContent, theirContent);
        const notebook = JSON.parse(merged);

        // Both CELL-1 and PARA-A should be added
        // PARA-A should use its next neighbor (CELL-2) to position itself before CELL-2
        const cellIds = notebook.cells.map((c: any) => c.metadata?.id);

        // CELL-1 should be positioned (its next neighbor is PARA-A, which isn't in results yet, 
        // but PARA-A's next neighbor is CELL-2 which IS in results)
        // The order should be: CELL-1, PARA-A, CELL-2, CELL-3
        assert.ok(cellIds.includes("CELL-1"), "CELL-1 should be included");
        assert.ok(cellIds.includes("PARA-A"), "PARA-A should be included");

        // Verify PARA-A comes before CELL-2
        const paraIndex = cellIds.indexOf("PARA-A");
        const cell2Index = cellIds.indexOf("CELL-2");
        assert.ok(paraIndex < cell2Index, "PARA-A should come before CELL-2");
    });

    test("preserves position with consecutive paratextual cells", async () => {
        // Our version: has cells 1, 2
        const ourContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("CELL-2", "Second verse")
        ]);

        // Their version: has two consecutive paratextual cells between 1 and 2
        const theirContent = createNotebook([
            createCell("CELL-1", "First verse"),
            createCell("PARA-A", "First section", "paratext"),
            createCell("PARA-B", "Second section", "paratext"),  // Consecutive with PARA-A
            createCell("CELL-2", "Second verse")
        ]);

        const merged = await resolveCodexCustomMerge(ourContent, theirContent);
        const notebook = JSON.parse(merged);

        // Verify all cells exist
        assert.strictEqual(notebook.cells.length, 4, "Should have 4 cells after merge");

        // Verify both paratextual cells are between CELL-1 and CELL-2, in correct order
        const cellIds = notebook.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            cellIds,
            ["CELL-1", "PARA-A", "PARA-B", "CELL-2"],
            "Both consecutive paratextual cells should be in order between CELL-1 and CELL-2"
        );
    });
});
