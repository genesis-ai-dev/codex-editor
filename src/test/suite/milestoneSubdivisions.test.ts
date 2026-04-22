import * as assert from "assert";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../providers/codexCellEditorProvider/codexDocument";
import { CodexCellTypes } from "../../../types/enums";
import {
    FIRST_SUBDIVISION_KEY,
    findSubdivisionIndexForRoot,
    resolveSubdivisions,
} from "../../providers/codexCellEditorProvider/utils/subdivisionUtils";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
} from "../testUtils";
import sinon from "sinon";

suite("Milestone Subdivisions Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Milestone Subdivisions.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);
        tempUri = await createTempCodexFile(
            `test-subdivisions-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            { cells: [], metadata: {} }
        );

        sinon.restore();
        sinon.stub((CodexCellDocument as any).prototype, "addCellToIndexImmediately").callsFake(() => { });
        sinon.stub((CodexCellDocument as any).prototype, "syncDirtyCellsToDatabase").resolves();
        sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();
    });

    teardown(async () => {
        if (tempUri) await deleteIfExists(tempUri);
        sinon.restore();
    });

    async function createDocumentWithCells(cells: any[]): Promise<CodexCellDocument> {
        const content = {
            cells,
            metadata: {},
        };
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(JSON.stringify(content, null, 2), "utf-8"));
        return await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
    }

    // ---------------------------------------------------------------------------
    // Pure-function tests for resolveSubdivisions
    // ---------------------------------------------------------------------------

    suite("resolveSubdivisions()", () => {
        const ids = (count: number) => Array.from({ length: count }, (_, i) => `c${i + 1}`);

        test("returns empty array when no root cells", () => {
            const result = resolveSubdivisions({
                rootContentCellIds: [],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 0);
        });

        test("produces arithmetic chunks equivalent to legacy pagination when no placements", () => {
            const rootIds = ids(125);
            const result = resolveSubdivisions({ rootContentCellIds: rootIds, cellsPerPage: 50 });

            assert.strictEqual(result.length, 3, "125 cells / 50 per page = 3 pages");
            assert.deepStrictEqual(
                result.map((s) => [s.startRootIndex, s.endRootIndex]),
                [[0, 50], [50, 100], [100, 125]],
                "Legacy-equivalent arithmetic boundaries",
            );
            assert.strictEqual(result[0].source, "auto");
            assert.strictEqual(result[0].key, FIRST_SUBDIVISION_KEY);
            assert.strictEqual(result[1].startCellId, "c51");
        });

        test("single page when count <= pageSize", () => {
            const rootIds = ids(20);
            const result = resolveSubdivisions({ rootContentCellIds: rootIds, cellsPerPage: 50 });
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].endRootIndex, 20);
        });

        test("custom placement creates two subdivisions (break at c6)", () => {
            const rootIds = ids(10);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c6", name: "Second Half" }],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 2);
            assert.deepStrictEqual(
                [result[0].startRootIndex, result[0].endRootIndex],
                [0, 5],
            );
            assert.deepStrictEqual(
                [result[1].startRootIndex, result[1].endRootIndex],
                [5, 10],
            );
            assert.strictEqual(result[1].name, "Second Half");
            assert.strictEqual(result[1].source, "custom");
            assert.strictEqual(result[0].source, "custom", "first subdivision becomes custom once any break is defined");
        });

        test("placements are sorted by root-index regardless of input order", () => {
            const rootIds = ids(10);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [
                    { startCellId: "c8" },
                    { startCellId: "c3" },
                    { startCellId: "c6" },
                ],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 4);
            assert.deepStrictEqual(
                result.map((s) => s.startRootIndex),
                [0, 2, 5, 7],
            );
        });

        test("stale anchors (cells no longer present) are silently pruned", () => {
            const rootIds = ids(5);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [
                    { startCellId: "c3" },
                    { startCellId: "doesNotExist" },
                    { startCellId: "anotherMissing", name: "orphan" },
                ],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 2, "Only the valid placement contributes a break");
            assert.deepStrictEqual(
                [result[0].startRootIndex, result[0].endRootIndex, result[1].startRootIndex, result[1].endRootIndex],
                [0, 2, 2, 5],
            );
        });

        test("duplicate placements targeting the same cell are collapsed", () => {
            const rootIds = ids(6);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [
                    { startCellId: "c4" },
                    { startCellId: "c4", name: "dup" },
                ],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 2);
        });

        test("placement at c1 names the implicit first subdivision rather than creating a new one", () => {
            const rootIds = ids(4);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c1", name: "Intro" }],
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 1, "No actual break, just a name on the first subdivision");
            assert.strictEqual(result[0].name, "Intro");
        });

        test("nameOverrides take precedence over source-stored names", () => {
            const rootIds = ids(4);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c3", name: "Source Name" }],
                nameOverrides: { c3: "Target Override" },
                cellsPerPage: 50,
            });
            assert.strictEqual(result[1].name, "Target Override");
        });

        test("nameOverrides for first subdivision use FIRST_SUBDIVISION_KEY", () => {
            const rootIds = ids(4);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c3" }],
                nameOverrides: { [FIRST_SUBDIVISION_KEY]: "My Start" },
                cellsPerPage: 50,
            });
            assert.strictEqual(result[0].name, "My Start");
        });

        test("findSubdivisionIndexForRoot locates the right subdivision", () => {
            const rootIds = ids(10);
            const subs = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c4" }, { startCellId: "c8" }],
                cellsPerPage: 50,
            });
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 0), 0);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 3), 1);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 7), 2);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 99), -1);
        });
    });

    // ---------------------------------------------------------------------------
    // Document-level integration tests: subdivisions drive slicing APIs
    // ---------------------------------------------------------------------------

    suite("CodexCellDocument slicing with custom subdivisions", () => {
        /** Helper: build a milestone with 10 content cells and optional subdivisions. */
        function buildCellsWithSubdivisions(subdivisions?: Array<{ startCellId: string; name?: string; }>) {
            const cells: any[] = [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "Luke 1",
                    metadata: {
                        type: CodexCellTypes.MILESTONE,
                        id: "milestone-1",
                        ...(subdivisions
                            ? {
                                data: {
                                    subdivisions,
                                },
                            }
                            : {}),
                    },
                },
            ];
            for (let i = 1; i <= 10; i++) {
                cells.push({
                    kind: 2,
                    languageId: "scripture",
                    value: `verse ${i}`,
                    metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                });
            }
            return cells;
        }

        test("buildMilestoneIndex attaches arithmetic subdivisions when none defined", async () => {
            const document = await createDocumentWithCells(buildCellsWithSubdivisions());
            const index = document.buildMilestoneIndex(4);
            const milestone = index.milestones[0];
            assert.ok(milestone.subdivisions, "subdivisions should be present");
            assert.strictEqual(milestone.subdivisions!.length, 3, "10 / 4 pageSize = 3 pages");
            assert.strictEqual(milestone.subdivisions![0].source, "auto");
        });

        test("buildMilestoneIndex uses user-defined subdivisions when present", async () => {
            const cells = buildCellsWithSubdivisions([
                { startCellId: "v4", name: "Middle" },
                { startCellId: "v8", name: "End" },
            ]);
            const document = await createDocumentWithCells(cells);
            const index = document.buildMilestoneIndex(50);
            const milestone = index.milestones[0];
            assert.strictEqual(milestone.subdivisions!.length, 3);
            assert.strictEqual(milestone.subdivisions![0].source, "custom");
            assert.strictEqual(milestone.subdivisions![1].name, "Middle");
            assert.strictEqual(milestone.subdivisions![2].name, "End");
        });

        test("getCellsForMilestone slices by custom subdivision, not cellsPerPage", async () => {
            const cells = buildCellsWithSubdivisions([{ startCellId: "v6" }]);
            const document = await createDocumentWithCells(cells);
            // Request subsection 0 with cellsPerPage=50 (larger than milestone).
            // Without subdivisions this would return all 10 cells; with the break
            // at v6, subsection 0 must contain only v1..v5.
            const sub0 = document.getCellsForMilestone(0, 0, 50);
            assert.strictEqual(sub0.length, 5);
            assert.strictEqual(sub0[0].cellMarkers[0], "v1");
            assert.strictEqual(sub0[4].cellMarkers[0], "v5");

            const sub1 = document.getCellsForMilestone(0, 1, 50);
            assert.strictEqual(sub1.length, 5);
            assert.strictEqual(sub1[0].cellMarkers[0], "v6");
            assert.strictEqual(sub1[4].cellMarkers[0], "v10");
        });

        test("getSubsectionCountForMilestone reflects custom subdivisions", async () => {
            const cells = buildCellsWithSubdivisions([
                { startCellId: "v4" },
                { startCellId: "v8" },
            ]);
            const document = await createDocumentWithCells(cells);
            const count = document.getSubsectionCountForMilestone(0, 50);
            assert.strictEqual(count, 3, "Expected 3 subsections from 2 custom breaks");
        });

        test("findMilestoneAndSubsectionForCell respects custom subdivisions", async () => {
            const cells = buildCellsWithSubdivisions([
                { startCellId: "v4" },
                { startCellId: "v8" },
            ]);
            const document = await createDocumentWithCells(cells);
            const pos1 = document.findMilestoneAndSubsectionForCell("v2");
            assert.deepStrictEqual(pos1, { milestoneIndex: 0, subsectionIndex: 0 });
            const pos2 = document.findMilestoneAndSubsectionForCell("v5");
            assert.deepStrictEqual(pos2, { milestoneIndex: 0, subsectionIndex: 1 });
            const pos3 = document.findMilestoneAndSubsectionForCell("v9");
            assert.deepStrictEqual(pos3, { milestoneIndex: 0, subsectionIndex: 2 });
        });

        test("stale anchor (referencing a cell since removed) is ignored at resolve time", async () => {
            // v4 placement is valid; ghost placement should be silently skipped.
            const cells = buildCellsWithSubdivisions([
                { startCellId: "v4" },
                { startCellId: "ghostCell" },
            ]);
            const document = await createDocumentWithCells(cells);
            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(
                index.milestones[0].subdivisions!.length,
                2,
                "Only the valid anchor should produce a break; ghost pruned",
            );
        });

        test("legacy behavior preserved when no subdivisions on milestone", async () => {
            // Sanity check: 125 cells with cellsPerPage=50 → 3 subsections and each page
            // sized exactly as before the refactor.
            const cells: any[] = [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "Luke 1",
                    metadata: { type: CodexCellTypes.MILESTONE, id: "m1" },
                },
            ];
            for (let i = 1; i <= 125; i++) {
                cells.push({
                    kind: 2,
                    languageId: "scripture",
                    value: `v${i}`,
                    metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                });
            }
            const document = await createDocumentWithCells(cells);
            assert.strictEqual(document.getSubsectionCountForMilestone(0, 50), 3);
            assert.strictEqual(document.getCellsForMilestone(0, 0, 50).length, 50);
            assert.strictEqual(document.getCellsForMilestone(0, 1, 50).length, 50);
            assert.strictEqual(document.getCellsForMilestone(0, 2, 50).length, 25);
        });
    });
});
