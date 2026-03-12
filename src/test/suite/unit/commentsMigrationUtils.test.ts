import * as assert from "assert";
import { CommentsMigrator } from "../../../utils/commentsMigrationUtils";
import { generateCellIdFromHash, isUuidFormat } from "../../../utils/uuidUtils";

/** Invoke private migrateCellIdToUuid for testing */
async function migrateCellIdToUuid(thread: {
    id?: string;
    cellId?: { cellId: string; uri?: string; globalReferences?: string[] };
    [key: string]: unknown;
}): Promise<typeof thread> {
    return (CommentsMigrator as unknown as { migrateCellIdToUuid: (t: typeof thread) => Promise<typeof thread> })
        .migrateCellIdToUuid(thread);
}

suite("CommentsMigrator.migrateCellIdToUuid", () => {
    test("migrates legacy cell ID (e.g. GEN 1:1) to UUID and sets globalReferences", async () => {
        const thread = {
            id: "thread-1",
            cellId: { cellId: "GEN 1:1", uri: "file:///project/GEN.codex" },
        };

        const result = await migrateCellIdToUuid(thread);

        assert.ok(result.cellId?.cellId, "cellId should be present");
        assert.ok(isUuidFormat(result.cellId!.cellId), "cellId should be UUID format");
        assert.deepStrictEqual(result.cellId!.globalReferences, ["GEN 1:1"], "globalReferences should contain old id");
        assert.strictEqual(result.cellId!.uri, "file:///project/GEN.codex", "other cellId fields should be preserved");
    });

    test("leaves thread unchanged when cellId is already UUID format", async () => {
        const uuid = "590e4641-0a20-4655-a7fd-c1eb116e757c";
        const thread = {
            id: "thread-2",
            cellId: { cellId: uuid, uri: "file:///project/GEN.codex", globalReferences: [uuid] },
        };

        const result = await migrateCellIdToUuid(thread);

        assert.strictEqual(result.cellId?.cellId, uuid, "cellId should be unchanged");
        assert.deepStrictEqual(result.cellId?.globalReferences, [uuid], "globalReferences should be unchanged");
    });

    test("leaves thread unchanged when cellId is missing", async () => {
        const thread = { id: "thread-3", comments: [] };

        const result = await migrateCellIdToUuid(thread);

        assert.strictEqual(result.cellId, undefined, "cellId should remain undefined");
        assert.strictEqual(result.id, "thread-3");
    });

    test("leaves thread unchanged when cellId.cellId is missing", async () => {
        const thread = {
            id: "thread-4",
            cellId: { uri: "file:///project/GEN.codex" } as { cellId: string; uri: string },
        };

        const result = await migrateCellIdToUuid(thread);

        assert.strictEqual(result.cellId?.cellId, undefined, "cellId.cellId should remain undefined");
    });

    test("preserves existing globalReferences when migrating", async () => {
        const thread = {
            id: "thread-5",
            cellId: {
                cellId: "LUK 2:3",
                uri: "file:///project/LUK.codex",
                globalReferences: ["existing-ref"],
            },
        };

        const result = await migrateCellIdToUuid(thread);

        assert.ok(isUuidFormat(result.cellId!.cellId), "cellId should be UUID");
        assert.deepStrictEqual(
            result.cellId!.globalReferences,
            ["existing-ref"],
            "existing globalReferences should be preserved"
        );
    });

    test("produces deterministic UUID for same legacy cell ID", async () => {
        const thread = { id: "t", cellId: { cellId: "EXO 3:14" } };
        const result1 = await migrateCellIdToUuid(thread);
        const result2 = await migrateCellIdToUuid(thread);

        const expectedUuid = await generateCellIdFromHash("EXO 3:14");
        assert.strictEqual(result1.cellId?.cellId, expectedUuid, "first call should match uuidUtils");
        assert.strictEqual(result2.cellId?.cellId, expectedUuid, "second call should match uuidUtils");
        assert.strictEqual(result1.cellId?.cellId, result2.cellId?.cellId, "same input should yield same UUID");
    });
});
