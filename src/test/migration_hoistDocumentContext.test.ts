import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migration_hoistDocumentContextToNotebookMetadata } from "../projectManager/utils/migrationUtils";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createTempNotebook(notebook: vscode.NotebookData, ext: "codex" | "source" = "codex"): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `document-context-test-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));
    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

async function readNotebook(uri: vscode.Uri): Promise<any> {
    const serializer = new CodexContentSerializer();
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    return await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);
}

describe("migration_hoistDocumentContextToNotebookMetadata", () => {
    it("hoists from cell.metadata.documentContext and removes hoisted keys from cells", async () => {
        const notebook = {
            cells: [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "test",
                    metadata: {
                        id: "cell-1",
                        documentContext: {
                            importerType: "docx-roundtrip",
                            fileName: "example.docx",
                            originalHash: "hash-1",
                        },
                    },
                },
            ],
            metadata: {
                id: "nb-1",
                originalName: "nb",
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                corpusMarker: "docx",
            },
        } as unknown as vscode.NotebookData;
        const uri = await createTempNotebook(notebook);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("documentContextHoistMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_hoistDocumentContextToNotebookMetadata();

        const dataUnknown = await readNotebook(uri);
        assert.ok(isRecord(dataUnknown));
        const data = dataUnknown;
        assert.ok(isRecord(data["metadata"]));
        const md = data["metadata"] as Record<string, unknown>;

        assert.strictEqual(md["importerType"], "docx-roundtrip");
        assert.strictEqual(md["originalFileName"], "example.docx");
        assert.ok(isRecord(md["importContext"]));
        const importContext = md["importContext"] as Record<string, unknown>;
        assert.strictEqual(importContext["fileName"], "example.docx");
        assert.strictEqual(importContext["originalHash"], "hash-1");

        assert.ok(Array.isArray(data["cells"]));
        const cells = data["cells"] as Array<Record<string, unknown>>;
        assert.ok(isRecord(cells[0]?.["metadata"]));
        const cellMd = cells[0]["metadata"] as Record<string, unknown>;
        // documentContext should be removed entirely (all keys hoisted)
        assert.strictEqual(cellMd["documentContext"], undefined);
    });

    it("hoists from cell.metadata.data.documentContext and preserves non-hoisted keys", async () => {
        const notebook = {
            cells: [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "test",
                    metadata: {
                        id: "cell-1",
                        data: {
                            documentContext: {
                                importerType: "indesign",
                                fileName: "example.idml",
                                originalHash: "hash-2",
                                // non-hoisted key (object) should remain
                                extra: { nested: true },
                            },
                        },
                    },
                },
            ],
            metadata: {
                id: "nb-1",
                originalName: "nb",
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                corpusMarker: "indesign",
            },
        } as unknown as vscode.NotebookData;
        const uri = await createTempNotebook(notebook);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("documentContextHoistMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_hoistDocumentContextToNotebookMetadata();

        const dataUnknown = await readNotebook(uri);
        assert.ok(isRecord(dataUnknown));
        const data = dataUnknown;
        assert.ok(isRecord(data["metadata"]));
        const md = data["metadata"] as Record<string, unknown>;
        assert.strictEqual(md["importerType"], "indesign");
        assert.strictEqual(md["originalFileName"], "example.idml");
        assert.ok(isRecord(md["importContext"]));
        const importContext = md["importContext"] as Record<string, unknown>;
        assert.strictEqual(importContext["fileName"], "example.idml");
        assert.strictEqual(importContext["originalHash"], "hash-2");

        assert.ok(Array.isArray(data["cells"]));
        const cells = data["cells"] as Array<Record<string, unknown>>;
        assert.ok(isRecord(cells[0]?.["metadata"]));
        const cellMd = cells[0]["metadata"] as Record<string, unknown>;
        assert.ok(isRecord(cellMd["data"]));
        const cellData = cellMd["data"] as Record<string, unknown>;
        assert.ok(isRecord(cellData["documentContext"]));
        const ctx = cellData["documentContext"] as Record<string, unknown>;
        // extra should remain because it was not hoisted (non-primitive)
        assert.deepStrictEqual(ctx, { extra: { nested: true } });
    });

    it("does not hoist inconsistent values across cells", async () => {
        const notebook = {
            cells: [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "a",
                    metadata: {
                        id: "cell-1",
                        documentContext: { fileName: "a.docx" },
                    },
                },
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "b",
                    metadata: {
                        id: "cell-2",
                        documentContext: { fileName: "b.docx" },
                    },
                },
            ],
            metadata: {
                id: "nb-1",
                originalName: "nb",
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                corpusMarker: "docx",
            },
        } as unknown as vscode.NotebookData;
        const uri = await createTempNotebook(notebook);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("documentContextHoistMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_hoistDocumentContextToNotebookMetadata();

        const dataUnknown = await readNotebook(uri);
        assert.ok(isRecord(dataUnknown));
        const data = dataUnknown;
        // fileName not hoisted due to inconsistency
        assert.ok(isRecord(data["metadata"]));
        const md = data["metadata"] as Record<string, unknown>;
        assert.strictEqual(md["originalFileName"], undefined);
        const importContext = md["importContext"];
        if (importContext !== undefined) {
            assert.ok(isRecord(importContext));
            assert.strictEqual((importContext as Record<string, unknown>)["fileName"], undefined);
        }

        // per-cell contexts should remain
        assert.ok(Array.isArray(data["cells"]));
        const cells = data["cells"] as Array<Record<string, unknown>>;
        const md0 = (cells[0]["metadata"] as Record<string, unknown>)["documentContext"] as Record<string, unknown>;
        const md1 = (cells[1]["metadata"] as Record<string, unknown>)["documentContext"] as Record<string, unknown>;
        assert.strictEqual(md0["fileName"], "a.docx");
        assert.strictEqual(md1["fileName"], "b.docx");
    });

    it("is idempotent (gated by migration flag)", async () => {
        const notebook = {
            cells: [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "test",
                    metadata: {
                        id: "cell-1",
                        documentContext: { fileName: "example.docx" },
                    },
                },
            ],
            metadata: {
                id: "nb-1",
                originalName: "nb",
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                corpusMarker: "docx",
            },
        } as unknown as vscode.NotebookData;
        const uri = await createTempNotebook(notebook);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("documentContextHoistMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_hoistDocumentContextToNotebookMetadata();
        await migration_hoistDocumentContextToNotebookMetadata();

        const dataUnknown = await readNotebook(uri);
        assert.ok(isRecord(dataUnknown));
        const data = dataUnknown;
        assert.ok(isRecord(data["metadata"]));
        const md = data["metadata"] as Record<string, unknown>;
        assert.strictEqual(md["originalFileName"], "example.docx");
    });
});


