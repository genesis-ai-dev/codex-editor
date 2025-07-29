import * as assert from "assert";
import * as vscode from "vscode";
import { determineStrategy } from "../../projectManager/utils/merge/strategies";
import { ConflictResolutionStrategy } from "../../projectManager/utils/merge/types";

suite("Merge Strategies Test Suite", () => {
    test("should use CODEX_CUSTOM_MERGE for .source files", () => {
        // Test .source files in the standard location
        const sourceFileInStandardLocation = ".project/sourceTexts/GEN.source";
        const strategy1 = determineStrategy(sourceFileInStandardLocation);
        assert.strictEqual(strategy1, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);

        // Test .source files in other locations
        const sourceFileInOtherLocation = "files/target/GEN.source";
        const strategy2 = determineStrategy(sourceFileInOtherLocation);
        assert.strictEqual(strategy2, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);

        // Test .source files in root directory
        const sourceFileInRoot = "GEN.source";
        const strategy3 = determineStrategy(sourceFileInRoot);
        assert.strictEqual(strategy3, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);
    });

    test("should use CODEX_CUSTOM_MERGE for .codex files", () => {
        const codexFile = "files/target/GEN.codex";
        const strategy = determineStrategy(codexFile);
        assert.strictEqual(strategy, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);
    });

    test("should use appropriate strategies for other file types", () => {
        // Test OVERRIDE strategy
        const metadataFile = "metadata.json";
        const strategy1 = determineStrategy(metadataFile);
        assert.strictEqual(strategy1, ConflictResolutionStrategy.OVERRIDE);

        // Test ARRAY strategy
        const commentsFile = "file-comments.json";
        const strategy2 = determineStrategy(commentsFile);
        assert.strictEqual(strategy2, ConflictResolutionStrategy.ARRAY);

        // Test JSONL strategy
        const dictionaryFile = "files/project.dictionary";
        const strategy3 = determineStrategy(dictionaryFile);
        assert.strictEqual(strategy3, ConflictResolutionStrategy.JSONL);

        // Test SPECIAL strategy
        const smartEditsFile = "files/smart_edits.json";
        const strategy4 = determineStrategy(smartEditsFile);
        assert.strictEqual(strategy4, ConflictResolutionStrategy.SPECIAL);

        // Test IGNORE strategy
        const completeDraftsFile = "complete_drafts.txt";
        const strategy5 = determineStrategy(completeDraftsFile);
        assert.strictEqual(strategy5, ConflictResolutionStrategy.IGNORE);
    });

    test("should default to OVERRIDE for unknown file types", () => {
        const unknownFile = "unknown_file.txt";
        const strategy = determineStrategy(unknownFile);
        assert.strictEqual(strategy, ConflictResolutionStrategy.OVERRIDE);
    });

    test("should handle path separators correctly", () => {
        // Test with Windows-style path separators
        const windowsPath = ".project\\sourceTexts\\GEN.source";
        const strategy1 = determineStrategy(windowsPath);
        assert.strictEqual(strategy1, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);

        // Test with Unix-style path separators
        const unixPath = ".project/sourceTexts/GEN.source";
        const strategy2 = determineStrategy(unixPath);
        assert.strictEqual(strategy2, ConflictResolutionStrategy.CODEX_CUSTOM_MERGE);
    });
});