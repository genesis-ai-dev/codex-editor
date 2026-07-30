import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { runOnce, loadFlags, isFlagSet, setFlag } from "../../utils/oneTimeMigrations";

function makeContextForTests(): vscode.ExtensionContext {
    const dir = path.join(
        os.tmpdir(),
        `codex-onetime-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

suite("oneTimeMigrations", () => {
    test("loadFlags returns empty when migrations.json is missing", async () => {
        const context = makeContextForTests();
        try {
            const flags = await loadFlags(context);
            assert.deepStrictEqual(flags, {});
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("runOnce executes fn the first time and persists the flag", async () => {
        const context = makeContextForTests();
        try {
            let calls = 0;
            await runOnce(context, "demoMigrationV1", async () => {
                calls += 1;
            });
            assert.strictEqual(calls, 1);
            const flagged = await isFlagSet(context, "demoMigrationV1");
            assert.strictEqual(flagged, true);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("runOnce skips fn on a second invocation with the same id", async () => {
        const context = makeContextForTests();
        try {
            let calls = 0;
            await runOnce(context, "demoMigrationV1", async () => {
                calls += 1;
            });
            await runOnce(context, "demoMigrationV1", async () => {
                calls += 1;
            });
            assert.strictEqual(calls, 1, "fn should run exactly once");
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("runOnce does NOT mark the flag if fn throws (so the migration retries)", async () => {
        const context = makeContextForTests();
        try {
            await assert.rejects(
                runOnce(context, "flakyMigration", async () => {
                    throw new Error("boom");
                })
            );
            const flagged = await isFlagSet(context, "flakyMigration");
            assert.strictEqual(flagged, false);

            // Subsequent successful run should set the flag normally.
            let calls = 0;
            await runOnce(context, "flakyMigration", async () => {
                calls += 1;
            });
            assert.strictEqual(calls, 1);
            assert.strictEqual(await isFlagSet(context, "flakyMigration"), true);
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("multiple migrations coexist in the same migrations.json", async () => {
        const context = makeContextForTests();
        try {
            await runOnce(context, "migrationA", async () => undefined);
            await runOnce(context, "migrationB", async () => undefined);
            const flags = await loadFlags(context);
            assert.ok(flags.migrationA, "migrationA flag should be set");
            assert.ok(flags.migrationB, "migrationB flag should be set");
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });

    test("setFlag is idempotent and overwrites the timestamp", async () => {
        const context = makeContextForTests();
        try {
            await setFlag(context, "manualFlag");
            const before = (await loadFlags(context)).manualFlag.ranAt;
            // Wait a tick to ensure the second timestamp differs.
            await new Promise((r) => setTimeout(r, 10));
            await setFlag(context, "manualFlag");
            const after = (await loadFlags(context)).manualFlag.ranAt;
            assert.ok(before !== after, "ranAt should refresh on re-set");
        } finally {
            await safeDelete(context.globalStorageUri);
        }
    });
});
