import * as assert from "assert";
import * as vscode from "vscode";
import {
    areCodexProjectMigrationsComplete,
    CODEX_PROJECT_MIGRATION_FLAG_KEYS,
} from "../projectManager/utils/migrationCompletionUtils";

describe("areCodexProjectMigrationsComplete", () => {
    it("returns complete when all known migration flags are true", async () => {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        for (const key of CODEX_PROJECT_MIGRATION_FLAG_KEYS) {
            await config.update(key, true, vscode.ConfigurationTarget.Workspace);
        }

        const status = areCodexProjectMigrationsComplete();
        assert.strictEqual(status.complete, true);
        assert.deepStrictEqual(status.incompleteKeys, []);
    });

    it("returns incomplete when any migration flag is false", async () => {
        const config = vscode.workspace.getConfiguration("codex-project-manager");

        for (const key of CODEX_PROJECT_MIGRATION_FLAG_KEYS) {
            await config.update(key, true, vscode.ConfigurationTarget.Workspace);
        }

        const firstKey = CODEX_PROJECT_MIGRATION_FLAG_KEYS[0];
        await config.update(firstKey, false, vscode.ConfigurationTarget.Workspace);

        const status = areCodexProjectMigrationsComplete();
        assert.strictEqual(status.complete, false);
        assert.ok(status.incompleteKeys.includes(firstKey));
    });
});

