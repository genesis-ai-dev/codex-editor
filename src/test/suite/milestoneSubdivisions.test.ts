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
