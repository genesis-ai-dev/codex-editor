import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { NotebookPreview } from "../../../../types";
import { updateExistingImportPair } from "../../../providers/NewSourceUploader/updateExistingImport";
import type { ReimportNotebook } from "../../../providers/NewSourceUploader/reimportMerge";

suite("DOCX update-existing safety", () => {
    const pair = {
        notebookBaseName: "lesson", displayName: "Lesson",
        sourceUri: vscode.Uri.parse("docx-update-safety-test:/lesson.source"),
        codexUri: vscode.Uri.parse("docx-update-safety-test:/lesson.codex"),
    };
    const notebook = (id: string, value: string, importerType: string): ReimportNotebook => ({
        metadata: { importerType },
        cells: [{ kind: 2, value, metadata: { id, type: "text", data: {}, edits: [] } }],
    });
    let sandbox: sinon.SinonSandbox;
    let files: Map<string, Uint8Array>;
    let writes: number;
    let registration: vscode.Disposable;
    let events: vscode.EventEmitter<vscode.FileChangeEvent[]>;

    setup(() => {
        sandbox = sinon.createSandbox();
        files = new Map();
        writes = 0;
        events = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        registration = vscode.workspace.registerFileSystemProvider("docx-update-safety-test", {
            onDidChangeFile: events.event,
            watch: () => ({ dispose() {} }),
            stat: (uri) => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: files.get(uri.path)?.length ?? 0 }),
            readDirectory: () => [],
            createDirectory: () => {},
            readFile: (uri) => {
                const content = files.get(uri.path);
                if (!content) throw vscode.FileSystemError.FileNotFound(uri);
                return content;
            },
            writeFile: (uri, content) => { writes++; files.set(uri.path, content); },
            delete: (uri) => { files.delete(uri.path); },
            rename: () => { throw new Error("Unexpected rename"); },
        });
    });
    teardown(() => {
        sandbox.restore();
        registration.dispose();
        events.dispose();
    });

    for (const scenario of ["cancel", "confirm", "other-format", "matched"] as const) {
        test(`${scenario}: checks before any notebook write`, async () => {
            const importer = scenario === "other-format" ? "markdown" : "docx";
            files.set(pair.sourceUri.path, new TextEncoder().encode(JSON.stringify(notebook("old", "<p>Original sentence.</p>", importer))));
            files.set(pair.codexUri.path, new TextEncoder().encode(JSON.stringify(notebook("old", "<p>Traducción.</p>", importer))));
            const originalFiles = new Map(files);
            const warning = sandbox.stub(vscode.window, "showWarningMessage");
            warning.callsFake(async () => {
                assert.strictEqual(writes, 0);
                return scenario === "confirm" ? "Update Anyway" as never : undefined;
            });
            const freshSource = notebook("new", scenario === "matched" ? "<p>Original sentence.</p>" : "<p>Different text.</p>", importer);
            const result = await updateExistingImportPair(pair,
                freshSource as unknown as NotebookPreview,
                notebook("new", "", importer) as unknown as NotebookPreview);
            assert.strictEqual(Boolean(result.cancelled), scenario === "cancel");
            assert.strictEqual(writes, scenario === "cancel" ? 0 : 2);
            if (scenario === "cancel") assert.deepStrictEqual(files, originalFiles);
            assert.strictEqual(warning.callCount, ["cancel", "confirm"].includes(scenario) ? 1 : 0);
        });
    }
});
