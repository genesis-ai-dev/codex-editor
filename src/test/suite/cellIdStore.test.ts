import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { LocalCellIdStore } from "../../utils/cellIdStore";
import type { CellIdGlobalState } from "../../../types";

function makeContextForTests(): vscode.ExtensionContext {
    const dir = path.join(
        os.tmpdir(),
        `codex-cellid-store-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    // @ts-expect-error - partial context for tests
    const context: vscode.ExtensionContext = {
        globalStorageUri: vscode.Uri.file(dir),
        subscriptions: [],
    } as vscode.ExtensionContext;
    return context;
}

async function safeDelete(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch {
        // ignore
    }
}

function makeCellIdState(cellId: string, uri = "file:///tmp/test.codex"): CellIdGlobalState {
    return {
        cellId,
        globalReferences: [],
        uri,
        timestamp: new Date().toISOString(),
    };
}

suite("cellIdStore.LocalCellIdStore", () => {
    test("get returns undefined when the backing file does not exist yet", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            const value = await store.get("cellId");
            assert.strictEqual(value, undefined);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("update then get round-trips a value through disk", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            const payload = makeCellIdState("cell-1");

            store.update({ key: "cellId", value: payload });
            await store.flushNow();

            // Force a re-read from disk so we know we're not just reading the
            // in-memory cache.
            store._resetCacheForTests();
            const value = await store.get("cellId");
            assert.deepStrictEqual(value, payload);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("a fresh store reads the value persisted by a previous instance", async () => {
        const context = makeContextForTests();
        try {
            const writer = new LocalCellIdStore(context);
            const payload = makeCellIdState("cell-2");
            writer.update({ key: "cellId", value: payload });
            await writer.flushNow();

            const reader = new LocalCellIdStore(context);
            const value = await reader.get("cellId");
            assert.deepStrictEqual(value, payload);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("listen is notified on update and dispose stops further notifications", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            const received: Array<CellIdGlobalState | undefined> = [];
            const dispose = store.listen("cellId", (value) => received.push(value));

            const a = makeCellIdState("cell-A");
            store.update({ key: "cellId", value: a });
            await store.flushNow();

            // Dispose, then update again — listener should not see the second.
            dispose();
            const b = makeCellIdState("cell-B");
            store.update({ key: "cellId", value: b });
            await store.flushNow();

            assert.strictEqual(received.length, 1, "only the pre-dispose update should be observed");
            assert.deepStrictEqual(received[0], a);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("multiple rapid updates coalesce into a single persisted value", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            for (let i = 0; i < 10; i++) {
                store.update({ key: "cellId", value: makeCellIdState(`cell-${i}`) });
            }
            await store.flushNow();

            // Re-read from disk; the persisted value should be the last update.
            store._resetCacheForTests();
            const value = await store.get("cellId");
            assert.ok(value, "value should be defined");
            assert.strictEqual(value!.cellId, "cell-9");
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("update with value undefined deletes the key from the persisted file", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            store.update({ key: "cellId", value: makeCellIdState("cell-X") });
            await store.flushNow();

            store.update({ key: "cellId", value: undefined });
            await store.flushNow();

            store._resetCacheForTests();
            const value = await store.get("cellId");
            assert.strictEqual(value, undefined);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("backing file lives at globalStorageUri/state.json (cross-platform)", async () => {
        const context = makeContextForTests();
        try {
            const store = new LocalCellIdStore(context);
            const payload = makeCellIdState("cell-path-check");
            store.update({ key: "cellId", value: payload });
            await store.flushNow();

            const expectedUri = vscode.Uri.joinPath(context.globalStorageUri, "state.json");
            const stat = await vscode.workspace.fs.stat(expectedUri);
            assert.ok(stat.size > 0, "state.json should be written and non-empty");

            // Verify the content is valid JSON containing the cellId object.
            const bytes = await vscode.workspace.fs.readFile(expectedUri);
            const text = new TextDecoder("utf-8").decode(bytes);
            const parsed = JSON.parse(text);
            assert.deepStrictEqual(parsed.cellId, payload);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("malformed state.json is treated as empty and overwritten on next update", async () => {
        const context = makeContextForTests();
        try {
            // Pre-seed a malformed file.
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
            const fileUri = vscode.Uri.joinPath(context.globalStorageUri, "state.json");
            await vscode.workspace.fs.writeFile(
                fileUri,
                new TextEncoder().encode("this is not json")
            );

            const store = new LocalCellIdStore(context);
            const valueBefore = await store.get("cellId");
            assert.strictEqual(valueBefore, undefined, "malformed file → empty cache");

            const payload = makeCellIdState("cell-recovered");
            store.update({ key: "cellId", value: payload });
            await store.flushNow();

            store._resetCacheForTests();
            const valueAfter = await store.get("cellId");
            assert.deepStrictEqual(valueAfter, payload);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });
});
