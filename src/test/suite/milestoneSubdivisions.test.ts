import * as assert from "assert";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../providers/codexCellEditorProvider/codexDocument";
import { CodexCellTypes } from "../../../types/enums";
import {
    FIRST_SUBDIVISION_KEY,
    findSubdivisionIndexForRoot,
    mergePlacementsForRemovedMilestone,
    resolveSubdivisions,
    splitPlacementsAtAnchor,
} from "../../providers/codexCellEditorProvider/utils/subdivisionUtils";
import { __testOnlyMessageHandlers } from "../../providers/codexCellEditorProvider/codexCellEditorMessagehandling";
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
        const ids = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`);

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
            assert.strictEqual(result[1].startCellId, "c50");
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
                [0, 6],
            );
            assert.deepStrictEqual(
                [result[1].startRootIndex, result[1].endRootIndex],
                [6, 10],
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
                [0, 3, 6, 8],
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
                [0, 3, 3, 5],
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

        test("placement at c0 names the implicit first subdivision rather than creating a new one", () => {
            const rootIds = ids(4);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c0", name: "Intro" }],
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
                placements: [{ startCellId: "c3" }, { startCellId: "c7" }],
                cellsPerPage: 50,
            });
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 0), 0);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 3), 1);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 7), 2);
            assert.strictEqual(findSubdivisionIndexForRoot(subs, 99), -1);
        });

        // -------------------------------------------------------------------
        // Adaptive chunking: long stretches between user breaks get sub-paged
        // -------------------------------------------------------------------

        test("user break inside a long milestone still triggers per-page sub-chunking", () => {
            // 700 roots, cellsPerPage=50, one custom break at root 432 (cell c432).
            // Expected: [0,50), [50,100)…[400,432), then [432,482)…[682,700).
            const rootIds = ids(700);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c432" }],
                cellsPerPage: 50,
            });
            // Exactly one stretch boundary was added by the user, so the only "custom"
            // entries should be the implicit-first stretch (now custom because a break
            // exists) and the c432 anchor itself. Everything else is auto-derived.
            const customStarts = result.filter((s) => s.source === "custom").map((s) => s.startRootIndex);
            assert.deepStrictEqual(customStarts, [0, 432]);
            // Sanity-check the boundaries on either side of the user break.
            const indexAtBreak = result.findIndex((s) => s.startRootIndex === 432);
            assert.notStrictEqual(indexAtBreak, -1, "expected a subdivision starting at root 432");
            const beforeBreak = result[indexAtBreak - 1];
            assert.strictEqual(beforeBreak.endRootIndex, 432, "stretch ending at the user break should not bleed past it");
            assert.strictEqual(beforeBreak.startRootIndex, 400, "auto chunks should respect cellsPerPage=50");
            // The trailing stretch should be paged from 432 in 50-cell increments.
            const afterStarts = result
                .slice(indexAtBreak)
                .map((s) => s.startRootIndex);
            assert.deepStrictEqual(
                afterStarts.slice(0, 4),
                [432, 482, 532, 582],
                "trailing stretch should be sub-chunked starting at the user break"
            );
            // And the very last subdivision should end at the milestone boundary, not past it.
            assert.strictEqual(result[result.length - 1].endRootIndex, 700);
        });

        test("maxSubdivisionLength preserves stretches shorter than the threshold", () => {
            // 200 roots, custom breaks at 70 and 173. cellsPerPage=70, threshold=120.
            // Expected stretches: [0,70) len 70 → kept; [70,173) len 103 → kept (under 120);
            // [173,200) len 27 → kept. So three subdivisions, all "custom" anchors.
            const rootIds = ids(200);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c70" }, { startCellId: "c173" }],
                cellsPerPage: 70,
                maxSubdivisionLength: 120,
            });
            assert.strictEqual(result.length, 3);
            assert.deepStrictEqual(
                result.map((s) => [s.startRootIndex, s.endRootIndex]),
                [[0, 70], [70, 173], [173, 200]]
            );
            // All three are user-defined origins, so they should all be "custom".
            assert.deepStrictEqual(result.map((s) => s.source), ["custom", "custom", "custom"]);
        });

        test("maxSubdivisionLength still sub-chunks stretches that exceed it", () => {
            // 300 roots, no custom breaks, cellsPerPage=50, threshold=120.
            // 300 > 120 so we should sub-chunk into 50-cell pages.
            const rootIds = ids(300);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                cellsPerPage: 50,
                maxSubdivisionLength: 120,
            });
            assert.strictEqual(result.length, 6);
            assert.deepStrictEqual(
                result.map((s) => s.startRootIndex),
                [0, 50, 100, 150, 200, 250]
            );
        });

        // -------------------------------------------------------------------
        // Source-name fallback: target inherits source's labels by default
        // -------------------------------------------------------------------

        test("fallbackNameOverrides supplies names when local override is missing", () => {
            const rootIds = ids(20);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c10" }],
                fallbackNameOverrides: {
                    [FIRST_SUBDIVISION_KEY]: "Source Intro",
                    c10: "Source Conclusion",
                },
                cellsPerPage: 50,
            });
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].name, "Source Intro");
            assert.strictEqual(result[1].name, "Source Conclusion");
        });

        test("local nameOverrides win over fallbackNameOverrides", () => {
            const rootIds = ids(20);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c10" }],
                nameOverrides: { c10: "Target Conclusion" },
                fallbackNameOverrides: {
                    [FIRST_SUBDIVISION_KEY]: "Source Intro",
                    c10: "Source Conclusion",
                },
                cellsPerPage: 50,
            });
            // First subdivision: no local override → falls back to source.
            assert.strictEqual(result[0].name, "Source Intro");
            // Second subdivision: local wins.
            assert.strictEqual(result[1].name, "Target Conclusion");
        });

        test("empty-string local override does NOT mask source fallback", () => {
            // Important contract: clearing a name on the target should re-expose
            // the inherited source name, not display "" / a numeric fallback.
            const rootIds = ids(20);
            const result = resolveSubdivisions({
                rootContentCellIds: rootIds,
                placements: [{ startCellId: "c10" }],
                nameOverrides: { c10: "" },
                fallbackNameOverrides: { c10: "Source Conclusion" },
                cellsPerPage: 50,
            });
            assert.strictEqual(result[1].name, "Source Conclusion");
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

        test("getRootContentCellIdsForMilestone returns all root content cells in order", async () => {
            const cells = buildCellsWithSubdivisions();
            const document = await createDocumentWithCells(cells);
            const rootIds = document.getRootContentCellIdsForMilestone(0);
            assert.deepStrictEqual(
                rootIds,
                ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"],
            );
        });

        test("getRootContentCellIdsForMilestone excludes paratext, deleted, and child cells", async () => {
            const cells: any[] = [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "Luke 1",
                    metadata: { type: CodexCellTypes.MILESTONE, id: "m1" },
                },
                { kind: 2, languageId: "scripture", value: "v1", metadata: { type: CodexCellTypes.TEXT, id: "v1" } },
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "v1-child",
                    metadata: { type: CodexCellTypes.TEXT, id: "v1c", parentId: "v1" },
                },
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "paratext",
                    metadata: { type: CodexCellTypes.PARATEXT, id: "p1" },
                },
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "deleted",
                    metadata: { type: CodexCellTypes.TEXT, id: "d1", data: { deleted: true } },
                },
                { kind: 2, languageId: "scripture", value: "v2", metadata: { type: CodexCellTypes.TEXT, id: "v2" } },
            ];
            const document = await createDocumentWithCells(cells);
            const rootIds = document.getRootContentCellIdsForMilestone(0);
            assert.deepStrictEqual(rootIds, ["v1", "v2"]);
        });

        test("updateCellData('subdivisions') invalidates pagination cache", async () => {
            const document = await createDocumentWithCells(buildCellsWithSubdivisions());

            // First read: no custom breaks → arithmetic
            const before = document.buildMilestoneIndex(50);
            assert.strictEqual(before.milestones[0].subdivisions!.length, 1);

            // Update subdivisions via the same path the message handler uses.
            document.updateCellData("milestone-1", {
                subdivisions: [{ startCellId: "v6" }],
            });

            const after = document.buildMilestoneIndex(50);
            assert.strictEqual(
                after.milestones[0].subdivisions!.length,
                2,
                "New subdivisions must be reflected after updateCellData",
            );
            assert.strictEqual(after.milestones[0].subdivisions![1].startCellId, "v6");
        });

        test("updateCellData('subdivisionNames') picks up name overrides", async () => {
            const cells = buildCellsWithSubdivisions([{ startCellId: "v6" }]);
            const document = await createDocumentWithCells(cells);

            document.updateCellData("milestone-1", {
                subdivisionNames: {
                    [FIRST_SUBDIVISION_KEY]: "Opening",
                    v6: "Later Half",
                },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones[0].subdivisions![0].name, "Opening");
            assert.strictEqual(index.milestones[0].subdivisions![1].name, "Later Half");
        });

        test("empty subdivisions array restores arithmetic pagination", async () => {
            const cells = buildCellsWithSubdivisions([{ startCellId: "v6" }]);
            const document = await createDocumentWithCells(cells);

            // Sanity: starts custom
            let index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones[0].subdivisions![0].source, "custom");

            document.updateCellData("milestone-1", { subdivisions: [] });
            index = document.buildMilestoneIndex(50);
            assert.strictEqual(
                index.milestones[0].subdivisions![0].source,
                "auto",
                "Clearing placements should fall back to arithmetic pagination",
            );
        });

        // -----------------------------------------------------------------
        // addMilestoneSubdivisionAnchor handler — resolves cellNumber → cellId
        // server-side and delegates to the shared commit pipeline.
        // -----------------------------------------------------------------
        suite("addMilestoneSubdivisionAnchor handler", () => {
            /**
             * Mint a fake source URI so the handler's `isSourceFileFlexible`
             * check passes without us needing to actually back the document
             * with a .bible or .source file on disk.
             */
            function stampSourceUri(document: CodexCellDocument) {
                // `uri` is a plain public field (see CodexCellDocument),
                // so a direct assignment is enough to override it.
                (document as any).uri = vscode.Uri.parse("file:///test.source");
            }

            /**
             * Stubs the provider touch-points the shared commit helper uses so
             * the handler can run without a real webview round-trip:
             *  - `saveCustomDocument` becomes a no-op (we assert in-memory only)
             *  - `getPairedNotebookUri` returns null (no mirror step)
             *  - `refreshWebview` is swallowed
             *  - `currentMilestoneSubsectionMap` is empty, taking the simple
             *    refresh path in `sendMilestoneRefreshToWebview`.
             */
            function stubProviderForHandlerTest(p: CodexCellEditorProvider) {
                sinon.stub(p, "saveCustomDocument").resolves();
                sinon.stub(p, "getPairedNotebookUri").returns(null);
                sinon.stub(p, "refreshWebview").resolves();
                (p as any).currentMilestoneSubsectionMap = new Map();
                // Author hook is a no-op for the integration path.
                sinon.stub(CodexCellDocument.prototype as any, "refreshAuthor").resolves();
            }

            async function invokeAddAnchor({
                document,
                milestoneIndex,
                cellNumber,
            }: {
                document: CodexCellDocument;
                milestoneIndex: number;
                cellNumber: number;
            }): Promise<void> {
                const handler = __testOnlyMessageHandlers["addMilestoneSubdivisionAnchor"];
                assert.ok(handler, "addMilestoneSubdivisionAnchor handler must be registered");
                await handler({
                    event: {
                        command: "addMilestoneSubdivisionAnchor",
                        content: { milestoneIndex, cellNumber },
                    } as any,
                    document,
                    webviewPanel: {} as any,
                    provider,
                    updateWebview: () => { /* no-op */ },
                });
            }

            test("adds a new anchor at the Nth root cell", async () => {
                const cells = buildCellsWithSubdivisions();
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 6 });

                // The 6th root cell is v6 (array positions 0..9 → cell ids v1..v10).
                const index = document.buildMilestoneIndex(50);
                const subs = index.milestones[0].subdivisions ?? [];
                assert.strictEqual(subs.length, 2, "Expected exactly one new break → two subsections");
                assert.strictEqual(subs[1].startCellId, "v6");
                assert.strictEqual(subs[1].source, "custom");
            });

            test("appends anchor to existing placements (preserves source names)", async () => {
                const cells = buildCellsWithSubdivisions([
                    { startCellId: "v4", name: "Middle" },
                ]);
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 8 });

                const index = document.buildMilestoneIndex(50);
                const subs = index.milestones[0].subdivisions ?? [];
                // Expect 3 subsections: v1..v3, v4..v7, v8..v10.
                assert.strictEqual(subs.length, 3);
                assert.strictEqual(subs[1].startCellId, "v4");
                assert.strictEqual(subs[1].name, "Middle", "Existing source-side name is preserved");
                assert.strictEqual(subs[2].startCellId, "v8");
                assert.strictEqual(subs[2].source, "custom");
            });

            test("cellNumber at the first cell is rejected (no-op)", async () => {
                const cells = buildCellsWithSubdivisions();
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 1 });

                const index = document.buildMilestoneIndex(50);
                const subs = index.milestones[0].subdivisions ?? [];
                // No breaks added — still the lone auto subdivision.
                assert.strictEqual(subs.length, 1);
                assert.strictEqual(subs[0].source, "auto");
            });

            test("cellNumber beyond last cell is rejected", async () => {
                const cells = buildCellsWithSubdivisions();
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 99 });

                const index = document.buildMilestoneIndex(50);
                const subs = index.milestones[0].subdivisions ?? [];
                assert.strictEqual(subs.length, 1, "Out-of-range cellNumber must not produce a break");
            });

            test("idempotent: re-adding the same anchor does not duplicate", async () => {
                const cells = buildCellsWithSubdivisions([{ startCellId: "v6" }]);
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                // v6 is already the 6th root cell; adding again should no-op.
                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 6 });

                const index = document.buildMilestoneIndex(50);
                const subs = index.milestones[0].subdivisions ?? [];
                assert.strictEqual(subs.length, 2, "Anchor set must remain the same size");
                const anchors = subs
                    .filter((s) => s.source === "custom" && s.index > 0)
                    .map((s) => s.startCellId);
                assert.deepStrictEqual(anchors, ["v6"]);
            });

            test("rejects writes from non-source documents", async () => {
                const cells = buildCellsWithSubdivisions();
                const document = await createDocumentWithCells(cells);
                // Leave URI pointing at the temp .codex file → should be rejected.
                stubProviderForHandlerTest(provider);
                const warnStub = sinon.stub(vscode.window, "showWarningMessage");

                await invokeAddAnchor({ document, milestoneIndex: 0, cellNumber: 5 });

                assert.strictEqual(
                    warnStub.calledWith(
                        "Subdivision breaks can only be added from the source file."
                    ),
                    true,
                    "Non-source writes must surface a warning"
                );
                const index = document.buildMilestoneIndex(50);
                assert.strictEqual(
                    index.milestones[0].subdivisions?.length ?? 0,
                    1,
                    "Non-source writes must not mutate the document"
                );
            });
        });

        // -----------------------------------------------------------------
        // updateMilestoneSubdivisionName handler — auto-chunk promotion
        // -----------------------------------------------------------------
        //
        // Naming an auto-generated break (on the source side) is treated as
        // the translator committing to that break: it gets promoted from a
        // derived arithmetic chunk to a persistent placement so downstream
        // changes to `cellsPerPage` / `maxSubdivisionLength` don't displace
        // or orphan the name.
        suite("updateMilestoneSubdivisionName handler promotes auto-chunks", () => {
            function stampSourceUri(document: CodexCellDocument) {
                (document as any).uri = vscode.Uri.parse("file:///test.source");
            }

            function stubProviderForHandlerTest(p: CodexCellEditorProvider) {
                sinon.stub(p, "saveCustomDocument").resolves();
                sinon.stub(p, "getPairedNotebookUri").returns(null);
                sinon.stub(p, "refreshWebview").resolves();
                (p as any).currentMilestoneSubsectionMap = new Map();
                sinon.stub(CodexCellDocument.prototype as any, "refreshAuthor").resolves();
            }

            async function invokeRename({
                document,
                milestoneIndex,
                subdivisionKey,
                newName,
            }: {
                document: CodexCellDocument;
                milestoneIndex: number;
                subdivisionKey: string;
                newName: string;
            }): Promise<void> {
                const handler = __testOnlyMessageHandlers["updateMilestoneSubdivisionName"];
                assert.ok(handler, "updateMilestoneSubdivisionName handler must be registered");
                await handler({
                    event: {
                        command: "updateMilestoneSubdivisionName",
                        content: { milestoneIndex, subdivisionKey, newName },
                    } as any,
                    document,
                    webviewPanel: {} as any,
                    provider,
                    updateWebview: () => { /* no-op */ },
                });
            }

            /** Builds a milestone with `rootCount` content cells + no placements. */
            function buildLargeMilestone(rootCount: number) {
                const cells: any[] = [
                    {
                        kind: 2,
                        languageId: "scripture",
                        value: "Luke 1",
                        metadata: { type: CodexCellTypes.MILESTONE, id: "m1" },
                    },
                ];
                for (let i = 1; i <= rootCount; i++) {
                    cells.push({
                        kind: 2,
                        languageId: "scripture",
                        value: `v${i}`,
                        metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                    });
                }
                return cells;
            }

            test("naming an auto-chunk adds a persistent placement", async () => {
                // 150 cells, cellsPerPage=50 → auto chunks at v1, v51, v101.
                // Naming the v51 chunk should promote it to a real placement.
                const document = await createDocumentWithCells(buildLargeMilestone(150));
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: "v51",
                    newName: "Section B",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                    subdivisionNames?: { [k: string]: string; };
                };
                assert.deepStrictEqual(
                    data.subdivisions,
                    [{ startCellId: "v51", name: "Section B" }],
                    "Renaming v51 should promote it into subdivisions[]"
                );
                assert.strictEqual(
                    data.subdivisionNames?.["v51"],
                    "Section B",
                    "The subdivisionNames override should track in parallel"
                );
            });

            test("renaming an already-placed anchor syncs name on the placement", async () => {
                // Start with a placement that has no name, then rename it.
                const cells: any[] = [
                    {
                        kind: 2,
                        languageId: "scripture",
                        value: "Luke 1",
                        metadata: {
                            type: CodexCellTypes.MILESTONE,
                            id: "m1",
                            data: { subdivisions: [{ startCellId: "v5" }] },
                        },
                    },
                ];
                for (let i = 1; i <= 10; i++) {
                    cells.push({
                        kind: 2,
                        languageId: "scripture",
                        value: `v${i}`,
                        metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                    });
                }
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: "v5",
                    newName: "Second Half",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                };
                assert.deepStrictEqual(
                    data.subdivisions,
                    [{ startCellId: "v5", name: "Second Half" }],
                    "Existing placement should have its name updated"
                );
            });

            test("clearing a name leaves the placement intact (demotion not implied)", async () => {
                // Pre-promote v5 with a name, then clear it. Placement should
                // remain so the user still sees a break there; only the name
                // is removed.
                const cells: any[] = [
                    {
                        kind: 2,
                        languageId: "scripture",
                        value: "Luke 1",
                        metadata: {
                            type: CodexCellTypes.MILESTONE,
                            id: "m1",
                            data: {
                                subdivisions: [{ startCellId: "v5", name: "Named" }],
                                subdivisionNames: { v5: "Named" },
                            },
                        },
                    },
                ];
                for (let i = 1; i <= 10; i++) {
                    cells.push({
                        kind: 2,
                        languageId: "scripture",
                        value: `v${i}`,
                        metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                    });
                }
                const document = await createDocumentWithCells(cells);
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: "v5",
                    newName: "",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                    subdivisionNames?: { [k: string]: string; };
                };
                assert.deepStrictEqual(
                    data.subdivisions,
                    [{ startCellId: "v5" }],
                    "Placement should remain; only the name is cleared"
                );
                assert.strictEqual(
                    data.subdivisionNames?.["v5"],
                    undefined,
                    "The override map should no longer carry this key"
                );
            });

            test("naming the implicit first subdivision does NOT create a placement", async () => {
                const document = await createDocumentWithCells(buildLargeMilestone(10));
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: FIRST_SUBDIVISION_KEY,
                    newName: "Intro",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                    subdivisionNames?: { [k: string]: string; };
                };
                assert.ok(
                    !data.subdivisions || data.subdivisions.length === 0,
                    "First subdivision has no placement; must not be promoted"
                );
                assert.strictEqual(data.subdivisionNames?.[FIRST_SUBDIVISION_KEY], "Intro");
            });

            test("clearing a name on an unplaced auto-chunk does not create a placement", async () => {
                // Edge: user opens the rename field, types nothing, then
                // blurs. We should not invent a placement just because they
                // touched the control.
                const document = await createDocumentWithCells(buildLargeMilestone(150));
                stampSourceUri(document);
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: "v51",
                    newName: "",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                };
                assert.ok(
                    !data.subdivisions || data.subdivisions.length === 0,
                    "Empty rename on an auto-chunk must not promote it"
                );
            });

            test("target-side rename never adds a placement", async () => {
                // Target docs are pointed at .codex (not .source), so the
                // handler's promotion branch must not run. Verify by leaving
                // the temp .codex URI in place.
                const document = await createDocumentWithCells(buildLargeMilestone(150));
                // Intentionally skip stampSourceUri.
                stubProviderForHandlerTest(provider);

                await invokeRename({
                    document,
                    milestoneIndex: 0,
                    subdivisionKey: "v51",
                    newName: "Target Name",
                });

                const milestoneCell = document.getCellByIndex(0);
                const data = milestoneCell?.metadata?.data as {
                    subdivisions?: { startCellId: string; name?: string; }[];
                    subdivisionNames?: { [k: string]: string; };
                };
                assert.ok(
                    !data.subdivisions || data.subdivisions.length === 0,
                    "Target-side renames must not introduce placements (source-authoritative)"
                );
                assert.strictEqual(
                    data.subdivisionNames?.["v51"],
                    "Target Name",
                    "Target rename still lands in local subdivisionNames override"
                );
            });
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

    // ---------------------------------------------------------------------------
    // Pure-function tests for the milestone-placement edit redistribution helpers
    // ---------------------------------------------------------------------------

    suite("splitPlacementsAtAnchor()", () => {
        const rootIds = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"];

        test("partitions placements strictly before / after the anchor", () => {
            const result = splitPlacementsAtAnchor(
                [
                    { startCellId: "v3", name: "Pre" },
                    { startCellId: "v8", name: "Post" },
                ],
                rootIds,
                "v6"
            );
            assert.deepStrictEqual(result.before, [{ startCellId: "v3", name: "Pre" }]);
            assert.deepStrictEqual(result.after, [{ startCellId: "v8", name: "Post" }]);
            assert.strictEqual(result.boundaryName, undefined);
        });

        test("placement at the anchor surfaces as boundaryName, not as a placement", () => {
            const result = splitPlacementsAtAnchor(
                [
                    { startCellId: "v3" },
                    { startCellId: "v6", name: "Mid Section" },
                    { startCellId: "v9" },
                ],
                rootIds,
                "v6"
            );
            assert.deepStrictEqual(result.before, [{ startCellId: "v3" }]);
            assert.deepStrictEqual(result.after, [{ startCellId: "v9" }]);
            assert.strictEqual(result.boundaryName, "Mid Section");
        });

        test("stale anchors are silently dropped", () => {
            const result = splitPlacementsAtAnchor(
                [
                    { startCellId: "v3" },
                    { startCellId: "ghost" },
                    { startCellId: "v8" },
                ],
                rootIds,
                "v6"
            );
            assert.strictEqual(result.before.length, 1);
            assert.strictEqual(result.after.length, 1);
        });

        test("anchor at index 0 returns input unchanged in `before`", () => {
            const result = splitPlacementsAtAnchor(
                [{ startCellId: "v3" }],
                rootIds,
                "v1"
            );
            assert.deepStrictEqual(result.before, [{ startCellId: "v3" }]);
            assert.strictEqual(result.after.length, 0);
        });

        test("anchor not in rootIds returns empty result", () => {
            const result = splitPlacementsAtAnchor(
                [{ startCellId: "v3" }],
                rootIds,
                "ghost"
            );
            assert.deepStrictEqual(result, {
                before: [{ startCellId: "v3" }],
                after: [],
            });
        });

        test("undefined placements yield empty partitions", () => {
            const result = splitPlacementsAtAnchor(undefined, rootIds, "v5");
            assert.deepStrictEqual(result.before, []);
            assert.deepStrictEqual(result.after, []);
        });

        test("duplicate placements are deduped (first wins)", () => {
            const result = splitPlacementsAtAnchor(
                [
                    { startCellId: "v3", name: "First" },
                    { startCellId: "v3", name: "Second" },
                    { startCellId: "v8" },
                ],
                rootIds,
                "v6"
            );
            assert.strictEqual(result.before.length, 1);
            assert.strictEqual(result.before[0].name, "First");
        });
    });

    suite("mergePlacementsForRemovedMilestone()", () => {
        test("preserveBoundary=true stamps boundary placement with the milestone label", () => {
            const result = mergePlacementsForRemovedMilestone({
                prevPlacements: [{ startCellId: "v3" }],
                removedPlacements: [{ startCellId: "v9" }],
                boundaryAnchorCellId: "v7",
                boundaryName: "Luke 2",
                preserveBoundary: true,
            });
            assert.deepStrictEqual(result.placements, [
                { startCellId: "v3" },
                { startCellId: "v7", name: "Luke 2" },
                { startCellId: "v9" },
            ]);
        });

        test("preserveBoundary=false omits the boundary placement entirely", () => {
            const result = mergePlacementsForRemovedMilestone({
                prevPlacements: [{ startCellId: "v3" }],
                removedPlacements: [{ startCellId: "v9", name: "Tail" }],
                boundaryAnchorCellId: "v7",
                boundaryName: "Luke 2",
                preserveBoundary: false,
            });
            assert.deepStrictEqual(result.placements, [
                { startCellId: "v3" },
                { startCellId: "v9", name: "Tail" },
            ]);
        });

        test("removed-side name on boundary cell wins over preserveBoundary's milestone label", () => {
            // When the demoted milestone already had an explicit name on its
            // own first cell (in `subdivisions[]`), that name takes precedence
            // because it's more specific than the milestone label.
            const result = mergePlacementsForRemovedMilestone({
                prevPlacements: [],
                removedPlacements: [
                    { startCellId: "v7", name: "Specific Name" },
                ],
                boundaryAnchorCellId: "v7",
                boundaryName: "Luke 2",
                preserveBoundary: true,
            });
            assert.strictEqual(result.placements.length, 1);
            assert.strictEqual(result.placements[0].name, "Specific Name");
        });

        test("dedupes by startCellId across both sources", () => {
            const result = mergePlacementsForRemovedMilestone({
                prevPlacements: [{ startCellId: "v3", name: "A" }],
                removedPlacements: [{ startCellId: "v3", name: "B" }],
                boundaryAnchorCellId: "v7",
                preserveBoundary: false,
            });
            assert.strictEqual(result.placements.length, 1);
            assert.strictEqual(result.placements[0].name, "B", "removed-side overwrites prev for same key");
        });
    });

    // ---------------------------------------------------------------------------
    // Handler integration tests for the milestone-placement edit pipeline.
    // ---------------------------------------------------------------------------

    suite("Milestone placement edit handlers", () => {
        function stampSourceUri(document: CodexCellDocument) {
            (document as any).uri = vscode.Uri.parse("file:///test.source");
        }

        function stubProviderForHandlerTest(p: CodexCellEditorProvider) {
            sinon.stub(p, "saveCustomDocument").resolves();
            sinon.stub(p, "getPairedNotebookUri").returns(null);
            sinon.stub(p, "refreshWebview").resolves();
            (p as any).currentMilestoneSubsectionMap = new Map();
            sinon.stub(CodexCellDocument.prototype as any, "refreshAuthor").resolves();
            // Avoid SQLite-mirror writes during structural-edit tests; the
            // milestone-index reflush isn't observable in the in-memory
            // assertions below and the stubs above already disable database
            // I/O.
            sinon.stub(
                CodexCellDocument.prototype as any,
                "updateCellMilestoneIndices"
            ).resolves();
        }

        /** Builds a single-milestone document with N text cells (v1..vN). */
        function buildMilestoneWithRoots(rootCount: number, milestoneId = "m1", milestoneValue = "Luke 1") {
            const cells: any[] = [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: milestoneValue,
                    metadata: { type: CodexCellTypes.MILESTONE, id: milestoneId },
                },
            ];
            for (let i = 1; i <= rootCount; i++) {
                cells.push({
                    kind: 2,
                    languageId: "scripture",
                    value: `verse ${i}`,
                    metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                });
            }
            return cells;
        }

        /** Builds a doc with two milestones, each with their own root cells. */
        function buildTwoMilestoneDoc() {
            const cells: any[] = [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "Luke 1",
                    metadata: { type: CodexCellTypes.MILESTONE, id: "m1" },
                },
            ];
            for (let i = 1; i <= 5; i++) {
                cells.push({
                    kind: 2,
                    languageId: "scripture",
                    value: `verse ${i}`,
                    metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                });
            }
            cells.push({
                kind: 2,
                languageId: "scripture",
                value: "Luke 2",
                metadata: { type: CodexCellTypes.MILESTONE, id: "m2" },
            });
            for (let i = 6; i <= 10; i++) {
                cells.push({
                    kind: 2,
                    languageId: "scripture",
                    value: `verse ${i}`,
                    metadata: { type: CodexCellTypes.TEXT, id: `v${i}` },
                });
            }
            return cells;
        }

        async function invokeHandler(
            handlerName: string,
            { document, content }: { document: CodexCellDocument; content: any; }
        ): Promise<void> {
            const handler = __testOnlyMessageHandlers[handlerName];
            assert.ok(handler, `${handlerName} handler must be registered`);
            await handler({
                event: { command: handlerName, content } as any,
                document,
                webviewPanel: {} as any,
                provider,
                updateWebview: () => { /* no-op */ },
            });
        }

        test("addMilestoneAtCell inserts a milestone and partitions placements", async () => {
            const cells = buildMilestoneWithRoots(10);
            // Pre-existing custom subdivisions: one before the new boundary
            // (should stay on the original) and one after (should travel).
            cells[0].metadata.data = {
                subdivisions: [
                    { startCellId: "v3", name: "Early" },
                    { startCellId: "v8", name: "Late" },
                ],
            };
            const document = await createDocumentWithCells(cells);
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("addMilestoneAtCell", {
                document,
                content: { milestoneIndex: 0, cellNumber: 6 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2, "Should now have two milestones");
            // Original milestone: only v1..v5, with v3 placement preserved
            assert.deepStrictEqual(
                document.getRootContentCellIdsForMilestone(0),
                ["v1", "v2", "v3", "v4", "v5"]
            );
            const original = document.getCellByIndex(index.milestones[0].cellIndex);
            const originalData = original?.metadata?.data as any;
            assert.deepStrictEqual(
                originalData?.subdivisions,
                [{ startCellId: "v3", name: "Early" }]
            );
            // New milestone: v6..v10, with v8 placement preserved
            assert.deepStrictEqual(
                document.getRootContentCellIdsForMilestone(1),
                ["v6", "v7", "v8", "v9", "v10"]
            );
            const inserted = document.getCellByIndex(index.milestones[1].cellIndex);
            const insertedData = inserted?.metadata?.data as any;
            assert.deepStrictEqual(
                insertedData?.subdivisions,
                [{ startCellId: "v8", name: "Late" }]
            );
            assert.strictEqual(
                inserted?.metadata?.type,
                CodexCellTypes.MILESTONE
            );
        });

        test("addMilestoneAtCell rejects cellNumber < 2 as a no-op", async () => {
            const document = await createDocumentWithCells(buildMilestoneWithRoots(10));
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);
            sinon.stub(vscode.window, "showWarningMessage");

            await invokeHandler("addMilestoneAtCell", {
                document,
                content: { milestoneIndex: 0, cellNumber: 1 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 1, "No new milestone should be created");
        });

        test("addMilestoneAtCell rejects writes from non-source documents", async () => {
            const document = await createDocumentWithCells(buildMilestoneWithRoots(10));
            // Leave URI as the temp .codex file → handler must reject.
            stubProviderForHandlerTest(provider);
            const warnStub = sinon.stub(vscode.window, "showWarningMessage");

            await invokeHandler("addMilestoneAtCell", {
                document,
                content: { milestoneIndex: 0, cellNumber: 6 },
            });

            assert.strictEqual(warnStub.called, true, "Should surface a warning on target write");
            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 1, "Document must not be mutated");
        });

        test("promoteSubdivisionToMilestone uses the subdivision's name as the new milestone label", async () => {
            const cells = buildMilestoneWithRoots(10);
            cells[0].metadata.data = {
                subdivisions: [{ startCellId: "v6", name: "Section B" }],
            };
            const document = await createDocumentWithCells(cells);
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("promoteSubdivisionToMilestone", {
                document,
                content: { milestoneIndex: 0, subdivisionKey: "v6" },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2);
            const inserted = document.getCellByIndex(index.milestones[1].cellIndex);
            assert.strictEqual(inserted?.value, "Section B", "Promoted milestone takes the subdivision's name");
            // The promoted placement should NOT remain on the original
            // milestone — it has been promoted.
            const original = document.getCellByIndex(index.milestones[0].cellIndex);
            const originalData = original?.metadata?.data as any;
            assert.ok(
                !originalData?.subdivisions || originalData.subdivisions.length === 0,
                "Promoted placement should be removed from the original milestone"
            );
        });

        test("promoteSubdivisionToMilestone refuses the implicit first subdivision", async () => {
            const document = await createDocumentWithCells(buildMilestoneWithRoots(10));
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);
            sinon.stub(vscode.window, "showWarningMessage");

            await invokeHandler("promoteSubdivisionToMilestone", {
                document,
                content: {
                    milestoneIndex: 0,
                    subdivisionKey: FIRST_SUBDIVISION_KEY,
                },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 1, "First subdivision is unpromotable");
        });

        test("promoteSubdivisionToMilestone falls back to 'New milestone' when the subdivision is unnamed", async () => {
            const cells = buildMilestoneWithRoots(10);
            // Custom subdivision at v6 with NO `name` — i.e. just a break.
            cells[0].metadata.data = {
                subdivisions: [{ startCellId: "v6" }],
            };
            const document = await createDocumentWithCells(cells);
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("promoteSubdivisionToMilestone", {
                document,
                content: { milestoneIndex: 0, subdivisionKey: "v6" },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2);
            const inserted = document.getCellByIndex(index.milestones[1].cellIndex);
            assert.strictEqual(
                inserted?.value,
                "New milestone",
                "Unnamed promotions should not duplicate the parent milestone's chapter label"
            );
        });

        test("addMilestoneAtCell stamps 'New milestone' as the placeholder label", async () => {
            const document = await createDocumentWithCells(buildMilestoneWithRoots(10));
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("addMilestoneAtCell", {
                document,
                content: { milestoneIndex: 0, cellNumber: 6 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2);
            const inserted = document.getCellByIndex(index.milestones[1].cellIndex);
            assert.strictEqual(
                inserted?.value,
                "New milestone",
                "New milestones should default to a placeholder, not the parent chapter label"
            );
        });

        test("removeMilestone soft-deletes the milestone and lifts its subdivisions", async () => {
            const cells = buildTwoMilestoneDoc();
            // Give the second milestone a custom subdivision on v8.
            cells[6].metadata.data = {
                subdivisions: [{ startCellId: "v8", name: "Tail" }],
            };
            const document = await createDocumentWithCells(cells);
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("removeMilestone", {
                document,
                content: { milestoneIndex: 1 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 1, "Only the first milestone should remain");
            // Surviving milestone must absorb v6..v10 alongside v1..v5.
            const survivor = document.getCellByIndex(index.milestones[0].cellIndex);
            const data = survivor?.metadata?.data as any;
            assert.deepStrictEqual(
                data?.subdivisions,
                [{ startCellId: "v8", name: "Tail" }],
                "Removed milestone's placements lift onto the survivor"
            );
            // No boundary placement at v6 — pure remove drops the seam.
            assert.ok(
                !data?.subdivisions?.some((p: any) => p.startCellId === "v6"),
                "Pure remove should not preserve the boundary as a subdivision"
            );
        });

        test("removeMilestone refuses to remove the first milestone", async () => {
            const document = await createDocumentWithCells(buildTwoMilestoneDoc());
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);
            sinon.stub(vscode.window, "showWarningMessage");

            await invokeHandler("removeMilestone", {
                document,
                content: { milestoneIndex: 0 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2, "First milestone must not be removable");
        });

        test("demoteMilestoneToSubdivision preserves the boundary and carries the milestone label", async () => {
            const document = await createDocumentWithCells(buildTwoMilestoneDoc());
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);

            await invokeHandler("demoteMilestoneToSubdivision", {
                document,
                content: { milestoneIndex: 1 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 1);
            const survivor = document.getCellByIndex(index.milestones[0].cellIndex);
            const data = survivor?.metadata?.data as any;
            assert.deepStrictEqual(
                data?.subdivisions,
                [{ startCellId: "v6", name: "Luke 2" }],
                "Demoted milestone's label becomes the boundary placement's name"
            );
        });

        test("demoteMilestoneToSubdivision refuses to demote the first milestone", async () => {
            const document = await createDocumentWithCells(buildTwoMilestoneDoc());
            stampSourceUri(document);
            stubProviderForHandlerTest(provider);
            sinon.stub(vscode.window, "showWarningMessage");

            await invokeHandler("demoteMilestoneToSubdivision", {
                document,
                content: { milestoneIndex: 0 },
            });

            const index = document.buildMilestoneIndex(50);
            assert.strictEqual(index.milestones.length, 2, "First milestone must not be demotable");
        });
    });
});
