import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migration_promoteCellTypeToTopLevel } from "../projectManager/utils/migrationUtils";

async function createTempNotebookWithDataType(typeInData: string | undefined, typeTopLevel?: string): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    // Use os.tmpdir() for test environment compatibility
    const tmpDir = os.tmpdir();
    const fileName = `type-test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: [
            {
                kind: 2,
                languageId: "html",
                value: "<p>Test</p>",
                metadata: {
                    id: "cell-1",
                    ...(typeTopLevel !== undefined ? { type: typeTopLevel } : {}),
                    data: {
                        ...(typeInData !== undefined ? { type: typeInData } : {}),
                        startTime: 0,
                        endTime: 1
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

describe("migration_promoteCellTypeToTopLevel", () => {
    it("promotes metadata.data.type to top-level when missing and deletes data.type", async () => {
        const uri = await createTempNotebookWithDataType("text");
        await migration_promoteCellTypeToTopLevel();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        assert.strictEqual(typeof cell.metadata.type, "string");
        assert.ok(!("type" in (cell.metadata.data || {})), "metadata.data.type should be removed");
    });

    it("does not override top-level type if already present", async () => {
        const uri = await createTempNotebookWithDataType("text", "paratext");
        await migration_promoteCellTypeToTopLevel();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const cell = data.cells[0];
        assert.strictEqual(cell.metadata.type, "paratext");
        // data.type may still exist; promotion only happens when top-level type is missing
    });
});


