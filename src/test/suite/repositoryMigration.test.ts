import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { RepositoryMigrationManager } from "../../projectManager/utils/repositoryMigration";

suite("Repository Migration Test Suite", () => {
    let tempDir: string;
    let migrationManager: RepositoryMigrationManager;

    setup(async () => {
        // Create a temporary directory for testing
        tempDir = path.join(__dirname, "temp-migration-test");
        await fs.promises.mkdir(tempDir, { recursive: true });

        migrationManager = RepositoryMigrationManager.getInstance();
    });

    teardown(async () => {
        // Clean up temporary directory
        try {
            await fs.promises.rmdir(tempDir, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    test("should detect fresh clone and skip migration", async () => {
        // Create a mock .git directory with recent timestamp
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        // Touch the .git directory to make it fresh (current time)
        const now = new Date();
        await fs.promises.utimes(gitDir, now, now);

        const state = await migrationManager.checkMigrationRequired(tempDir);

        assert.strictEqual(state.isFreshClone, true, "Should detect fresh clone");
        assert.strictEqual(state.hasUserMigrationFlag, false, "Fresh clone should not have user migration flag");
    });

    test("should create user-specific migration flag", async () => {
        // Create a mock project directory
        const codexDir = path.join(tempDir, ".codex");
        await fs.promises.mkdir(codexDir, { recursive: true });

        await migrationManager.createUserMigrationFlag(tempDir);

        // Check that user-specific flag was created
        const files = await fs.promises.readdir(codexDir);
        const userMigrationFile = files.find(file => file.startsWith("user_migration_"));

        assert.ok(userMigrationFile, "User-specific migration flag should be created");

        // Verify flag content
        const flagPath = path.join(codexDir, userMigrationFile);
        const flagContent = JSON.parse(await fs.promises.readFile(flagPath, "utf8"));

        assert.ok(flagContent.migrationDate, "Flag should have migration date");
        assert.ok(flagContent.user, "Flag should have user identifier");
        assert.strictEqual(flagContent.reason, "SQLite files cleanup migration", "Flag should have correct reason");
    });

    test("should detect existing user migration flag", async () => {
        // Create user migration flag first
        await migrationManager.createUserMigrationFlag(tempDir);

        const state = await migrationManager.checkMigrationRequired(tempDir);

        assert.strictEqual(state.hasUserMigrationFlag, true, "Should detect existing user migration flag");
    });

    test("should handle multiple users with different migration states", async () => {
        // Create a mock .git directory (not fresh)
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        // Make it old (more than 24 hours ago)
        const oldDate = new Date(Date.now() - (25 * 60 * 60 * 1000)); // 25 hours ago
        await fs.promises.utimes(gitDir, oldDate, oldDate);

        // Create user migration flag for a different user manually
        const codexDir = path.join(tempDir, ".codex");
        await fs.promises.mkdir(codexDir, { recursive: true });

        const otherUserFlag = path.join(codexDir, "user_migration_other_user");
        await fs.promises.writeFile(otherUserFlag, JSON.stringify({
            migrationDate: new Date().toISOString(),
            user: "other_user",
            reason: "SQLite files cleanup migration"
        }));

        const state = await migrationManager.checkMigrationRequired(tempDir);

        // Current user should not have migration flag, even though another user does
        assert.strictEqual(state.hasUserMigrationFlag, false, "Current user should not have migration flag");
        assert.strictEqual(state.isFreshClone, false, "Should not be fresh clone");
    });

    test("static migration check should work without opening project", async () => {
        // Create a mock .git directory (not fresh)
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        // Make it old
        const oldDate = new Date(Date.now() - (25 * 60 * 60 * 1000));
        await fs.promises.utimes(gitDir, oldDate, oldDate);

        // Create a mock remote
        const configPath = path.join(gitDir, "config");
        await fs.promises.writeFile(configPath, `
[core]
    repositoryformatversion = 0
[remote "origin"]
    url = https://example.com/repo.git
    fetch = +refs/heads/*:refs/remotes/origin/*
`);

        const result = await RepositoryMigrationManager.checkProjectNeedsMigrationStatic(tempDir);

        assert.strictEqual(result.needsMigration, true, "Should need migration");
        assert.strictEqual(result.hasRemote, true, "Should detect remote");
        assert.strictEqual(result.isFreshClone, false, "Should not be fresh clone");
        assert.strictEqual(result.hasUserMigrationFlag, false, "Should not have user migration flag");
    });

    test("should skip migration for fresh clone in static check", async () => {
        // Create a fresh .git directory
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        const result = await RepositoryMigrationManager.checkProjectNeedsMigrationStatic(tempDir);

        assert.strictEqual(result.needsMigration, false, "Fresh clone should not need migration");
        assert.strictEqual(result.isFreshClone, true, "Should detect fresh clone");
    });

    test("should respect suppression flag", async () => {
        // Create suppression flag
        const codexDir = path.join(tempDir, ".codex");
        await fs.promises.mkdir(codexDir, { recursive: true });

        const suppressionPath = path.join(codexDir, "migration_suppressed");
        await fs.promises.writeFile(suppressionPath, JSON.stringify({
            suppressionDate: new Date().toISOString(),
            reason: "User chose not to migrate"
        }));

        const state = await migrationManager.checkMigrationRequired(tempDir);

        assert.strictEqual(state.hasSuppression, true, "Should detect suppression flag");
    });
}); 