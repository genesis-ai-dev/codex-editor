import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { promises as nodeFs } from "fs";
import sinon from "sinon";
import {
    atomicWriteUriText,
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
            delete: sinon.stub().resolves(),
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
            delete: sinon.stub().resolves(),
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
            delete: sinon.stub().resolves(),
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
            delete: sinon.stub().resolves(),
        };

        const result = await readExistingFileOrThrowWithFs(fs, uri);
        assert.strictEqual(result.kind, "missing");
    });

    test("atomicWriteUriText writes temp then renames over target", async () => {
        const uri = vscode.Uri.file("/tmp/atomic-write-target.codex");
        const writeStub = sinon.stub().resolves();
        const renameStub = sinon.stub().resolves();
        const deleteStub = sinon.stub().resolves();
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("unused")),
            stat: sinon.stub().rejects(vscode.FileSystemError.FileNotFound(uri)),
            writeFile: writeStub,
            rename: renameStub,
            delete: deleteStub,
        };

        await atomicWriteUriTextWithFs(fs, uri, "{\n  \"cells\": []\n}\n");

        assert.strictEqual(writeStub.callCount, 1);
        assert.strictEqual(renameStub.callCount, 1);
        assert.strictEqual(deleteStub.callCount, 0, "delete should not be called on success");
        const [tmpUriArg] = writeStub.firstCall.args;
        const [fromUriArg, toUriArg, optsArg] = renameStub.firstCall.args;
        assert.ok(tmpUriArg.toString().includes(".tmp-"), "temp uri should include .tmp-");
        assert.strictEqual(fromUriArg.toString(), tmpUriArg.toString(), "rename source should be temp uri");
        assert.strictEqual(toUriArg.toString(), uri.toString(), "rename target should be original uri");
        assert.deepStrictEqual(optsArg, { overwrite: true });
    });

    test("atomicWriteUriText cleans up temp file when rename fails", async () => {
        const uri = vscode.Uri.file("/tmp/atomic-write-fail.codex");
        const writeStub = sinon.stub().resolves();
        const renameStub = sinon.stub().rejects(new Error("Rename failed"));
        const deleteStub = sinon.stub().resolves();
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("unused")),
            stat: sinon.stub().rejects(vscode.FileSystemError.FileNotFound(uri)),
            writeFile: writeStub,
            rename: renameStub,
            delete: deleteStub,
        };

        await assert.rejects(
            async () => await atomicWriteUriTextWithFs(fs, uri, "test content"),
            /Rename failed/
        );

        assert.strictEqual(writeStub.callCount, 1, "writeFile should be called");
        assert.strictEqual(renameStub.callCount, 1, "rename should be called");
        assert.strictEqual(deleteStub.callCount, 1, "delete should be called to clean up temp file");
        const [tmpUriArg] = writeStub.firstCall.args;
        const [deletedUriArg] = deleteStub.firstCall.args;
        assert.strictEqual(
            deletedUriArg.toString(),
            tmpUriArg.toString(),
            "delete should be called with the temp file URI"
        );
    });

    test("atomicWriteUriText does not clean up when writeFile fails", async () => {
        const uri = vscode.Uri.file("/tmp/atomic-write-fail.codex");
        const writeStub = sinon.stub().rejects(new Error("Write failed"));
        const renameStub = sinon.stub().resolves();
        const deleteStub = sinon.stub().resolves();
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("unused")),
            stat: sinon.stub().rejects(vscode.FileSystemError.FileNotFound(uri)),
            writeFile: writeStub,
            rename: renameStub,
            delete: deleteStub,
        };

        await assert.rejects(
            async () => await atomicWriteUriTextWithFs(fs, uri, "test content"),
            /Write failed/
        );

        assert.strictEqual(writeStub.callCount, 1, "writeFile should be called");
        assert.strictEqual(renameStub.callCount, 0, "rename should not be called if write fails");
        assert.strictEqual(deleteStub.callCount, 0, "delete should not be called if write fails (no temp file created)");
    });

    test("atomicWriteUriText writes directly when target exists", async () => {
        const uri = vscode.Uri.file("/tmp/existing-target.codex");
        const writeStub = sinon.stub().resolves();
        const renameStub = sinon.stub().resolves();
        const deleteStub = sinon.stub().resolves();
        const fs: NotebookFs = {
            readFile: sinon.stub().rejects(new Error("unused")),
            stat: sinon.stub().resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 }),
            writeFile: writeStub,
            rename: renameStub,
            delete: deleteStub,
        };

        await atomicWriteUriTextWithFs(fs, uri, "existing content");

        assert.strictEqual(writeStub.callCount, 1);
        assert.strictEqual(renameStub.callCount, 0, "rename should not be called when file exists");
        assert.strictEqual(deleteStub.callCount, 0, "delete should not be called on direct write");
        const [writeUriArg] = writeStub.firstCall.args;
        assert.strictEqual(writeUriArg.toString(), uri.toString(), "writeFile should target original uri");
    });

    // Issue #1119: for local file: URIs the write must go through a temp file
    // + rename so an existing target is replaced atomically — a concurrent
    // reader can never observe truncated/partial content.
    suite("atomicWriteUriText local (file:) path", () => {
        let tmpDir: string;

        setup(async () => {
            tmpDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), "codex-atomic-write-"));
        });

        teardown(async () => {
            await nodeFs.rm(tmpDir, { recursive: true, force: true });
        });

        test("creates a new file with the exact content", async () => {
            const target = path.join(tmpDir, "new-file.codex");
            await atomicWriteUriText(vscode.Uri.file(target), '{"cells":[]}');
            assert.strictEqual(await nodeFs.readFile(target, "utf-8"), '{"cells":[]}');
        });

        test("replaces an existing file's content and leaves no temp files behind", async () => {
            const target = path.join(tmpDir, "existing-file.codex");
            await nodeFs.writeFile(target, "old content", "utf-8");

            await atomicWriteUriText(vscode.Uri.file(target), "new content");

            assert.strictEqual(await nodeFs.readFile(target, "utf-8"), "new content");
            const leftovers = (await nodeFs.readdir(tmpDir)).filter((name) =>
                name.includes(".tmp-")
            );
            assert.deepStrictEqual(leftovers, [], "no temp files should remain");
        });

        test("keeps the previous content intact when the write cannot complete", async () => {
            const target = path.join(tmpDir, "protected-file.codex");
            await nodeFs.writeFile(target, "precious content", "utf-8");
            // Make the directory read-only so the temp file cannot be created.
            await nodeFs.chmod(tmpDir, 0o500);
            try {
                await assert.rejects(() =>
                    atomicWriteUriText(vscode.Uri.file(target), "replacement")
                );
            } finally {
                await nodeFs.chmod(tmpDir, 0o700);
            }
            assert.strictEqual(await nodeFs.readFile(target, "utf-8"), "precious content");
        });

        test("many sequential overwrites always leave complete content", async () => {
            const target = path.join(tmpDir, "hammered-file.codex");
            const payload = (i: number) =>
                JSON.stringify({ cells: [{ value: `revision ${i}`.repeat(100) }] });
            await atomicWriteUriText(vscode.Uri.file(target), payload(0));

            for (let i = 1; i <= 25; i++) {
                await atomicWriteUriText(vscode.Uri.file(target), payload(i));
                const onDisk = await nodeFs.readFile(target, "utf-8");
                // Every observation must be one of the complete payloads.
                assert.doesNotThrow(() => JSON.parse(onDisk));
            }
            assert.strictEqual(await nodeFs.readFile(target, "utf-8"), payload(25));
        });
    });
});

