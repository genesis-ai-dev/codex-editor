import * as assert from "assert";
import * as vscode from "vscode";
import sinon from "sinon";
import { atomicWriteUriText, readExistingFileOrThrow } from "../../utils/notebookSafeSaveUtils";

suite("notebookSafeSaveUtils", () => {
    teardown(() => {
        sinon.restore();
    });

    test("readExistingFileOrThrow returns missing when stat/read indicate missing", async () => {
        const uri = vscode.Uri.file("/tmp/does-not-exist.codex");
        sinon.stub(vscode.workspace.fs, "readFile").rejects(new Error("ENOENT"));
        sinon.stub(vscode.workspace.fs, "stat").rejects(new Error("ENOENT"));

        const result = await readExistingFileOrThrow(uri);
        assert.strictEqual(result.kind, "missing");
    });

    test("readExistingFileOrThrow throws when file exists but read fails", async () => {
        const uri = vscode.Uri.file("/tmp/exists-but-unreadable.codex");
        sinon.stub(vscode.workspace.fs, "readFile").rejects(new Error("EIO"));
        sinon.stub(vscode.workspace.fs, "stat").resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 });

        await assert.rejects(async () => readExistingFileOrThrow(uri));
    });

    test("readExistingFileOrThrow throws when it reads whitespace but file size is non-zero", async () => {
        const uri = vscode.Uri.file("/tmp/exists-but-read-empty.codex");
        sinon.stub(vscode.workspace.fs, "readFile").resolves(Buffer.from("   \n\t", "utf-8"));
        sinon.stub(vscode.workspace.fs, "stat").resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 });

        await assert.rejects(async () => readExistingFileOrThrow(uri));
    });

    test("readExistingFileOrThrow returns missing when it reads empty and file size is zero", async () => {
        const uri = vscode.Uri.file("/tmp/empty-file.codex");
        sinon.stub(vscode.workspace.fs, "readFile").resolves(Buffer.from("", "utf-8"));
        sinon.stub(vscode.workspace.fs, "stat").resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 });

        const result = await readExistingFileOrThrow(uri);
        assert.strictEqual(result.kind, "missing");
    });

    test("atomicWriteUriText writes temp then renames over target", async () => {
        const uri = vscode.Uri.file("/tmp/atomic-write-target.codex");
        const writeStub = sinon.stub(vscode.workspace.fs, "writeFile").resolves();
        const renameStub = sinon.stub(vscode.workspace.fs, "rename").resolves();

        await atomicWriteUriText(uri, "{\n  \"cells\": []\n}\n");

        assert.strictEqual(writeStub.callCount, 1);
        assert.strictEqual(renameStub.callCount, 1);
        const [tmpUriArg] = writeStub.firstCall.args;
        const [fromUriArg, toUriArg, optsArg] = renameStub.firstCall.args;
        assert.ok(tmpUriArg.toString().includes(".tmp-"), "temp uri should include .tmp-");
        assert.strictEqual(fromUriArg.toString(), tmpUriArg.toString(), "rename source should be temp uri");
        assert.strictEqual(toUriArg.toString(), uri.toString(), "rename target should be original uri");
        assert.deepStrictEqual(optsArg, { overwrite: true });
    });
});

