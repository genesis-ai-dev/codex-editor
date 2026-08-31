import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import {
    enforceConflictListInvariant, excludeUnchangedConflicts, synthesizeConflictsForPaths,
    type ConflictSynthesisGitOps, type MergeSnapshot,
} from "../../projectManager/utils/merge/conflictSynthesis";
import { resolvePointerConflict } from "../../projectManager/utils/merge/pointerConflict";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";
import { determineStrategy } from "../../projectManager/utils/merge/strategies";
import { ConflictResolutionStrategy, type ConflictFile } from "../../projectManager/utils/merge/types";
import { isRetriableSyncError } from "../../projectManager/utils/merge/transientSyncError";

const pointer = (letter: string) => `version https://git-lfs.github.com/spec/v1\noid sha256:${letter.repeat(64)}\nsize 4096\n`;
const snapshot: MergeSnapshot = { localHead: "local", remoteHead: "remote", baseHead: "base" };
const audioPath = ".project/attachments/pointers/BOOK/audio.wav";

suite("Sync: identical files and media pointers", () => {
    let dir: string;
    let blobs: Map<string, Buffer>;
    let gitOps: ConflictSynthesisGitOps;

    async function write(filepath: string, content: string | Buffer): Promise<void> {
        const uri = vscode.Uri.file(path.join(dir, filepath));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    }
    function blob(ref: string, filepath: string, content: string | Buffer): void {
        blobs.set(`${ref}:${filepath}`, Buffer.from(content));
    }
    function conflict(ours: string, theirs: string, base = ""): ConflictFile {
        return { filepath: audioPath, ours, theirs, base, isNew: false, isDeleted: false };
    }

    setup(async () => {
        dir = path.join(os.tmpdir(), `sync-identical-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        blobs = new Map();
        gitOps = {
            resolveRef: async (_dir, ref) => ref,
            readBlobAtRef: async (_dir, ref, filepath) => {
                const bytes = blobs.get(`${ref}:${filepath}`);
                if (!bytes) throw new Error(`Missing blob: ${ref}:${filepath}`);
                return bytes;
            },
        };
    });
    teardown(async () => vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true }));

    test("1,500 identical added pointers need no synthesis or retry on the first attempt", async function () {
        this.timeout(60000);
        const paths: string[] = [];
        for (let i = 0; i < 1500; i++) {
            const filepath = `.project/attachments/pointers/BOOK/audio-${i}.wav`;
            paths.push(filepath);
            blob("local", filepath, pointer("a"));
            blob("remote", filepath, pointer("a"));
            await write(filepath, pointer("a"));
        }
        const result = await enforceConflictListInvariant({
            conflicts: [], changedPaths: paths, retryCount: 0, workspaceDir: dir, snapshot,
            log: () => assert.fail("Matching files must not trigger recovery warnings"),
        }, gitOps);
        assert.deepStrictEqual(result, []);
        assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(
            vscode.Uri.file(path.join(dir, paths[1499]))
        )).toString(), pointer("a"));
    });

    test("real missing files remain protected among identical files", async () => {
        blob("local", audioPath, pointer("a"));
        blob("remote", audioPath, pointer("a"));
        await write(audioPath, pointer("a"));
        blob("remote", "new.txt", "remote addition");
        const options = { conflicts: [], changedPaths: [audioPath, "new.txt"], retryCount: 0, workspaceDir: dir, snapshot };
        await assert.rejects(enforceConflictListInvariant(options, gitOps), /1 remote-changed.*new.txt/);
        const recovered = await enforceConflictListInvariant({ ...options, retryCount: 2, log: () => {} }, gitOps);
        assert.deepStrictEqual(recovered.map((file) => file.filepath), ["new.txt"]);
        assert.strictEqual(recovered[0].theirs, "remote addition");
    });

    test("working bytes alone are insufficient: unstaged content must still be resolved", async () => {
        blob("local", audioPath, pointer("a"));
        blob("remote", audioPath, pointer("b"));
        blob("base", audioPath, pointer("a"));
        await write(audioPath, pointer("b"));
        const result = await synthesizeConflictsForPaths(dir, [audioPath], gitOps, snapshot);
        assert.deepStrictEqual(result.unchanged, []);
        assert.strictEqual(result.synthesized.length, 1);
    });

    test("new working edits and missing working files are never classified as unchanged", async () => {
        blob("local", audioPath, pointer("a"));
        blob("remote", audioPath, pointer("a"));
        await write(audioPath, pointer("b"));
        assert.strictEqual((await synthesizeConflictsForPaths(dir, [audioPath], gitOps, snapshot)).synthesized[0].ours, pointer("b"));
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(dir, audioPath)));
        const missing = await synthesizeConflictsForPaths(dir, [audioPath], gitOps, snapshot);
        assert.strictEqual(missing.synthesized[0].isNew, true);
    });

    test("different binary bytes cannot pass equality through UTF-8 replacement characters", async () => {
        blob("local", "binary.bin", Buffer.from([0xff]));
        blob("remote", "binary.bin", Buffer.from([0xfe]));
        await write("binary.bin", Buffer.from([0xff]));
        const result = await synthesizeConflictsForPaths(dir, ["binary.bin"], gitOps, snapshot);
        assert.deepStrictEqual(result.unchanged, []);
        assert.deepStrictEqual(result.unsynthesizable, ["binary.bin"]);
    });

    test("matching conflicts from older Frontier versions are filtered, deletions are not", async () => {
        blob("local", audioPath, pointer("a"));
        blob("remote", audioPath, pointer("a"));
        await write(audioPath, pointer("a"));
        assert.deepStrictEqual(await excludeUnchangedConflicts([conflict(pointer("a"), pointer("a"))], dir, snapshot, gitOps), []);
        const deletion = { ...conflict("", ""), isDeleted: true };
        assert.deepStrictEqual(await excludeUnchangedConflicts([deletion], dir, snapshot, gitOps), [deletion]);
    });

    test("reads the analysed remote commit even if FETCH_HEAD changes", async () => {
        blob("local", audioPath, pointer("a"));
        blob("remote", audioPath, pointer("a"));
        blob("FETCH_HEAD", audioPath, pointer("b"));
        await write(audioPath, pointer("a"));
        assert.deepStrictEqual((await synthesizeConflictsForPaths(dir, [audioPath], gitOps, snapshot)).unchanged, [audioPath]);
    });

    test("pointer strategy applies one-sided changes and preserves competing recordings", async () => {
        assert.strictEqual(determineStrategy(audioPath), ConflictResolutionStrategy.LFS_POINTER);
        assert.strictEqual(resolvePointerConflict(conflict(pointer("a"), pointer("b"), pointer("a"))), pointer("b"));
        assert.strictEqual(resolvePointerConflict(conflict(pointer("b"), pointer("a"), pointer("a"))), pointer("b"));
        assert.throws(() => resolvePointerConflict(conflict(pointer("b"), pointer("c"), pointer("a"))), /Both sides changed/);
        await write(audioPath, pointer("a"));
        const resolved = await resolveConflictFiles([conflict(pointer("a"), pointer("b"), pointer("a"))], dir);
        assert.deepStrictEqual(resolved.failed, []);
        assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(dir, audioPath)))).toString(), pointer("b"));
    });

    test("cross-extension snapshot changes trigger bounded sync retry", () => {
        assert.strictEqual(isRetriableSyncError(new Error("Complete merge operation failed: MERGE_STATE_CHANGED: remote advanced")), true);
    });

});
