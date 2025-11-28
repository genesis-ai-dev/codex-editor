import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migration_moveTimestampsToMetadataData } from "../projectManager/utils/migrationUtils";

async function createTempNotebookWithLegacyTimestamps(
    timestamps: {
        startTime?: number;
        endTime?: number;
        format?: string;
        originalText?: string;
    },
    dataTimestamps?: {
        startTime?: number;
        endTime?: number;
        format?: string;
        originalText?: string;
    }
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `timestamp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: [
            {
                kind: 2,
                languageId: "html",
                value: "<p>Test</p>",
                metadata: {
                    id: "cell-1",
                    ...timestamps,
                    data: {
                        ...dataTimestamps,
                    },
                    edits: [],
                },
            },
        ],
        metadata: {},
    };

    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

describe("migration_moveTimestampsToMetadataData", () => {
    it("moves top-level timestamps to metadata.data when missing", async () => {
        const uri = await createTempNotebookWithLegacyTimestamps({
            startTime: 10,
            endTime: 20,
            format: "vtt",
            originalText: "test",
        });

        // Clear migration flag to allow re-running
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("timestampsDataMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_moveTimestampsToMetadataData();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        assert.strictEqual(cell.metadata.data.startTime, 10);
        assert.strictEqual(cell.metadata.data.endTime, 20);
        assert.strictEqual(cell.metadata.data.format, "vtt");
        assert.strictEqual(cell.metadata.data.originalText, "test");
        assert.strictEqual(cell.metadata.startTime, undefined);
        assert.strictEqual(cell.metadata.endTime, undefined);
        assert.strictEqual(cell.metadata.format, undefined);
        assert.strictEqual(cell.metadata.originalText, undefined);
    });

    it("preserves existing metadata.data values and does not overwrite", async () => {
        const uri = await createTempNotebookWithLegacyTimestamps(
            {
                startTime: 10,
                endTime: 20,
            },
            {
                startTime: 5,
                endTime: 15,
            }
        );

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("timestampsDataMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_moveTimestampsToMetadataData();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        // Should preserve existing data values
        assert.strictEqual(cell.metadata.data.startTime, 5);
        assert.strictEqual(cell.metadata.data.endTime, 15);
        // Legacy top-level values should be removed
        assert.strictEqual(cell.metadata.startTime, undefined);
        assert.strictEqual(cell.metadata.endTime, undefined);
    });

    it("is idempotent - does not duplicate data on second run", async () => {
        const uri = await createTempNotebookWithLegacyTimestamps({
            startTime: 10,
            endTime: 20,
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("timestampsDataMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_moveTimestampsToMetadataData();

        // Run again - should be skipped due to migration flag
        await migration_moveTimestampsToMetadataData();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        assert.strictEqual(cell.metadata.data.startTime, 10);
        assert.strictEqual(cell.metadata.data.endTime, 20);
    });

    it("handles partial timestamp data", async () => {
        const uri = await createTempNotebookWithLegacyTimestamps({
            startTime: 10,
            // endTime missing
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("timestampsDataMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_moveTimestampsToMetadataData();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        assert.strictEqual(cell.metadata.data.startTime, 10);
        assert.strictEqual(cell.metadata.startTime, undefined);
    });
});

