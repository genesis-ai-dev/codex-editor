import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migration_addImporterTypeToMetadata } from "../projectManager/utils/migrationUtils";

async function createTempNotebookWithMetadata(
    metadata: {
        importerType?: string;
        corpusMarker?: string;
        [key: string]: any;
    }
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `importer-type-test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: [
            {
                kind: 2,
                languageId: "scripture",
                value: "test content",
                metadata: {
                    id: "cell-1",
                },
            },
        ],
        metadata: metadata,
    };

    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

describe("migration_addImporterTypeToMetadata", () => {
    it("standardizes old importerType values", async () => {
        const uri = await createTempNotebookWithMetadata({
            importerType: "ebiblecorpus",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, "ebible");
    });

    it("infers importerType from corpusMarker when missing", async () => {
        const uri = await createTempNotebookWithMetadata({
            corpusMarker: "pdf",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, "pdf");
    });

    it("prefers existing importerType over corpusMarker", async () => {
        const uri = await createTempNotebookWithMetadata({
            importerType: "usfm",
            corpusMarker: "pdf",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, "usfm");
    });

    it("handles special case mappings", async () => {
        const testCases = [
            { corpusMarker: "ebiblecorpus", expected: "ebible" },
            { corpusMarker: "macula-bible", expected: "macula" },
            { corpusMarker: "obs-story", expected: "obs" },
            { corpusMarker: "subtitle", expected: "subtitles" },
            { corpusMarker: "docx", expected: "docx-roundtrip" },
        ];

        for (const testCase of testCases) {
            const uri = await createTempNotebookWithMetadata({
                corpusMarker: testCase.corpusMarker,
            });

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

            await migration_addImporterTypeToMetadata();

            const fileBytes = await vscode.workspace.fs.readFile(uri);
            const serializer = new CodexContentSerializer();
            const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

            assert.strictEqual(
                data.metadata.importerType,
                testCase.expected,
                `Failed for corpusMarker: ${testCase.corpusMarker}`
            );
        }
    });

    it("removes invalid importerType values", async () => {
        const uri = await createTempNotebookWithMetadata({
            importerType: "invalid-type",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, undefined);
    });

    it("is idempotent - does not modify already migrated files", async () => {
        const uri = await createTempNotebookWithMetadata({
            importerType: "usfm",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();
        // Run again - should be skipped due to migration flag
        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, "usfm");
    });

    it("handles case-insensitive matching", async () => {
        const uri = await createTempNotebookWithMetadata({
            importerType: "EBIBLE",
        });

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("importerTypeMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_addImporterTypeToMetadata();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        assert.strictEqual(data.metadata.importerType, "ebible");
    });
});

