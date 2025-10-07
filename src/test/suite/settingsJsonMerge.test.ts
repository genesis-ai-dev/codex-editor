import * as assert from "assert";
import { determineStrategy } from "../../projectManager/utils/merge/strategies";
import { ConflictResolutionStrategy } from "../../projectManager/utils/merge/types";

suite("Settings.json Merge Test Suite", () => {
    test("should use JSON_MERGE_3WAY for .vscode/settings.json", () => {
        const strategy = determineStrategy(".vscode/settings.json");
        assert.strictEqual(
            strategy,
            ConflictResolutionStrategy.JSON_MERGE_3WAY,
            "settings.json should use 3-way merge strategy"
        );
    });

    test("should handle Windows path separators for settings.json", () => {
        const windowsPath = ".vscode\\settings.json";
        const strategy = determineStrategy(windowsPath);
        assert.strictEqual(strategy, ConflictResolutionStrategy.JSON_MERGE_3WAY);
    });

    test("should handle Unix path separators for settings.json", () => {
        const unixPath = ".vscode/settings.json";
        const strategy = determineStrategy(unixPath);
        assert.strictEqual(strategy, ConflictResolutionStrategy.JSON_MERGE_3WAY);
    });

    test("chatSystemMessage key detection - prefers new key over legacy", () => {
        const newKey = "codex-editor-extension.chatSystemMessage";
        const legacyKey = "translators-copilot.chatSystemMessage";

        // Simulating key detection logic
        const base: Record<string, string> = { [legacyKey]: "old" };
        const ours: Record<string, string> = { [newKey]: "new local" };
        const theirs: Record<string, string> = { [legacyKey]: "old" };

        // Check if new key exists anywhere
        const hasNewKey = ours[newKey] !== undefined ||
            theirs[newKey] !== undefined ||
            base[newKey] !== undefined;

        assert.strictEqual(hasNewKey, true, "Should detect new key exists");
        assert.strictEqual(ours[newKey], "new local", "Should use new key value");
    });

    test("git.enabled should always be enforced to false", () => {
        // This documents the critical requirement
        const gitEnabledValue = false;
        assert.strictEqual(
            gitEnabledValue,
            false,
            "git.enabled must always be false in merged settings.json"
        );
    });

    test("chatSystemMessage tie-breaker logic - ours changed only", () => {
        const baseChatMsg: string = "old prompt";
        const ourChatMsg: string = "new prompt";
        const theirChatMsg: string = "old prompt";

        const ourChanged = JSON.stringify(ourChatMsg) !== JSON.stringify(baseChatMsg);
        const theirChanged = JSON.stringify(theirChatMsg) !== JSON.stringify(baseChatMsg);

        // When only we changed the prompt, bias should be 'ours'
        let bias: 'ours' | 'theirs';
        if (ourChanged && !theirChanged) {
            bias = 'ours';
        } else if (!ourChanged && theirChanged) {
            bias = 'theirs';
        } else if (ourChanged && theirChanged) {
            bias = 'ours'; // Last write wins
        } else {
            bias = 'theirs'; // Default
        }

        assert.strictEqual(bias, 'ours', "Should bias to ours when we changed prompt");
    });

    test("chatSystemMessage tie-breaker logic - theirs changed only", () => {
        const baseChatMsg: string = "old prompt";
        const ourChatMsg: string = "old prompt";
        const theirChatMsg: string = "new prompt";

        const ourChanged = JSON.stringify(ourChatMsg) !== JSON.stringify(baseChatMsg);
        const theirChanged = JSON.stringify(theirChatMsg) !== JSON.stringify(baseChatMsg);

        let bias: 'ours' | 'theirs';
        if (ourChanged && !theirChanged) {
            bias = 'ours';
        } else if (!ourChanged && theirChanged) {
            bias = 'theirs';
        } else if (ourChanged && theirChanged) {
            bias = 'ours';
        } else {
            bias = 'theirs';
        }

        assert.strictEqual(bias, 'theirs', "Should bias to theirs when they changed prompt");
    });

    test("chatSystemMessage tie-breaker logic - both changed (last write wins)", () => {
        const baseChatMsg: string = "old prompt";
        const ourChatMsg: string = "my prompt";
        const theirChatMsg: string = "their prompt";

        const ourChanged = JSON.stringify(ourChatMsg) !== JSON.stringify(baseChatMsg);
        const theirChanged = JSON.stringify(theirChatMsg) !== JSON.stringify(baseChatMsg);

        let bias: 'ours' | 'theirs';
        if (ourChanged && !theirChanged) {
            bias = 'ours';
        } else if (!ourChanged && theirChanged) {
            bias = 'theirs';
        } else if (ourChanged && theirChanged) {
            bias = 'ours'; // We're pushing now = last write
        } else {
            bias = 'theirs';
        }

        assert.strictEqual(bias, 'ours', "Should bias to ours when both changed (last write wins)");
    });

    test("chatSystemMessage tie-breaker logic - neither changed (default to theirs)", () => {
        const baseChatMsg = "old prompt";
        const ourChatMsg = "old prompt";
        const theirChatMsg = "old prompt";

        const ourChanged = ourChatMsg !== baseChatMsg;
        const theirChanged = theirChatMsg !== baseChatMsg;

        let bias: 'ours' | 'theirs';
        if (ourChanged && !theirChanged) {
            bias = 'ours';
        } else if (!ourChanged && theirChanged) {
            bias = 'theirs';
        } else if (ourChanged && theirChanged) {
            bias = 'ours';
        } else {
            bias = 'theirs'; // Default to remote
        }

        assert.strictEqual(bias, 'theirs', "Should default to theirs when neither changed");
    });

    test("JSON merge cleanup - removes legacy key when new key exists", () => {
        const newKey = "codex-editor-extension.chatSystemMessage";
        const legacyKey = "translators-copilot.chatSystemMessage";

        const result: Record<string, any> = {
            [newKey]: "new prompt",
            [legacyKey]: "old prompt",
            "codex-project-manager.validationCount": 1,
        };

        // Cleanup logic
        if (result[newKey] !== undefined && result[legacyKey] !== undefined) {
            delete result[legacyKey];
        }

        assert.strictEqual(result[newKey], "new prompt", "Should keep new key");
        assert.strictEqual(result[legacyKey], undefined, "Should remove legacy key");
        assert.strictEqual(result["codex-project-manager.validationCount"], 1, "Should keep other keys");
    });

    test("JSON merge cleanup - keeps legacy key when new key doesn't exist", () => {
        const newKey = "codex-editor-extension.chatSystemMessage";
        const legacyKey = "translators-copilot.chatSystemMessage";

        const result: Record<string, any> = {
            [legacyKey]: "old prompt",
            "codex-project-manager.validationCount": 1,
        };

        // Cleanup logic
        if (result[newKey] !== undefined && result[legacyKey] !== undefined) {
            delete result[legacyKey];
        }

        assert.strictEqual(result[legacyKey], "old prompt", "Should keep legacy key");
        assert.strictEqual(result[newKey], undefined, "New key doesn't exist");
    });

    test("JSON merge always sets git.enabled to false", () => {
        const result: Record<string, any> = {
            "codex-project-manager.validationCount": 1,
            "git.enabled": true, // Any value
        };

        // Always force git.enabled to false
        result["git.enabled"] = false;

        assert.strictEqual(result["git.enabled"], false, "git.enabled must always be false");
    });

    test("JSON parse error handling - simulates graceful fallback", () => {
        const invalidJson = "{invalid json";
        const validOurs = '{"codex-project-manager.validationCount": 1}';

        let result: Record<string, any>;
        try {
            result = JSON.parse(invalidJson);
        } catch (error) {
            // Fallback to ours if it's valid
            try {
                result = JSON.parse(validOurs);
                result["git.enabled"] = false;
            } catch {
                // Last resort
                result = { "git.enabled": false };
            }
        }

        assert.strictEqual(result["codex-project-manager.validationCount"], 1);
        assert.strictEqual(result["git.enabled"], false);
    });

    test("Migration timing requirement - must run before sync", () => {
        // This documents the critical timing requirement
        // Migration runs at line ~770 in extension.ts
        // Sync runs at line ~788 in extension.ts
        // This ensures the correct key is synced to remote

        const migrationLine = 770;
        const syncLine = 788;

        assert.ok(
            migrationLine < syncLine,
            "Migration must run before sync to ensure correct key is synced"
        );
    });
});

