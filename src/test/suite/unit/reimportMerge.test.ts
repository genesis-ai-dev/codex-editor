import * as assert from "assert";
import { getReimportSourceText } from "../../../providers/NewSourceUploader/reimportSourceText";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import {
    mergeReimportedNotebookPair,
    type ReimportCell,
    type ReimportEdit,
    type ReimportNotebook,
} from "../../../providers/NewSourceUploader/reimportMerge";

const textCell = (id: string, value: string, metadata: Record<string, unknown> = {}): ReimportCell => ({
    kind: 2,
    value,
    languageId: "html",
    metadata: { id, type: CodexCellTypes.TEXT, edits: [], data: {}, ...metadata },
});

const notebook = (cells: ReimportCell[], metadata: Record<string, unknown> = {}): ReimportNotebook => ({
    cells,
    metadata,
});

const edits = (cell: ReimportCell): ReimportEdit[] => (cell.metadata?.edits ?? []) as ReimportEdit[];

const isTombstoned = (cell: ReimportCell): boolean => cell.metadata?.data?.deleted === true;

const findCell = (nb: ReimportNotebook, id: string): ReimportCell | undefined =>
    nb.cells.find((cell) => cell.metadata?.id === id);

suite("reimportMerge", () => {
    suite("mergeReimportedNotebookPair", () => {
        test("DOCX formatting-only re-import keeps the old heading id, translation and history", () => {
            const metadata = { importerType: "docx" };
            const data = { originalText: "Lesson #6, Chapter 2 Overview" };
            const oldSource = textCell("old-title", '<p><span style="font-size: 18pt">Le</span><span style="font-size: 18pt">sson #6, Chapter 2 Overview</span></p>', {
                paragraphIndex: 9, data,
            });
            const oldTarget = textCell("old-title", "<p>Lección #6, Resumen del Capítulo 2</p>", {
                attachments: { audio: "recording.mp3" }, cellLabel: "Title",
                edits: [{ editMap: ["value"], value: "Spanish", timestamp: 1, type: EditType.USER_EDIT }],
            });
            const newCell = textCell("fresh-title", '<p><span style="font-size: 18pt">Lesson #6, Chapter 2 Overview</span></p>', {
                paragraphIndex: 30, paragraphMappingVersion: "outermost-no-fallback-v1", data,
            });
            const result = mergeReimportedNotebookPair(
                notebook([oldSource], metadata), notebook([oldTarget], metadata),
                notebook([newCell], metadata), notebook([textCell("fresh-title", "", newCell.metadata)], metadata),
            );
            assert.strictEqual(result.stats.matchedCells, 1);
            assert.strictEqual(result.stats.droppedTranslations, 0);
            const target = findCell(result.mergedCodex, "old-title")!;
            assert.strictEqual(target.value, oldTarget.value);
            assert.deepStrictEqual(target.metadata?.attachments, oldTarget.metadata?.attachments);
            assert.strictEqual(target.metadata?.cellLabel, "Title");
            assert.strictEqual(target.metadata?.paragraphIndex, 30);
            assert.strictEqual(edits(target)[0].type, EditType.USER_EDIT);
            assert.ok(edits(target).some((edit) => edit.editMap.join(".") === "metadata.paragraphIndex"));
            assert.ok(edits(result.mergedSource.cells[0]).some((edit) => edit.editMap[0] === "value"));
        });

        test("DOCX text normalization keeps inline words, boundaries and single-decoded entities", () => {
            const cell = textCell("x", '<p>Le<span>sson</span> A&amp;B</p><p>&#x43;&#68;&nbsp;&amp;lt;</p><p>x<br/>y</p>');
            assert.strictEqual(getReimportSourceText(cell, true), "Lesson A&B CD &lt; x y");
            assert.strictEqual(getReimportSourceText(cell, false), "Le sson A&B &#x43;&#68; < x y");
        });

        test("DOCX source corrections take precedence over stale originalText", () => {
            const old = textCell("old", "<p>Changed source</p>", { data: { originalText: "Old source" } });
            const fresh = textCell("new", "<p>Old source</p>", { data: { originalText: "Old source" } });
            const metadata = { importerType: "docx" };
            const result = mergeReimportedNotebookPair(
                notebook([old], metadata), notebook([textCell("old", "Translation")], metadata),
                notebook([fresh], metadata), notebook([textCell("new", "")], metadata),
            );
            assert.strictEqual(result.stats.matchedCells, 0);
            assert.strictEqual(findCell(result.mergedCodex, "new")?.value, "");
        });

        test("does not apply DOCX inline matching to other importer types", () => {
            const inlineSplit = (metadata: Record<string, unknown>) =>
                mergeReimportedNotebookPair(
                    notebook([textCell("old", "<p>Le<span>sson</span></p>")], metadata),
                    notebook([textCell("old", "Translation")], metadata),
                    notebook([textCell("new", "<p>Lesson</p>")], metadata),
                    notebook([textCell("new", "")], metadata),
                );

            for (const importerType of ["markdown", "obs", "usfm", "indesign", "spreadsheet-csv", "spreadsheet-tsv"]) {
                assert.strictEqual(inlineSplit({ importerType }).stats.matchedCells, 0, importerType);
            }

            // Biblica does not match this on text either, but its positional
            // alignment pass pairs the cells anyway and flags them for review.
            const biblicaResult = inlineSplit({ importerType: "biblica" });
            assert.strictEqual(biblicaResult.stats.matchedCells, 1);
            assert.strictEqual(biblicaResult.stats.flaggedCells, 1);
        });

        test("carries translations over for cells with identical source text", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello world</p>")]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola mundo</p>", {
                    edits: [{ editMap: ["value"], value: "<p>Hola mundo</p>", timestamp: 1, type: EditType.USER_EDIT }],
                }),
            ]);
            const newSource = notebook([textCell("new-1", "<p>Hello world</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedSource.cells[0].metadata?.id, "old-1");
            assert.strictEqual(mergedCodex.cells[0].metadata?.id, "old-1");
            assert.strictEqual(mergedCodex.cells[0].value, "<p>Hola mundo</p>");
            // Carried value equals the old value, so no extra value edit is needed.
            const valueEdits = edits(mergedCodex.cells[0]).filter((e) => e.editMap[0] === "value");
            assert.strictEqual(valueEdits.length, 1);
            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(stats.droppedOldCells, 0);
        });

        test("appends a MIGRATION value edit when the source html changed for matched cells", () => {
            const existingSource = notebook([
                textCell("old-1", "<p>Hello world</p>", {
                    edits: [{ editMap: ["value"], value: "<p>Hello world</p>", timestamp: 1, type: EditType.INITIAL_IMPORT }],
                }),
            ]);
            const existingCodex = notebook([textCell("old-1", "<p>Hola mundo</p>")]);
            // Same text, different markup (e.g. corrected wrapper from the fixed parser).
            const newSource = notebook([
                textCell("new-1", '<p style="line-height: 115%"><span>Hello world</span></p>'),
            ]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const merged = mergedSource.cells[0];
            assert.strictEqual(merged.metadata?.id, "old-1");
            const valueEdits = edits(merged).filter((e) => e.editMap[0] === "value");
            // Old INITIAL_IMPORT edit preserved + new MIGRATION edit describing the change.
            assert.strictEqual(valueEdits.length, 2);
            const latest = valueEdits[valueEdits.length - 1];
            assert.strictEqual(latest.type, EditType.MIGRATION);
            assert.strictEqual(latest.value, merged.value);
        });

        test("soft-deletes duplicated old cells but keeps the copy that has a translation", () => {
            // The mc:AlternateContent bug: the same text imported twice; the
            // user translated the second copy.
            const existingSource = notebook([
                textCell("dup-1", "<p>Repeated text</p>"),
                textCell("dup-2", "<p>Repeated text</p>"),
            ]);
            const existingCodex = notebook([
                textCell("dup-1", ""),
                textCell("dup-2", "<p>Texto repetido</p>"),
            ]);
            const newSource = notebook([textCell("new-1", "<p>Repeated text</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            // Both cells present: the live merged cell and the tombstoned duplicate.
            assert.strictEqual(mergedSource.cells.length, 2);
            const live = findCell(mergedSource, "dup-2")!;
            const dead = findCell(mergedSource, "dup-1")!;
            assert.strictEqual(isTombstoned(live), false);
            assert.strictEqual(isTombstoned(dead), true);
            // The tombstone is recorded as an edit so it wins the sync merge.
            const deadDeleteEdits = edits(dead).filter(
                (e) => e.editMap.join(".") === "metadata.data.deleted"
            );
            assert.strictEqual(deadDeleteEdits.length, 1);
            assert.strictEqual(deadDeleteEdits[0].value, true);

            assert.strictEqual(findCell(mergedCodex, "dup-2")!.value, "<p>Texto repetido</p>");
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "dup-1")!), true);
            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(stats.droppedOldCells, 1);
            assert.strictEqual(stats.droppedTranslations, 0);
        });

        test("soft-deletes old cells missing from the new parse, along with their targets", () => {
            const existingSource = notebook([
                textCell("keep", "<p>Kept text</p>"),
                textCell("gone", "<p>Removed text</p>"),
            ]);
            const existingCodex = notebook([
                textCell("keep", "<p>Texto conservado</p>"),
                textCell("gone", "<p>Texto eliminado</p>"),
            ]);
            const newSource = notebook([textCell("new-1", "<p>Kept text</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedCodex.cells.length, 2);
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "keep")!), false);
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "gone")!), true);
            assert.strictEqual(stats.droppedOldCells, 1);
            assert.strictEqual(stats.droppedTranslations, 1);
        });

        test("new cells without an old counterpart start with an empty target", () => {
            const existingSource = notebook([textCell("old-1", "<p>Old text</p>")]);
            const existingCodex = notebook([textCell("old-1", "<p>Texto viejo</p>")]);
            const newSource = notebook([
                textCell("new-1", "<p>Old text</p>"),
                textCell("new-2", "<p>Brand new text</p>"),
            ]);
            const newCodex = notebook([textCell("new-1", ""), textCell("new-2", "")]);

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedSource.cells.length, 2);
            assert.strictEqual(mergedSource.cells[1].metadata?.id, "new-2");
            assert.strictEqual(findCell(mergedCodex, "new-2")!.value, "");
            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.totalNewCells, 2);
        });

        test("containment match absorbs re-segmented old cells, concatenates translations, and records a value edit", () => {
            // Old parse split one paragraph into two cells; new parse keeps it whole.
            const existingSource = notebook([
                textCell("part-1", "<p>First sentence.</p>"),
                textCell("part-2", "<p>Second sentence.</p>"),
            ]);
            const existingCodex = notebook([
                textCell("part-1", "<p>Primera frase.</p>"),
                textCell("part-2", "<p>Segunda frase.</p>"),
            ]);
            const newSource = notebook([
                textCell("new-1", "<p>First sentence. Second sentence.</p>"),
            ]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const adopting = findCell(mergedCodex, "part-1")!;
            assert.strictEqual(adopting.value, "<p>Primera frase.</p> <p>Segunda frase.</p>");
            // The concatenated value differs from the old cell's value, so a
            // MIGRATION value edit must describe it for the sync merge.
            const valueEdits = edits(adopting).filter((e) => e.editMap[0] === "value");
            assert.strictEqual(valueEdits[valueEdits.length - 1].value, adopting.value);
            assert.strictEqual(valueEdits[valueEdits.length - 1].type, EditType.MIGRATION);

            // The absorbed cell is tombstoned, not removed.
            const absorbedSource = findCell(mergedSource, "part-2")!;
            assert.strictEqual(isTombstoned(absorbedSource), true);
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "part-2")!), true);

            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.droppedOldCells, 1);
        });

        test("preserves target attachments and records top-level and nested locator changes as edits", () => {
            const existingSource = notebook([
                textCell("old-1", "<p>Hello</p>", {
                    paragraphIndex: 3,
                    paragraphIndices: [3, 4],
                    segmentIndex: 1,
                }),
            ]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola</p>", {
                    attachments: { "audio-1": { type: "audio" } },
                    selectedAudioId: "audio-1",
                    selectionTimestamp: 123,
                    paragraphIndex: 3,
                    paragraphIndices: [3, 4],
                    segmentIndex: 1,
                    data: { rowIndex: 3 },
                }),
            ]);
            const newSource = notebook([
                textCell("new-1", "<p>Hello</p>", {
                    paragraphIndex: 7,
                    paragraphMappingVersion: "outermost-no-fallback-v1",
                    data: { rowIndex: 7 },
                }),
            ]);
            const newCodex = notebook([
                textCell("new-1", "", {
                    paragraphIndex: 7,
                    paragraphMappingVersion: "outermost-no-fallback-v1",
                    data: { rowIndex: 7 },
                }),
            ]);

            const { mergedCodex } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const metadata = mergedCodex.cells[0].metadata!;
            assert.strictEqual(metadata.id, "old-1");
            assert.strictEqual(metadata.selectedAudioId, "audio-1");
            assert.deepStrictEqual(metadata.attachments, { "audio-1": { type: "audio" } });
            // Structural metadata comes from the new parse...
            assert.strictEqual(metadata.paragraphIndex, 7);
            assert.strictEqual(metadata.paragraphMappingVersion, "outermost-no-fallback-v1");
            assert.strictEqual(metadata.paragraphIndices, null);
            assert.strictEqual(metadata.segmentIndex, null);
            assert.deepStrictEqual(metadata.data, { rowIndex: 7 });
            // ...and the change is recorded as an edit so it survives sync.
            const paragraphEdits = edits(mergedCodex.cells[0]).filter(
                (e) => e.editMap.join(".") === "metadata.paragraphIndex"
            );
            assert.strictEqual(paragraphEdits.length, 1);
            assert.strictEqual(paragraphEdits[0].value, 7);
            const rowEdits = edits(mergedCodex.cells[0]).filter(
                (e) => e.editMap.join(".") === "metadata.data.rowIndex"
            );
            assert.strictEqual(rowEdits.length, 1);
            assert.strictEqual(rowEdits[0].value, 7);
            const clearedLocatorEdits = edits(mergedCodex.cells[0]).filter(
                (e) => ["metadata.paragraphIndices", "metadata.segmentIndex"].includes(e.editMap.join("."))
            );
            assert.strictEqual(clearedLocatorEdits.length, 2);
            assert.ok(clearedLocatorEdits.every((edit) => edit.value === null));
        });

        test("remaps file-level cell references to retained ids and records metadata edits", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")], {
                structureMetadata: {
                    lineMappings: [{ lineIndex: 1, cellId: "old-1" }],
                },
                edits: [],
            });
            const existingCodex = notebook([textCell("old-1", "<p>Hola</p>")]);
            const newSource = notebook([textCell("new-1", "<p>Hello</p>")], {
                structureMetadata: {
                    lineMappings: [{ lineIndex: 2, cellId: "new-1" }],
                },
                edits: [],
            });
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.deepStrictEqual(mergedSource.metadata?.structureMetadata, {
                lineMappings: [{ lineIndex: 2, cellId: "old-1" }],
            });
            const metadataEdits = mergedSource.metadata?.edits as ReimportEdit[];
            const structureEdit = metadataEdits.find(
                (edit) => edit.editMap.join(".") === "metadata.structureMetadata"
            );
            assert.ok(structureEdit);
            assert.deepStrictEqual(structureEdit?.value, mergedSource.metadata?.structureMetadata);
        });

        test("re-inserts paratext cells after their surviving parent and tombstones orphaned ones", () => {
            const paratext = (id: string, parentId: string): ReimportCell => ({
                kind: 2,
                value: "<p>User note</p>",
                languageId: "html",
                metadata: { id, type: CodexCellTypes.PARATEXT, parentId, edits: [], data: {} },
            });
            const existingSource = notebook([
                textCell("old-1", "<p>Hello</p>"),
                textCell("gone", "<p>Removed</p>"),
            ]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola</p>"),
                paratext("note-1", "old-1"),
                textCell("gone", ""),
                paratext("note-2", "gone"),
            ]);
            const newSource = notebook([textCell("new-1", "<p>Hello</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedCodex } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const survivingNote = findCell(mergedCodex, "note-1")!;
            assert.strictEqual(isTombstoned(survivingNote), false);
            assert.strictEqual(
                mergedCodex.cells.indexOf(survivingNote),
                mergedCodex.cells.indexOf(findCell(mergedCodex, "old-1")!) + 1
            );
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "note-2")!), true);
        });

        test("reuses old milestone ids by chapter number", () => {
            const milestone = (id: string, value: string): ReimportCell => ({
                kind: 2,
                value,
                languageId: "html",
                metadata: { id, type: CodexCellTypes.MILESTONE, edits: [], data: {} },
            });
            const existingSource = notebook([
                milestone("old-ms", "My Document 1"),
                textCell("old-1", "<p>Hello</p>"),
            ]);
            const existingCodex = notebook([
                milestone("old-ms", "My Document 1"),
                textCell("old-1", "<p>Hola</p>"),
            ]);
            const newSource = notebook([
                milestone("new-ms", "1"),
                textCell("new-1", "<p>Hello</p>"),
            ]);
            const newCodex = notebook([
                milestone("new-ms", "1"),
                textCell("new-1", ""),
            ]);

            const { mergedSource, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const ms = mergedSource.cells[0];
            assert.strictEqual(ms.metadata?.id, "old-ms");
            assert.strictEqual(ms.metadata?.type, CodexCellTypes.MILESTONE);
            // Keeps the old label so no value edit is needed.
            assert.strictEqual(ms.value, "My Document 1");
            assert.strictEqual(stats.totalNewCells, 1);
            // No tombstoned milestone duplicate.
            assert.strictEqual(
                mergedSource.cells.filter((c) => c.metadata?.type === CodexCellTypes.MILESTONE).length,
                1
            );
        });

        test("passes already-tombstoned old cells through untouched", () => {
            const deadCell = textCell("already-dead", "<p>Old deleted text</p>", {
                data: { deleted: true },
                edits: [
                    { editMap: ["metadata", "data", "deleted"], value: true, timestamp: 5, type: EditType.USER_EDIT },
                ],
            });
            const existingSource = notebook([deadCell, textCell("old-1", "<p>Hello</p>")]);
            const existingCodex = notebook([textCell("old-1", "<p>Hola</p>")]);
            const newSource = notebook([textCell("new-1", "<p>Hello</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedSource } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            const dead = findCell(mergedSource, "already-dead")!;
            assert.strictEqual(isTombstoned(dead), true);
            // No duplicate tombstone edit was appended.
            assert.strictEqual(edits(dead).length, 1);
        });

        test("preserves identity metadata from the existing notebooks", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")], {
                id: "existing-id",
                fileDisplayName: "My Document",
                sourceFsPath: "/project/.project/sourceTexts/doc.source",
                originalFileHash: "old-hash",
            });
            const existingCodex = notebook([textCell("old-1", "<p>Hola</p>")], {
                id: "existing-id",
                codexFsPath: "/project/files/target/doc.codex",
            });
            const newSource = notebook([textCell("new-1", "<p>Hello</p>")], {
                id: "new-id",
                fileDisplayName: "My Document (1)",
                originalFileHash: "new-hash",
            });
            const newCodex = notebook([textCell("new-1", "")], { id: "new-id" });

            const { mergedSource, mergedCodex } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedSource.metadata?.id, "existing-id");
            assert.strictEqual(mergedSource.metadata?.fileDisplayName, "My Document");
            assert.strictEqual(
                mergedSource.metadata?.sourceFsPath,
                "/project/.project/sourceTexts/doc.source"
            );
            // Import-related metadata comes from the new parse.
            assert.strictEqual(mergedSource.metadata?.originalFileHash, "new-hash");
            assert.strictEqual(mergedCodex.metadata?.id, "existing-id");
        });
    });

    suite("Biblica structural matching", () => {
        const biblica = { importerType: "biblica" };

        /**
         * Biblica source cell carrying the IDML locators the matcher keys on.
         * `paragraphOrder` is derived from the paragraph id so that distinct
         * paragraphs get distinct orders, as they do in a real document.
         */
        const idmlCell = (
            id: string,
            value: string,
            locator: { story: string; paragraph: string; segment?: number; chapter?: string; },
        ): ReimportCell =>
            textCell(id, value, {
                storyId: locator.story,
                paragraphId: locator.paragraph,
                chapterNumber: locator.chapter,
                data: {
                    relationships: {
                        parentStory: locator.story,
                        paragraphOrder: Number(locator.paragraph.replace(/\D/g, "")) || 0,
                        segmentIndex: locator.segment ?? 0,
                    },
                },
            });

        const needsResolution = (cell: ReimportCell): boolean =>
            cell.metadata?.data?.needsResolution === true;

        test("keeps the translation when the importer changes a cell's style runs", () => {
            // The regression this whole pass exists for: the fixed parser emits
            // different markup AND different text for the same IDML paragraph,
            // so text matching would tombstone the cell and lose the link to
            // its translation.
            const existingSource = notebook(
                [idmlCell("old-1", "<p>Jacob\u02bcs sons</p>", { story: "u1a", paragraph: "p10" })],
                biblica,
            );
            const existingCodex = notebook(
                [textCell("old-1", "<p>Los hijos de Jacob</p>")],
                biblica,
            );
            const newSource = notebook(
                [idmlCell("fresh-1", "<p>Jacob's sons and daughters</p>", { story: "u1a", paragraph: "p10" })],
                biblica,
            );
            const newCodex = notebook([textCell("fresh-1", "")], biblica);

            const { mergedSource, mergedCodex, stats, changes } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(stats.droppedTranslations, 0);
            assert.strictEqual(stats.insertedCells, 0);

            // Old id kept, fresh source content applied, translation intact.
            const source = findCell(mergedSource, "old-1")!;
            const target = findCell(mergedCodex, "old-1")!;
            assert.strictEqual(source.value, "<p>Jacob's sons and daughters</p>");
            assert.strictEqual(target.value, "<p>Los hijos de Jacob</p>");

            // Flagged on both sides, each with a recorded edit so the flag
            // survives a sync merge.
            assert.strictEqual(stats.flaggedCells, 1);
            assert.ok(needsResolution(source), "source cell flagged");
            assert.ok(needsResolution(target), "target cell flagged");
            for (const cell of [source, target]) {
                const flagEdits = edits(cell).filter(
                    (e) => e.editMap.join(".") === "metadata.data.needsResolution",
                );
                assert.strictEqual(flagEdits.length, 1);
                assert.strictEqual(flagEdits[0].value, true);
                assert.strictEqual(flagEdits[0].type, EditType.MIGRATION);
            }

            assert.deepStrictEqual(
                changes.map((change) => [change.kind, change.needsResolution]),
                [["updated", true]],
            );
        });

        test("does not flag a structurally matched cell whose text is unchanged", () => {
            const existingSource = notebook(
                [idmlCell("old-1", "<p>Unchanged text</p>", { story: "u1a", paragraph: "p10" })],
                biblica,
            );
            const existingCodex = notebook([textCell("old-1", "<p>Sin cambios</p>")], biblica);
            // Same text, different markup (a wrapper the fixed parser emits).
            const newSource = notebook(
                [idmlCell("fresh-1", "<p><span>Unchanged text</span></p>", { story: "u1a", paragraph: "p10" })],
                biblica,
            );
            const newCodex = notebook([textCell("fresh-1", "")], biblica);

            const { mergedCodex, stats, changes } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.flaggedCells, 0);
            assert.strictEqual(needsResolution(findCell(mergedCodex, "old-1")!), false);
            assert.deepStrictEqual(changes, []);
        });

        test("inserts cells for a new paragraph without disturbing existing translations", () => {
            // Case 1: the document gained a paragraph between two translated
            // ones. Everything else keeps its id and translation and simply
            // shifts to make room.
            const existingSource = notebook(
                [
                    idmlCell("old-1", "<p>First note</p>", { story: "u1a", paragraph: "p10" }),
                    idmlCell("old-2", "<p>Third note</p>", { story: "u1a", paragraph: "p30" }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [
                    textCell("old-1", "<p>Primera nota</p>"),
                    textCell("old-2", "<p>Tercera nota</p>"),
                ],
                biblica,
            );
            const newSource = notebook(
                [
                    idmlCell("fresh-1", "<p>First note</p>", { story: "u1a", paragraph: "p10" }),
                    idmlCell("fresh-2", "<p>Second note</p>", { story: "u1a", paragraph: "p20" }),
                    idmlCell("fresh-3", "<p>Third note</p>", { story: "u1a", paragraph: "p30" }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-1", ""), textCell("fresh-2", ""), textCell("fresh-3", "")],
                biblica,
            );

            const { mergedSource, mergedCodex, stats, changes } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            // The new cell sits between the two existing ones, in order.
            assert.deepStrictEqual(
                mergedSource.cells.map((cell) => cell.metadata?.id),
                ["old-1", "fresh-2", "old-2"],
            );
            assert.deepStrictEqual(
                mergedCodex.cells.map((cell) => cell.value),
                ["<p>Primera nota</p>", "", "<p>Tercera nota</p>"],
            );
            assert.strictEqual(stats.insertedCells, 1);
            assert.strictEqual(stats.translationsCarried, 2);
            assert.strictEqual(stats.droppedOldCells, 0);
            // A genuinely new cell is not a re-resolution problem.
            assert.strictEqual(stats.flaggedCells, 0);
            assert.deepStrictEqual(
                changes.map((change) => change.kind),
                ["inserted"],
            );
        });

        test("re-split paragraph keeps every translation and flags the whole group", () => {
            // Case 2 at its worst: one paragraph that used to yield two cells
            // now yields three. Nothing may be lost, and the translator has to
            // redistribute the text, so all three cells are flagged.
            const existingSource = notebook(
                [
                    idmlCell("old-a", "<p>Line one</p>", { story: "u1a", paragraph: "p10", segment: 0 }),
                    idmlCell("old-b", "<p>Line two</p>", { story: "u1a", paragraph: "p10", segment: 1 }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [textCell("old-a", "<p>Linea uno</p>"), textCell("old-b", "<p>Linea dos</p>")],
                biblica,
            );
            const newSource = notebook(
                [
                    idmlCell("fresh-a", "<p>Line</p>", { story: "u1a", paragraph: "p10", segment: 0 }),
                    idmlCell("fresh-b", "<p>one</p>", { story: "u1a", paragraph: "p10", segment: 1 }),
                    idmlCell("fresh-c", "<p>Line two</p>", { story: "u1a", paragraph: "p10", segment: 2 }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-a", ""), textCell("fresh-b", ""), textCell("fresh-c", "")],
                biblica,
            );

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            // Two old cells adopted by the first two new slices; the third is
            // new. No translation is dropped.
            assert.deepStrictEqual(
                mergedSource.cells.map((cell) => cell.metadata?.id),
                ["old-a", "old-b", "fresh-c"],
            );
            assert.strictEqual(findCell(mergedCodex, "old-a")!.value, "<p>Linea uno</p>");
            assert.strictEqual(findCell(mergedCodex, "old-b")!.value, "<p>Linea dos</p>");
            assert.strictEqual(stats.droppedTranslations, 0);
            // Every cell of the re-split paragraph needs re-resolving.
            assert.strictEqual(stats.flaggedCells, 3);
            for (const id of ["old-a", "old-b", "fresh-c"]) {
                assert.ok(needsResolution(findCell(mergedSource, id)!), `${id} source flagged`);
                assert.ok(needsResolution(findCell(mergedCodex, id)!), `${id} target flagged`);
            }
        });

        test("collapsing paragraph folds surplus translations into the last slice", () => {
            // The reverse re-split: three old cells, two new ones. The third
            // translation has nowhere of its own to go, so it is appended
            // rather than dropped.
            const existingSource = notebook(
                [
                    idmlCell("old-a", "<p>A</p>", { story: "u1a", paragraph: "p10", segment: 0 }),
                    idmlCell("old-b", "<p>B</p>", { story: "u1a", paragraph: "p10", segment: 1 }),
                    idmlCell("old-c", "<p>C</p>", { story: "u1a", paragraph: "p10", segment: 2 }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [
                    textCell("old-a", "<p>alfa</p>"),
                    textCell("old-b", "<p>beta</p>"),
                    textCell("old-c", "<p>gamma</p>"),
                ],
                biblica,
            );
            const newSource = notebook(
                [
                    idmlCell("fresh-a", "<p>A</p>", { story: "u1a", paragraph: "p10", segment: 0 }),
                    idmlCell("fresh-b", "<p>B C</p>", { story: "u1a", paragraph: "p10", segment: 1 }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-a", ""), textCell("fresh-b", "")],
                biblica,
            );

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(findCell(mergedCodex, "old-a")!.value, "<p>alfa</p>");
            assert.strictEqual(findCell(mergedCodex, "old-b")!.value, "<p>beta</p> <p>gamma</p>");
            assert.strictEqual(stats.droppedTranslations, 0);
            assert.strictEqual(isTombstoned(findCell(mergedCodex, "old-c")!), true);
            assert.strictEqual(stats.flaggedCells, 2);
        });

        test("falls back to text matching for non-Biblica imports and for missing locators", () => {
            // Same shape as the style-run test, but the importer type is not
            // Biblica: the changed text must NOT be structurally matched.
            const existingSource = notebook(
                [idmlCell("old-1", "<p>Original text</p>", { story: "u1a", paragraph: "p10" })],
                { importerType: "indesign" },
            );
            const existingCodex = notebook([textCell("old-1", "<p>Translated</p>")], {
                importerType: "indesign",
            });
            const newSource = notebook(
                [idmlCell("fresh-1", "<p>Different text</p>", { story: "u1a", paragraph: "p10" })],
                { importerType: "indesign" },
            );
            const newCodex = notebook([textCell("fresh-1", "")], { importerType: "indesign" });

            const { stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );
            assert.strictEqual(stats.matchedCells, 0);
            assert.strictEqual(stats.flaggedCells, 0);

            // Biblica cells that predate the locator metadata still match by text.
            const legacy = mergeReimportedNotebookPair(
                notebook([textCell("legacy", "<p>Same text</p>")], biblica),
                notebook([textCell("legacy", "<p>Traducido</p>")], biblica),
                notebook([idmlCell("fresh", "<p>Same text</p>", { story: "u1a", paragraph: "p10" })], biblica),
                notebook([textCell("fresh", "")], biblica),
            );
            assert.strictEqual(legacy.stats.matchedCells, 1);
            assert.strictEqual(legacy.stats.translationsCarried, 1);
        });

        /**
         * IDML `ParagraphStyleRange` elements carry no `Self` attribute, so
         * real Biblica cells have no `paragraphId` at all and the matcher has
         * to fall back to `relationships.paragraphOrder`. These cases mirror
         * what is actually on disk.
         */
        const orderedCell = (
            id: string,
            value: string,
            locator: { story: string; order: number; segment?: number; },
        ): ReimportCell =>
            textCell(id, value, {
                storyId: locator.story,
                data: {
                    relationships: {
                        parentStory: locator.story,
                        paragraphOrder: locator.order,
                        segmentIndex: locator.segment ?? 0,
                    },
                },
            });

        test("matches on paragraphOrder when the IDML has no paragraph ids", () => {
            const existingSource = notebook(
                [
                    orderedCell("old-1", "<p>Alpha beta gamma</p>", { story: "u1a", order: 3 }),
                    orderedCell("old-2", "<p>Delta epsilon zeta</p>", { story: "u1a", order: 7 }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [textCell("old-1", "<p>Primera</p>"), textCell("old-2", "<p>Segunda</p>")],
                biblica,
            );
            // Text that neither equals nor contains the old text, so only the
            // structural pass can possibly link these to their translations.
            const newSource = notebook(
                [
                    orderedCell("fresh-1", "<p>Eta theta iota</p>", { story: "u1a", order: 3 }),
                    orderedCell("fresh-2", "<p>Kappa lambda mu</p>", { story: "u1a", order: 7 }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-1", ""), textCell("fresh-2", "")],
                biblica,
            );

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 2);
            assert.strictEqual(findCell(mergedCodex, "old-1")!.value, "<p>Primera</p>");
            assert.strictEqual(findCell(mergedCodex, "old-2")!.value, "<p>Segunda</p>");
        });

        test("matches when only one side of the import recorded paragraph ids", () => {
            // The pair on disk was written by an importer build that emitted no
            // paragraph id; the fresh parse emits one (or the reverse). Keying
            // strictly on the richer locator would intersect on nothing and
            // blank out every translation in the file.
            const existingSource = notebook(
                [orderedCell("old-1", "<p>Alpha beta gamma</p>", { story: "u1a", order: 3 })],
                biblica,
            );
            const existingCodex = notebook([textCell("old-1", "<p>Primera</p>")], biblica);
            const newSource = notebook(
                [
                    textCell("fresh-1", "<p>Eta theta iota</p>", {
                        storyId: "u1a",
                        paragraphId: "pid-99",
                        data: {
                            relationships: {
                                parentStory: "u1a",
                                paragraphOrder: 3,
                                segmentIndex: 0,
                            },
                        },
                    }),
                ],
                biblica,
            );
            const newCodex = notebook([textCell("fresh-1", "")], biblica);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(findCell(mergedCodex, "old-1")!.value, "<p>Primera</p>");
        });

        test("ignores a positional key shared by several paragraphs", () => {
            // A build that stamped every paragraph with the same order must not
            // collapse them into one group and cross-wire their translations.
            const existingSource = notebook(
                [
                    textCell("old-1", "<p>Alpha</p>", {
                        storyId: "u1a",
                        paragraphId: "pA",
                        data: { relationships: { parentStory: "u1a", paragraphOrder: 0 } },
                    }),
                    textCell("old-2", "<p>Beta</p>", {
                        storyId: "u1a",
                        paragraphId: "pB",
                        data: { relationships: { parentStory: "u1a", paragraphOrder: 0 } },
                    }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [textCell("old-1", "<p>Uno</p>"), textCell("old-2", "<p>Dos</p>")],
                biblica,
            );
            const newSource = notebook(
                [
                    textCell("fresh-1", "<p>Alpha revised</p>", {
                        storyId: "u1a",
                        paragraphId: "pA",
                        data: { relationships: { parentStory: "u1a", paragraphOrder: 0 } },
                    }),
                    textCell("fresh-2", "<p>Beta revised</p>", {
                        storyId: "u1a",
                        paragraphId: "pB",
                        data: { relationships: { parentStory: "u1a", paragraphOrder: 0 } },
                    }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-1", ""), textCell("fresh-2", "")],
                biblica,
            );

            const { mergedCodex } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            // Each translation stays with its own paragraph.
            assert.strictEqual(findCell(mergedCodex, "old-1")!.value, "<p>Uno</p>");
            assert.strictEqual(findCell(mergedCodex, "old-2")!.value, "<p>Dos</p>");
        });

        test("inserting cells shifts later cells and keeps their translations aligned", () => {
            // The reported scenario: two translated cells with four new
            // paragraphs appearing between them. The first keeps its position,
            // the second shifts down by four, and both keep their translations
            // while the inserted cells arrive empty.
            const existingSource = notebook(
                [
                    idmlCell("old-first", "<p>First note</p>", { story: "u1a", paragraph: "p1" }),
                    idmlCell("old-last", "<p>Last note</p>", { story: "u1a", paragraph: "p20" }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [
                    textCell("old-first", "<p>Primera</p>"),
                    textCell("old-last", "<p>Ultima</p>"),
                ],
                biblica,
            );
            const inserted = [5, 6, 7, 8].map((n) =>
                idmlCell(`fresh-${n}`, `<p>Added ${n}</p>`, { story: "u1a", paragraph: `p${n}` }),
            );
            const newSource = notebook(
                [
                    idmlCell("fresh-first", "<p>First note</p>", { story: "u1a", paragraph: "p1" }),
                    ...inserted,
                    idmlCell("fresh-last", "<p>Last note</p>", { story: "u1a", paragraph: "p20" }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [
                    textCell("fresh-first", ""),
                    ...inserted.map((cell) => textCell(cell.metadata!.id as string, "")),
                    textCell("fresh-last", ""),
                ],
                biblica,
            );

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            const ids = mergedSource.cells.map((cell) => cell.metadata?.id);
            assert.deepStrictEqual(ids, [
                "old-first",
                "fresh-5",
                "fresh-6",
                "fresh-7",
                "fresh-8",
                "old-last",
            ]);
            assert.deepStrictEqual(
                mergedCodex.cells.map((cell) => cell.value),
                ["<p>Primera</p>", "", "", "", "", "<p>Ultima</p>"],
            );
            assert.strictEqual(stats.insertedCells, 4);
            assert.strictEqual(stats.translationsCarried, 2);
            assert.strictEqual(stats.droppedTranslations, 0);
            // Nothing changed about the surviving cells, so nothing to review.
            assert.strictEqual(stats.flaggedCells, 0);
        });

        test("keeps translations when neither locators nor text line up", () => {
            // The worst case, and the one that produced a blank target: the
            // importer rewrote the text AND the locators do not correspond, so
            // every pass except positional alignment comes up empty.
            const existingSource = notebook(
                [
                    idmlCell("old-1", "<p>Alpha beta</p>", { story: "s1", paragraph: "p1" }),
                    idmlCell("old-2", "<p>Gamma delta</p>", { story: "s1", paragraph: "p2" }),
                    idmlCell("old-3", "<p>Epsilon zeta</p>", { story: "s1", paragraph: "p3" }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [
                    textCell("old-1", "<p>Uno</p>"),
                    textCell("old-2", "<p>Dos</p>"),
                    textCell("old-3", "<p>Tres</p>"),
                ],
                biblica,
            );
            // Different story id and different paragraph ids: no structural
            // key in common. Different words: no text or containment match.
            const newSource = notebook(
                [
                    idmlCell("fresh-1", "<p>Eta theta</p>", { story: "s9", paragraph: "p71" }),
                    idmlCell("fresh-2", "<p>Iota kappa</p>", { story: "s9", paragraph: "p72" }),
                    idmlCell("fresh-3", "<p>Lambda mu</p>", { story: "s9", paragraph: "p73" }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [textCell("fresh-1", ""), textCell("fresh-2", ""), textCell("fresh-3", "")],
                biblica,
            );

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 3);
            assert.strictEqual(stats.droppedTranslations, 0);
            assert.deepStrictEqual(
                mergedCodex.cells.map((cell) => cell.value),
                ["<p>Uno</p>", "<p>Dos</p>", "<p>Tres</p>"],
            );
            // The fresh source text is what is kept, on the old cells' ids.
            assert.deepStrictEqual(
                mergedSource.cells.map((cell) => cell.value),
                ["<p>Eta theta</p>", "<p>Iota kappa</p>", "<p>Lambda mu</p>"],
            );
            // Positional pairing is a guess, so every one needs verifying.
            assert.strictEqual(stats.flaggedCells, 3);
            assert.ok(mergedCodex.cells.every(needsResolution), "targets flagged");
        });

        test("positional alignment inserts rather than mispairs when cells were added", () => {
            // Two anchors that still match by text, with one changed cell and
            // two brand-new cells between them. The changed cell must take the
            // old translation; the extra cells must arrive empty.
            const existingSource = notebook(
                [
                    idmlCell("old-a", "<p>Stable opening</p>", { story: "s1", paragraph: "p1" }),
                    idmlCell("old-b", "<p>Alpha beta</p>", { story: "s1", paragraph: "p2" }),
                    idmlCell("old-c", "<p>Stable ending</p>", { story: "s1", paragraph: "p9" }),
                ],
                biblica,
            );
            const existingCodex = notebook(
                [
                    textCell("old-a", "<p>Apertura</p>"),
                    textCell("old-b", "<p>Dos</p>"),
                    textCell("old-c", "<p>Cierre</p>"),
                ],
                biblica,
            );
            const newSource = notebook(
                [
                    idmlCell("fresh-a", "<p>Stable opening</p>", { story: "s9", paragraph: "p31" }),
                    idmlCell("fresh-b", "<p>Gamma delta</p>", { story: "s9", paragraph: "p32" }),
                    idmlCell("fresh-x", "<p>Brand new one</p>", { story: "s9", paragraph: "p33" }),
                    idmlCell("fresh-y", "<p>Brand new two</p>", { story: "s9", paragraph: "p34" }),
                    idmlCell("fresh-c", "<p>Stable ending</p>", { story: "s9", paragraph: "p39" }),
                ],
                biblica,
            );
            const newCodex = notebook(
                [
                    textCell("fresh-a", ""),
                    textCell("fresh-b", ""),
                    textCell("fresh-x", ""),
                    textCell("fresh-y", ""),
                    textCell("fresh-c", ""),
                ],
                biblica,
            );

            const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.deepStrictEqual(
                mergedSource.cells.map((cell) => cell.metadata?.id),
                ["old-a", "old-b", "fresh-x", "fresh-y", "old-c"],
            );
            assert.deepStrictEqual(
                mergedCodex.cells.map((cell) => cell.value),
                ["<p>Apertura</p>", "<p>Dos</p>", "", "", "<p>Cierre</p>"],
            );
            assert.strictEqual(stats.insertedCells, 2);
            assert.strictEqual(stats.droppedTranslations, 0);
            // Only the changed cell needs review; the anchors are unchanged.
            assert.strictEqual(stats.flaggedCells, 1);
        });
    });

    suite("source/codex id drift", () => {
        test("recovers translations when the codex uses different ids than the source", () => {
            // Cell-id migrations run over .source and .codex files
            // independently, so a pair can end up describing the same document
            // under different ids. The id join then finds nothing and the
            // update writes an empty target — the failure this guards.
            const existingSource = notebook([
                textCell("src-1", "<p>First</p>"),
                textCell("src-2", "<p>Second</p>"),
            ]);
            const existingCodex = notebook([
                textCell("codex-1", "<p>Primera</p>"),
                textCell("codex-2", "<p>Segunda</p>"),
            ]);
            const newSource = notebook([
                textCell("fresh-1", "<p>First</p>"),
                textCell("fresh-2", "<p>Second</p>"),
            ]);
            const newCodex = notebook([textCell("fresh-1", ""), textCell("fresh-2", "")]);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 2);
            // The merged pair is re-keyed to the source ids, repairing the drift.
            assert.strictEqual(findCell(mergedCodex, "src-1")!.value, "<p>Primera</p>");
            assert.strictEqual(findCell(mergedCodex, "src-2")!.value, "<p>Segunda</p>");
        });

        test("keeps using ids when only some of them drifted", () => {
            // A partially drifted pair must not be shuffled: the cells that
            // still join by id keep their own translation, and only the
            // leftover cell is resolved by position.
            const existingSource = notebook([
                textCell("shared", "<p>First</p>"),
                textCell("src-2", "<p>Second</p>"),
            ]);
            const existingCodex = notebook([
                textCell("shared", "<p>Primera</p>"),
                textCell("codex-2", "<p>Segunda</p>"),
            ]);
            const newSource = notebook([
                textCell("fresh-1", "<p>First</p>"),
                textCell("fresh-2", "<p>Second</p>"),
            ]);
            const newCodex = notebook([textCell("fresh-1", ""), textCell("fresh-2", "")]);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 2);
            assert.strictEqual(findCell(mergedCodex, "shared")!.value, "<p>Primera</p>");
            assert.strictEqual(findCell(mergedCodex, "src-2")!.value, "<p>Segunda</p>");
        });

        test("zips leftover translations by order when the two sides have different cell counts", () => {
            // Extra source cells become inserts; the translations we do have
            // still have to land on the cells that line up by position.
            const existingSource = notebook([
                textCell("src-1", "<p>First</p>"),
                textCell("src-2", "<p>Second</p>"),
            ]);
            const existingCodex = notebook([textCell("codex-1", "<p>Primera</p>")]);
            const newSource = notebook([
                textCell("fresh-1", "<p>First</p>"),
                textCell("fresh-2", "<p>Second</p>"),
            ]);
            const newCodex = notebook([textCell("fresh-1", ""), textCell("fresh-2", "")]);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(findCell(mergedCodex, "src-1")!.value, "<p>Primera</p>");
            assert.strictEqual(findCell(mergedCodex, "src-2")!.value, "");
        });

        test("ignores codex-only paratext when pairing by position", () => {
            // Translation imports append paratext cells to the codex that the
            // source never has; counting them would make the two sides look
            // mismatched and disable the fallback.
            const existingSource = notebook([
                textCell("src-1", "<p>First</p>"),
                textCell("src-2", "<p>Second</p>"),
            ]);
            const existingCodex = notebook([
                textCell("codex-1", "<p>Primera</p>"),
                textCell("note", "<p>A note</p>", { type: CodexCellTypes.PARATEXT }),
                textCell("codex-2", "<p>Segunda</p>"),
            ]);
            const newSource = notebook([
                textCell("fresh-1", "<p>First</p>"),
                textCell("fresh-2", "<p>Second</p>"),
            ]);
            const newCodex = notebook([textCell("fresh-1", ""), textCell("fresh-2", "")]);

            const { mergedCodex, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex,
            );

            assert.strictEqual(stats.translationsCarried, 2);
            assert.strictEqual(findCell(mergedCodex, "src-2")!.value, "<p>Segunda</p>");
        });
    });
});
