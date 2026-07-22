import * as assert from "assert";
import { CodexCellTypes } from "../../../../types/enums";
import {
    mergeReimportedNotebookPair,
    type ReimportCell,
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

suite("reimportMerge", () => {
    suite("mergeReimportedNotebookPair", () => {
        test("carries translations over for cells with identical source text", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello world</p>")]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola mundo</p>", {
                    edits: [{ editMap: ["value"], value: "<p>Hola mundo</p>" }],
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
            assert.strictEqual((mergedCodex.cells[0].metadata?.edits as unknown[]).length, 1);
            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(stats.droppedOldCells, 0);
        });

        test("drops duplicated old cells but keeps the copy that has a translation", () => {
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

            assert.strictEqual(mergedSource.cells.length, 1);
            assert.strictEqual(mergedSource.cells[0].metadata?.id, "dup-2");
            assert.strictEqual(mergedCodex.cells[0].value, "<p>Texto repetido</p>");
            assert.strictEqual(stats.translationsCarried, 1);
            assert.strictEqual(stats.droppedOldCells, 1);
            assert.strictEqual(stats.droppedTranslations, 0);
        });

        test("drops old cells missing from the new parse, along with their targets", () => {
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

            assert.strictEqual(mergedCodex.cells.length, 1);
            assert.strictEqual(mergedCodex.cells[0].metadata?.id, "keep");
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
            assert.strictEqual(mergedCodex.cells[1].value, "");
            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.totalNewCells, 2);
        });

        test("containment match absorbs re-segmented old cells and concatenates translations", () => {
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

            assert.strictEqual(mergedSource.cells[0].metadata?.id, "part-1");
            assert.strictEqual(
                mergedCodex.cells[0].value,
                "<p>Primera frase.</p> <p>Segunda frase.</p>"
            );
            assert.strictEqual(stats.matchedCells, 1);
            assert.strictEqual(stats.droppedOldCells, 0);
        });

        test("preserves target attachments and audio selection on matched cells", () => {
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")]);
            const existingCodex = notebook([
                textCell("old-1", "<p>Hola</p>", {
                    attachments: { "audio-1": { type: "audio" } },
                    selectedAudioId: "audio-1",
                    selectionTimestamp: 123,
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
            // Structural metadata comes from the new parse.
            assert.deepStrictEqual(metadata.data, { paragraphIndex: 7 });
        });

        test("re-inserts paratext cells after their surviving parent", () => {
            const paratext: ReimportCell = {
                kind: 2,
                value: "<p>User note</p>",
                languageId: "html",
                metadata: {
                    id: "note-1",
                    type: CodexCellTypes.PARATEXT,
                    parentId: "old-1",
                    edits: [],
                },
            };
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")]);
            const existingCodex = notebook([textCell("old-1", "<p>Hola</p>"), paratext]);
            const newSource = notebook([textCell("new-1", "<p>Hello</p>")]);
            const newCodex = notebook([textCell("new-1", "")]);

            const { mergedCodex } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedCodex.cells.length, 2);
            assert.strictEqual(mergedCodex.cells[1].metadata?.id, "note-1");
            assert.strictEqual(mergedCodex.cells[1].metadata?.parentId, "old-1");
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

        test("passes milestone cells through from the new parse", () => {
            const milestone: ReimportCell = {
                kind: 2,
                value: "<h1>Section</h1>",
                languageId: "html",
                metadata: { id: "ms-1", type: CodexCellTypes.MILESTONE, edits: [] },
            };
            const existingSource = notebook([textCell("old-1", "<p>Hello</p>")]);
            const existingCodex = notebook([textCell("old-1", "<p>Hola</p>")]);
            const newSource = notebook([milestone, textCell("new-1", "<p>Hello</p>")]);
            const newCodex = notebook([milestone, textCell("new-1", "")]);

            const { mergedSource, stats } = mergeReimportedNotebookPair(
                existingSource,
                existingCodex,
                newSource,
                newCodex
            );

            assert.strictEqual(mergedSource.cells.length, 2);
            assert.strictEqual(mergedSource.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
            assert.strictEqual(stats.totalNewCells, 1);
        });
    });
});
