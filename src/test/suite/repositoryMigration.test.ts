import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RepositoryMigrationManager } from "../../projectManager/utils/repositoryMigration";

suite("Repository Migration Test Suite", () => {
    let tempDir: string;
    let migrationManager: RepositoryMigrationManager;

    setup(async () => {
        // Create a temporary directory for testing
        tempDir = path.join(__dirname, "test-migration-" + Date.now());
        await fs.promises.mkdir(tempDir, { recursive: true });

        migrationManager = RepositoryMigrationManager.getInstance();
    });

    teardown(async () => {
        // Clean up temporary directory
        try {
            await fs.promises.rmdir(tempDir, { recursive: true });
        } catch (error) {
            console.warn("Failed to clean up test directory:", error);
        }
    });

    test("should detect fresh clone", async () => {
        // Create a mock .git directory (fresh)
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        const state = await migrationManager.checkMigrationRequired(tempDir);

        assert.strictEqual(state.isFreshClone, true, "Should detect fresh clone");
        assert.strictEqual(state.needsMigration, false, "Fresh clone should not need migration");
    });

    test("should create migration file", async () => {
        // Create a mock project directory
        const projectDir = path.join(tempDir, ".project");
        await fs.promises.mkdir(projectDir, { recursive: true });

        await migrationManager.createMigrationFile(tempDir);

        // Check that migration file was created
        const migrationFilePath = path.join(tempDir, ".project", "migration.json");
        const migrationFileExists = await fs.promises.access(migrationFilePath).then(() => true).catch(() => false);

        assert.ok(migrationFileExists, "Migration file should be created");

        // Verify migration file content
        const migrationContent = JSON.parse(await fs.promises.readFile(migrationFilePath, "utf8"));

        assert.ok(migrationContent.version, "Migration file should have version");
        assert.ok(migrationContent.migrations, "Migration file should have migrations object");
        assert.ok(migrationContent.migrations.repository_structure, "Migration file should have repository_structure migration");
        assert.strictEqual(migrationContent.migrations.repository_structure.completed, true, "Migration should be marked as completed");
    });

    test("should detect completed migration", async () => {
        // Create migration file first
        await migrationManager.createMigrationFile(tempDir);

        const isCompleted = await migrationManager.isMigrationCompleted(tempDir);

        assert.strictEqual(isCompleted, true, "Should detect completed migration");
    });

    test("should check static migration needs", async () => {
        // Create a mock .git directory (not fresh)
        const gitDir = path.join(tempDir, ".git");
        await fs.promises.mkdir(gitDir, { recursive: true });

        // Make it old (more than 24 hours ago)
        const oldDate = new Date(Date.now() - (25 * 60 * 60 * 1000)); // 25 hours ago
        await fs.promises.utimes(gitDir, oldDate, oldDate);

        const result = await RepositoryMigrationManager.checkProjectNeedsMigrationStatic(tempDir);

        assert.strictEqual(result.isFreshClone, false, "Should not be fresh clone");
    });
}); 