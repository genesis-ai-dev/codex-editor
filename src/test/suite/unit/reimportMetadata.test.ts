import * as assert from "assert";
import type { FileEditHistory } from "../../../../types";
import { EditType } from "../../../../types/enums";
import { mergeReimportedNotebookPair, type ReimportNotebook } from "../../../providers/NewSourceUploader/reimportMerge";
import { resolveCodexCustomMerge } from "../../../projectManager/utils/merge/resolvers";

const notebook = (metadata: Record<string, unknown>): ReimportNotebook => ({ cells: [], metadata });
const edit = (field: string, value: string, timestamp: number): FileEditHistory => ({
    editMap: ["metadata", field], value, timestamp, type: EditType.USER_EDIT, author: "translator",
});

suite("reimport metadata sync", () => {
    test("keeps existing file edits and user settings, versions changed import metadata, and does not mutate inputs", async () => {
        const history = [edit("fileDisplayName", "My name", 10), edit("originalName", "old.docx", Date.now() + 100000)];
        const old = notebook({ id: "old-id", fileDisplayName: "My name", textDirection: "rtl", originalName: "old.docx", originalFileName: "old.docx", originalFileHash: "old-hash", edits: history });
        const fresh = notebook({ id: "new-id", fileDisplayName: "Reset name", textDirection: "ltr", originalName: "new.docx", originalFileHash: "new-hash", wordCount: 2, edits: [edit("fileDisplayName", "Reset name", Date.now() + 200000)] });
        const before = JSON.stringify([old, fresh]);
        const { mergedCodex } = mergeReimportedNotebookPair(old, old, fresh, fresh);
        assert.strictEqual(JSON.stringify([old, fresh]), before);
        assert.strictEqual(mergedCodex.metadata?.id, "old-id");
        assert.strictEqual(mergedCodex.metadata?.fileDisplayName, "My name");
        assert.strictEqual(mergedCodex.metadata?.textDirection, "rtl");
        const edits = mergedCodex.metadata?.edits as FileEditHistory[];
        assert.deepStrictEqual(edits.slice(0, history.length), history);
        assert.ok(edits.slice(history.length).every(item => item.timestamp > history[1].timestamp));
        for (const [ours, theirs] of [[old, mergedCodex], [mergedCodex, old]]) {
            const result = JSON.parse(await resolveCodexCustomMerge(JSON.stringify(ours), JSON.stringify(theirs)));
            assert.strictEqual(result.metadata.originalName, "new.docx");
            assert.strictEqual(result.metadata.originalFileName, "new.docx");
            assert.strictEqual(result.metadata.originalFileHash, "new-hash");
            assert.strictEqual(result.metadata.wordCount, 2);
            assert.strictEqual(result.metadata.fileDisplayName, "My name");
        }
    });

    test("a legacy reimport with no hash cannot carry the old hash to a different original", async () => {
        const old = notebook({ originalName: "old.docx", originalFileHash: "old-hash", edits: [edit("originalFileHash", "old-hash", 10)] });
        const fresh = notebook({ originalName: "new.docx" });
        const { mergedCodex } = mergeReimportedNotebookPair(old, old, fresh, fresh);
        const result = JSON.parse(await resolveCodexCustomMerge(JSON.stringify(old), JSON.stringify(mergedCodex)));
        assert.strictEqual(result.metadata.originalFileName, "new.docx");
        assert.strictEqual(result.metadata.originalFileHash, "");
    });

    test("a new hash stamps unchanged filename aliases too, preventing an older edit from splitting the reference", async () => {
        const old = notebook({ originalName: "current.docx", originalFileName: "current.docx", originalFileHash: "old-hash", edits: [edit("originalFileName", "stale.docx", 10)] });
        const fresh = notebook({ originalName: "current.docx", originalFileHash: "new-hash" });
        const { mergedCodex } = mergeReimportedNotebookPair(old, old, fresh, fresh);
        const result = JSON.parse(await resolveCodexCustomMerge(JSON.stringify(old), JSON.stringify(mergedCodex)));
        assert.strictEqual(result.metadata.originalFileName, "current.docx");
        assert.strictEqual(result.metadata.originalFileHash, "new-hash");
    });

    test("reimport with an unchanged original does not append redundant reference edits", () => {
        const old = notebook({ originalName: "same.docx", originalFileName: "same.docx", originalFileHash: "hash" });
        const { mergedCodex } = mergeReimportedNotebookPair(old, old, old, old);
        const edits = mergedCodex.metadata?.edits as FileEditHistory[];
        assert.deepStrictEqual(edits.map(item => item.editMap), [["metadata", "importContext"]]);
    });
});
