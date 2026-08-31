import * as assert from "assert";
import * as os from "os";
import * as vscode from "vscode";
import sinon from "sinon";
import type { NotebookPreview } from "../../../types";
import type { ProcessedNotebook, NotebookPair } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import type { WriteNotebooksMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import { NewSourceUploaderProvider } from "../../providers/NewSourceUploader/NewSourceUploaderProvider";
import { findExistingImportPairs } from "../../providers/NewSourceUploader/updateExistingImport";
import { computeFileHash, loadOriginalFilesRegistry, resolveOriginalFileUri } from "../../providers/NewSourceUploader/originalFileUtils";
import { resolveCodexCustomMerge } from "../../projectManager/utils/merge/resolvers";
import { MetadataManager } from "../../utils/metadataManager";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { GlobalProvider } from "../../globalProvider";
import { createMockExtensionContext } from "../testUtils";

// Exercise the real provider -> original storage -> lookup -> create/update ->
// serialization path. Stub only UI, workspace discovery and background indexing.
type ProviderUnderTest = {
    handleWriteNotebooksForced(message: WriteNotebooksMessage, token: vscode.CancellationToken,
        panel: vscode.WebviewPanel): Promise<void>;
    convertToNotebookPreview(notebook: ProcessedNotebook): Promise<NotebookPreview>;
    migrateLocalizedBooksToMetadata: () => Promise<void>;
    removeLocalizedBooksJsonIfPresent: () => Promise<void>;
    fetchProjectInventory: () => Promise<unknown>;
};

const originalBytes = Buffer.from("PK\x03\x04old document template");
const changedBytes = Buffer.from("PK\x03\x04new document template");

function processedPair(id: string, bytes: Buffer, filename = "document.docx"): NotebookPair {
    const makeNotebook = (target: boolean): ProcessedNotebook => ({
        name: "document",
        cells: [{ id: `${id}-cell`, content: target ? "" : "<p>Hello</p>", images: [], metadata: { type: "text" } }],
        metadata: {
            id, originalFileName: filename, sourceFile: filename, importerType: "docx",
            createdAt: new Date(0).toISOString(), fileDisplayName: "Document",
            originalFileData: Uint8Array.from(bytes).buffer,
            importContext: { documentVersion: id },
        },
    });
    return { source: makeNotebook(false), codex: makeNotebook(true) };
}

suite("reimport original references", () => {
    let sandbox: sinon.SinonSandbox;
    let workspace: vscode.WorkspaceFolder;
    let provider: ProviderUnderTest;
    let choice: "Update Existing" | "Import as New Copy" | undefined;
    let info: sinon.SinonStub;
    let tokenSource: vscode.CancellationTokenSource;

    const read = async (uri: vscode.Uri) => JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString());
    const write = async (uri: vscode.Uri, value: unknown) => vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value)));
    const sourceDir = () => vscode.Uri.joinPath(workspace.uri, ".project", "sourceTexts");
    const sourceFiles = async () => (await vscode.workspace.fs.readDirectory(sourceDir()))
        .filter(([name]) => name.endsWith(".source")).map(([name]) => vscode.Uri.joinPath(sourceDir(), name));
    const codexFor = (uri: vscode.Uri) => vscode.Uri.joinPath(workspace.uri, "files", "target", uri.path.split("/").pop()!.replace(/\.source$/, ".codex"));

    async function importPair(pair: NotebookPair): Promise<void> {
        const postMessage = sandbox.stub().resolves(true);
        await provider.handleWriteNotebooksForced(
            { command: "writeNotebooks", notebookPairs: [pair] } as WriteNotebooksMessage,
            tokenSource.token,
            { webview: { postMessage } } as unknown as vscode.WebviewPanel,
        );
        assert.ok(postMessage.args.some(([message]) => message.command === "importComplete" || message.command === "importCancelled"));
    }

    async function exportTemplateBytes(notebook: { metadata: { originalFileName?: string; originalName: string } }): Promise<Buffer> {
        // Same filename precedence and resolver used by the DOCX exporter.
        const name = notebook.metadata.originalFileName || notebook.metadata.originalName;
        const uri = await resolveOriginalFileUri(workspace, name);
        return Buffer.from(await vscode.workspace.fs.readFile(uri));
    }

    setup(async () => {
        sandbox = sinon.createSandbox();
        tokenSource = new vscode.CancellationTokenSource();
        workspace = {
            uri: vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), `codex-reimport-${Date.now()}-${Math.random().toString(36).slice(2)}`),
            name: "reimport-test", index: 0,
        };
        await vscode.workspace.fs.createDirectory(sourceDir());
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspace.uri, "files", "target"));
        await write(vscode.Uri.joinPath(workspace.uri, "metadata.json"), {});
        sandbox.stub(vscode.workspace, "workspaceFolders").value([workspace]);
        sandbox.stub(vscode.workspace, "findFiles").callsFake(async () => sourceFiles());
        sandbox.stub(vscode.commands, "executeCommand").resolves();
        choice = "Update Existing";
        info = sandbox.stub(vscode.window, "showInformationMessage");
        info.callsFake(async (_message: string, options: unknown) =>
            typeof options === "object" ? choice : undefined);
        sandbox.stub(vscode.window, "showWarningMessage").resolves();
        sandbox.stub(MetadataManager, "getAIInstructionsCompleted").resolves(true);
        sandbox.stub(NotebookMetadataManager, "getManager").returns({ loadMetadata: async () => {} } as NotebookMetadataManager);
        sandbox.stub(GlobalProvider.getInstance(), "getProvider").returns(undefined);
        provider = new NewSourceUploaderProvider(createMockExtensionContext()) as unknown as ProviderUnderTest;
        sandbox.stub(provider, "migrateLocalizedBooksToMetadata").resolves();
        sandbox.stub(provider, "removeLocalizedBooksJsonIfPresent").resolves();
        sandbox.stub(provider, "fetchProjectInventory").resolves([]);
    });

    teardown(async () => {
        sandbox.restore();
        tokenSource.dispose();
        await vscode.workspace.fs.delete(workspace.uri, { recursive: true, useTrash: false });
    });

    test("Update Existing finds a renamed original, preserves work and resolves the new export template after sync in either direction", async () => {
        await importPair(processedPair("first", originalBytes));
        const [sourceUri] = await sourceFiles();
        const codexUri = codexFor(sourceUri);
        const staleSource = await read(sourceUri);
        const staleCodex = await read(codexUri);
        staleCodex.cells[0].value = "<p>Translated</p>";
        staleCodex.cells[0].metadata.edits = [{ editMap: ["value"], value: "<p>Translated</p>", timestamp: 1, type: "user-edit", author: "translator" }];
        staleCodex.cells[0].metadata.attachments = { audio: { url: "old-audio.wav", type: "audio" } };
        staleCodex.cells[0].metadata.selectedAudioId = "audio";
        await write(codexUri, staleCodex);
        const oldSourceId = staleSource.metadata.id;

        await importPair(processedPair("second", changedBytes));
        assert.ok(info.args.some(([message]) => message.includes("content has changed")), "provider must offer Update Existing after storage renames the file");
        assert.strictEqual((await sourceFiles()).length, 1, "reuse the existing pair");
        const updatedSource = await read(sourceUri);
        const updatedCodex = await read(codexUri);
        assert.strictEqual(updatedSource.metadata.id, oldSourceId);
        assert.strictEqual(updatedCodex.cells[0].value, "<p>Translated</p>");
        assert.deepStrictEqual(updatedCodex.cells[0].metadata.attachments, staleCodex.cells[0].metadata.attachments);
        assert.strictEqual(updatedCodex.cells[0].metadata.selectedAudioId, "audio");

        for (const [oldNotebook, updatedNotebook] of [[staleSource, updatedSource], [staleCodex, updatedCodex]]) {
            for (const [ours, theirs] of [[oldNotebook, updatedNotebook], [updatedNotebook, oldNotebook]]) {
                const synced = JSON.parse(await resolveCodexCustomMerge(JSON.stringify(ours), JSON.stringify(theirs)));
                assert.strictEqual(synced.metadata.originalName, "document(1).docx");
                assert.strictEqual(synced.metadata.originalFileName, "document(1).docx");
                assert.strictEqual(synced.metadata.originalFileRequestedName, "document.docx");
                assert.strictEqual(synced.metadata.originalFileHash, computeFileHash(changedBytes));
                assert.strictEqual(synced.metadata.importContext.documentVersion, "second");
                assert.ok(synced.metadata.importContext.lastReimport);
                assert.deepStrictEqual(await exportTemplateBytes(synced), changedBytes);
            }
        }
        assert.deepStrictEqual(await exportTemplateBytes(staleCodex), originalBytes, "old original remains available");
        assert.ok(!JSON.stringify(updatedCodex).includes("originalFileData"));
        // Stale registry entries are retained for safety, but must not be
        // mistaken for a current content match after Update Existing.
        const match = await findExistingImportPairs(workspace, computeFileHash(originalBytes), "document.docx");
        assert.strictEqual(match?.matchedBy, "fileName");
    });

    test("Import as New Copy leaves the old pair byte-identical and links the new pair to the new original", async () => {
        await importPair(processedPair("first", originalBytes));
        const [oldSourceUri] = await sourceFiles();
        const oldCodexUri = codexFor(oldSourceUri);
        const before = await Promise.all([oldSourceUri, oldCodexUri].map(uri => vscode.workspace.fs.readFile(uri)));
        choice = "Import as New Copy";
        await importPair(processedPair("second", changedBytes));
        const sources = await sourceFiles();
        assert.strictEqual(sources.length, 2);
        const newSourceUri = sources.find(uri => uri.path !== oldSourceUri.path)!;
        for (const [index, uri] of [oldSourceUri, oldCodexUri].entries()) {
            assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), before[index]);
            assert.deepStrictEqual(await exportTemplateBytes(await read(uri)), originalBytes);
        }
        for (const uri of [newSourceUri, codexFor(newSourceUri)]) {
            const notebook = await read(uri);
            assert.strictEqual(notebook.metadata.originalFileHash, computeFileHash(changedBytes));
            assert.deepStrictEqual(await exportTemplateBytes(notebook), changedBytes);
        }
        const registry = await loadOriginalFilesRegistry(workspace);
        assert.strictEqual(Object.keys(registry.files).length, 2);
    });

    test("identical bytes under another requested name reuse the original and still match by content", async () => {
        await importPair(processedPair("first", originalBytes));
        await importPair(processedPair("second", originalBytes, "renamed.docx"));
        assert.strictEqual((await sourceFiles()).length, 1);
        const [uri] = await sourceFiles();
        const notebook = await read(uri);
        assert.strictEqual(notebook.metadata.originalFileName, "document.docx");
        assert.strictEqual(notebook.metadata.originalFileRequestedName, "renamed.docx");
        assert.strictEqual(Object.keys((await loadOriginalFilesRegistry(workspace)).files).length, 1);
        assert.deepStrictEqual(await exportTemplateBytes(notebook), originalBytes);
    });

    test("requested filename fallback still finds a second update when the registry is missing", async () => {
        await importPair(processedPair("first", originalBytes));
        await importPair(processedPair("second", changedBytes));
        await write(vscode.Uri.joinPath(workspace.uri, "metadata.json"), {});
        const match = await findExistingImportPairs(workspace, computeFileHash(Buffer.from("third version")), "document.docx");
        assert.strictEqual(match?.matchedBy, "fileName");
        assert.strictEqual(match?.pairs.length, 1);
    });

    test("cancelling the reimport prompt leaves the existing notebooks untouched", async () => {
        await importPair(processedPair("first", originalBytes));
        const [uri] = await sourceFiles();
        const before = await vscode.workspace.fs.readFile(uri);
        choice = undefined;
        await importPair(processedPair("second", changedBytes));
        assert.strictEqual((await sourceFiles()).length, 1);
        assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), before);
    });
});
