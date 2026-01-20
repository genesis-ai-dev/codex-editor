import * as assert from "assert";
import * as vscode from "vscode";
import sinon from "sinon";
import {
    atomicWriteUriTextWithFs,
    readExistingFileOrThrowWithFs,
    type NotebookFs,
} from "../../utils/notebookSafeSaveUtils";

suite("notebookSafeSaveUtils", () => {
    teardown(() => {
        sinon.restore();
    });

    test("readExistingFileOrThrow returns missing when stat/read indicate missing", async () => {
        const uri = vscode.Uri.file("/tmp/does-not-exist.codex");
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("ENOENT")),
            stat: sinon.stub().rejects(new Error("ENOENT")),
            writeFile: sinon.stub().resolves(),
            rename: sinon.stub().resolves(),
        };

        const result = await readExistingFileOrThrowWithFs(fs, uri);
        assert.strictEqual(result.kind, "missing");
    });

    test("readExistingFileOrThrow throws when file exists but read fails", async () => {
        const uri = vscode.Uri.file("/tmp/exists-but-unreadable.codex");
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("EIO")),
            stat: sinon.stub().resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 }),
            writeFile: sinon.stub().resolves(),
            rename: sinon.stub().resolves(),
        };

        await assert.rejects(async () => readExistingFileOrThrowWithFs(fs, uri));
    });

    test("readExistingFileOrThrow throws when it reads whitespace but file size is non-zero", async () => {
        const uri = vscode.Uri.file("/tmp/exists-but-read-empty.codex");
        const fs: NotebookFs = {
            readFile: sinon.stub().resolves(Buffer.from("   \n\t", "utf-8")),
            stat: sinon.stub().resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 }),
            writeFile: sinon.stub().resolves(),
            rename: sinon.stub().resolves(),
        };

        await assert.rejects(async () => readExistingFileOrThrowWithFs(fs, uri));
    });

    test("readExistingFileOrThrow returns missing when it reads empty and file size is zero", async () => {
        const uri = vscode.Uri.file("/tmp/empty-file.codex");
        const fs: NotebookFs = {
            readFile: sinon.stub().resolves(Buffer.from("", "utf-8")),
            stat: sinon.stub().resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }),
            writeFile: sinon.stub().resolves(),
            rename: sinon.stub().resolves(),
        };

        const result = await readExistingFileOrThrowWithFs(fs, uri);
        assert.strictEqual(result.kind, "missing");
    });

    test("atomicWriteUriText writes temp then renames over target", async () => {
        const uri = vscode.Uri.file("/tmp/atomic-write-target.codex");
        const writeStub = sinon.stub().resolves();
        const renameStub = sinon.stub().resolves();
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("unused")),
            stat: sinon.stub().rejects(new Error("unused")),
            writeFile: writeStub,
            rename: renameStub,
        };

        await atomicWriteUriTextWithFs(fs, uri, "{\n  \"cells\": []\n}\n");

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

