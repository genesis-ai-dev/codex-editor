import * as assert from "assert";
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

        test("preserves target attachments and audio selection, and records data field changes as edits", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola</p>", {
                    attachments: { "audio-1": { type: "audio" } },
                    selectedAudioId: "audio-1",
                    selectionTimestamp: 123,
                    data: { paragraphIndex: 3 },
                }),
            ]);
            const newSource = notebook([
                textCell("new-1", "<p>Hello</p>", { data: { paragraphIndex: 7 } }),
            ]);
            const newCodex = notebook([
                textCell("new-1", "", { data: { paragraphIndex: 7 } }),
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
            assert.deepStrictEqual(metadata.data, { paragraphIndex: 7 });
            // ...and the change is recorded as an edit so it survives sync.
            const dataEdits = edits(mergedCodex.cells[0]).filter(
                (e) => e.editMap.join(".") === "metadata.data.paragraphIndex"
            );
            assert.strictEqual(dataEdits.length, 1);
            assert.strictEqual(dataEdits[0].value, 7);
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
});
