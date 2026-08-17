import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

import {
    collectDeletionTombstones,
    findTombstoneTimestamp,
    getLatestContentTimestamp,
    isTrackedContentFile,
    restoreContentFilesMissingWithoutTombstone,
    DeletionGuardGitOps,
} from "../../projectManager/utils/merge/fileDeletionGuard";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";
import { ConflictFile } from "../../projectManager/utils/merge/types";

/** Minimal `.codex` notebook whose newest edit carries the given timestamp. */
function makeNotebookContent(latestEditTimestamp: number): string {
    return JSON.stringify({
        cells: [
            {
                kind: 2,
                languageId: "html",
                value: "<span>translated content</span>",
                metadata: {
                    id: "EP 1:1",
                    type: "text",
                    edits: [
                        {
                            editMap: ["value"],
                            value: "<span>older draft</span>",
                            timestamp: latestEditTimestamp - 5000,
                            type: "user-edit",
                            author: "translator",
                        },
                        {
                            editMap: ["value"],
                            value: "<span>translated content</span>",
                            timestamp: latestEditTimestamp,
                            type: "user-edit",
                            author: "translator",
                        },
                    ],
                    data: {},
                },
            },
        ],
        metadata: { id: "EP", edits: [] },
    });
}

function makeMetadataContent(edits: unknown[]): string {
    return JSON.stringify({ projectName: "Test", edits, meta: {} });
}

function deletedFileEdit(relPath: string, timestamp: number, absolutePrefix = "/Users/someone/project/") {
    return {
        editMap: ["deletedFile"],
        value: { filePath: absolutePrefix + relPath, relPath, label: "Episode" },
        timestamp,
        type: "user-edit",
        author: "reviewer",
    };
}

async function makeTempWorkspace(): Promise<string> {
    const dir = path.join(
        os.tmpdir(),
        `deletion-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    return dir;
}

async function removeDir(dir: string): Promise<void> {
    try {
        await vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true });
    } catch {
        // best-effort cleanup
    }
}

async function fileExists(dir: string, relPath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dir, relPath)));
        return true;
    } catch {
        return false;
    }
}

async function readFileText(dir: string, relPath: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(dir, relPath)));
    return new TextDecoder().decode(bytes);
}

async function writeFileText(dir: string, relPath: string, content: string): Promise<void> {
    const target = vscode.Uri.file(path.join(dir, relPath));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(content));
}

suite("fileDeletionGuard - helpers", () => {
    test("isTrackedContentFile matches only content files", () => {
        assert.strictEqual(isTrackedContentFile("files/target/EP206.codex"), true);
        assert.strictEqual(isTrackedContentFile(".project/sourceTexts/EP206.source"), true);
        assert.strictEqual(isTrackedContentFile("files\\target\\EP206.codex"), true);

        assert.strictEqual(isTrackedContentFile("metadata.json"), false);
        assert.strictEqual(isTrackedContentFile("files/target/notes.txt"), false);
        assert.strictEqual(isTrackedContentFile("elsewhere/EP206.codex"), false);
        assert.strictEqual(isTrackedContentFile("files/target/EP206.codex.tmp-123-abc"), false);
    });

    test("collectDeletionTombstones reads deletedFile and deletedCorpusMarker edits", () => {
        const metadata = makeMetadataContent([
            deletedFileEdit("files/target/A.codex", 1000),
            {
                editMap: ["deletedCorpusMarker"],
                value: {
                    corpusMarker: "EP",
                    deletedFiles: [
                        { filePath: "/abs/files/target/B.codex", label: "B" },
                        { filePath: "/abs/files/target/C.codex", label: "C" },
                    ],
                },
                timestamp: 2000,
                type: "user-edit",
                author: "reviewer",
            },
            // Unrelated edit must be ignored
            { editMap: ["projectName"], value: "X", timestamp: 3000, type: "user-edit", author: "a" },
        ]);

        const tombstones = collectDeletionTombstones(metadata);
        assert.strictEqual(tombstones.length, 3);
        assert.deepStrictEqual(
            tombstones.map((t) => t.timestamp),
            [1000, 2000, 2000]
        );
    });

    test("collectDeletionTombstones tolerates invalid inputs", () => {
        assert.deepStrictEqual(collectDeletionTombstones(undefined, "not json", "{}"), []);
    });

    test("collectDeletionTombstones combines multiple metadata contents", () => {
        const local = makeMetadataContent([deletedFileEdit("files/target/A.codex", 1000)]);
        const incoming = makeMetadataContent([deletedFileEdit("files/target/B.codex", 2000)]);
        const tombstones = collectDeletionTombstones(local, incoming);
        assert.strictEqual(tombstones.length, 2);
    });

    test("findTombstoneTimestamp matches by relPath, absolute suffix, and basename", () => {
        const tombstones = collectDeletionTombstones(
            makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 5000)])
        );

        // Exact relative path
        assert.strictEqual(findTombstoneTimestamp(tombstones, "files/target/EP206.codex"), 5000);

        // Legacy record with only an absolute path from another machine
        const legacy = collectDeletionTombstones(
            makeMetadataContent([
                {
                    editMap: ["deletedFile"],
                    value: { filePath: "C:\\Users\\other\\proj\\files\\target\\EP206.codex", label: "E" },
                    timestamp: 6000,
                    type: "user-edit",
                    author: "reviewer",
                },
            ])
        );
        assert.strictEqual(findTombstoneTimestamp(legacy, "files/target/EP206.codex"), 6000);

        // No match for a different file
        assert.strictEqual(findTombstoneTimestamp(tombstones, "files/target/EP207.codex"), undefined);
    });

    test("findTombstoneTimestamp matches a .source file via its paired .codex tombstone", () => {
        const tombstones = collectDeletionTombstones(
            makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 5000)])
        );
        assert.strictEqual(
            findTombstoneTimestamp(tombstones, ".project/sourceTexts/EP206.source"),
            5000
        );
    });

    test("findTombstoneTimestamp returns the newest matching tombstone", () => {
        const tombstones = collectDeletionTombstones(
            makeMetadataContent([
                deletedFileEdit("files/target/EP206.codex", 5000),
                deletedFileEdit("files/target/EP206.codex", 9000),
            ])
        );
        assert.strictEqual(findTombstoneTimestamp(tombstones, "files/target/EP206.codex"), 9000);
    });

    test("getLatestContentTimestamp finds the max across cell edits and validations", () => {
        assert.strictEqual(getLatestContentTimestamp(makeNotebookContent(7777)), 7777);

        const withValidation = JSON.stringify({
            cells: [
                {
                    metadata: {
                        id: "EP 1:1",
                        edits: [
                            {
                                editMap: ["value"],
                                value: "x",
                                timestamp: 100,
                                validatedBy: [
                                    {
                                        username: "v",
                                        creationTimestamp: 100,
                                        updatedTimestamp: 500,
                                        isDeleted: false,
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
            metadata: { edits: [{ editMap: ["title"], value: "t", timestamp: 300 }] },
        });
        assert.strictEqual(getLatestContentTimestamp(withValidation), 500);

        assert.strictEqual(getLatestContentTimestamp("not json"), 0);
        assert.strictEqual(getLatestContentTimestamp("{}"), 0);
    });
});

suite("fileDeletionGuard - pre-sync restore guard", () => {
    let workspaceDir: string;

    setup(async () => {
        workspaceDir = await makeTempWorkspace();
    });

    teardown(async () => {
        await removeDir(workspaceDir);
    });

    function fakeGitOps(
        matrix: Array<[string, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]>,
        blobs: Record<string, string>
    ): DeletionGuardGitOps & { readPaths: string[] } {
        const readPaths: string[] = [];
        return {
            readPaths,
            statusMatrix: async () => matrix,
            readBlobAtRef: async (_dir: string, _ref: string, filepath: string) => {
                readPaths.push(filepath);
                if (!(filepath in blobs)) throw new Error(`no blob for ${filepath}`);
                return Buffer.from(blobs[filepath]);
            },
        };
    }

    test("restores missing content files that have no tombstone", async () => {
        const gitOps = fakeGitOps(
            [
                ["files/target/EP206.codex", 1, 0, 0],
                [".project/sourceTexts/EP206.source", 1, 0, 0],
                ["files/target/EP205.codex", 1, 1, 1], // present — untouched
                ["notes.txt", 1, 0, 0], // not a content file — untouched
            ],
            {
                "files/target/EP206.codex": makeNotebookContent(1000),
                ".project/sourceTexts/EP206.source": makeNotebookContent(900),
            }
        );

        const restored = await restoreContentFilesMissingWithoutTombstone(workspaceDir, gitOps);

        assert.deepStrictEqual(restored.sort(), [
            ".project/sourceTexts/EP206.source",
            "files/target/EP206.codex",
        ]);
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP206.codex"), true);
        assert.strictEqual(
            await fileExists(workspaceDir, ".project/sourceTexts/EP206.source"),
            true
        );
        assert.strictEqual(await fileExists(workspaceDir, "notes.txt"), false);
        assert.strictEqual(
            await readFileText(workspaceDir, "files/target/EP206.codex"),
            makeNotebookContent(1000)
        );
    });

    test("leaves tombstoned deletions alone (and their paired .source)", async () => {
        await writeFileText(
            workspaceDir,
            "metadata.json",
            makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 5000)])
        );

        const gitOps = fakeGitOps(
            [
                ["files/target/EP206.codex", 1, 0, 0],
                [".project/sourceTexts/EP206.source", 1, 0, 0],
                ["files/target/EP207.codex", 1, 0, 0],
            ],
            { "files/target/EP207.codex": makeNotebookContent(1000) }
        );

        const restored = await restoreContentFilesMissingWithoutTombstone(workspaceDir, gitOps);

        assert.deepStrictEqual(restored, ["files/target/EP207.codex"]);
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP206.codex"), false);
        assert.strictEqual(
            await fileExists(workspaceDir, ".project/sourceTexts/EP206.source"),
            false
        );
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP207.codex"), true);
    });

    test("does nothing when no tracked content files are missing", async () => {
        const gitOps = fakeGitOps([["files/target/EP205.codex", 1, 1, 1]], {});
        const restored = await restoreContentFilesMissingWithoutTombstone(workspaceDir, gitOps);
        assert.deepStrictEqual(restored, []);
        assert.deepStrictEqual(gitOps.readPaths, []);
    });

    test("continues past files whose HEAD blob cannot be read", async () => {
        const gitOps = fakeGitOps(
            [
                ["files/target/EP206.codex", 1, 0, 0],
                ["files/target/EP207.codex", 1, 0, 0],
            ],
            { "files/target/EP207.codex": makeNotebookContent(1000) }
        );

        const restored = await restoreContentFilesMissingWithoutTombstone(workspaceDir, gitOps);
        assert.deepStrictEqual(restored, ["files/target/EP207.codex"]);
    });
});

suite("fileDeletionGuard - delete-vs-modify conflict resolution", () => {
    let workspaceDir: string;

    setup(async () => {
        workspaceDir = await makeTempWorkspace();
    });

    teardown(async () => {
        await removeDir(workspaceDir);
    });

    function deletionConflict(
        filepath: string,
        opts: { ours?: string; theirs?: string; base?: string }
    ): ConflictFile {
        return {
            filepath,
            ours: opts.ours ?? "",
            theirs: opts.theirs ?? "",
            base: opts.base ?? "",
            isDeleted: true,
            isNew: false,
        };
    }

    test("restores a remotely-surviving file deleted locally without a tombstone", async () => {
        const surviving = makeNotebookContent(1000);
        const conflict = deletionConflict("files/target/EP206.codex", {
            theirs: surviving,
            base: surviving,
        });

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP206.codex", resolution: "created" },
        ]);
        assert.strictEqual(
            await readFileText(workspaceDir, "files/target/EP206.codex"),
            surviving
        );
    });

    test("restores a locally-surviving file deleted remotely without a tombstone", async () => {
        const surviving = makeNotebookContent(2000);
        await writeFileText(workspaceDir, "files/target/EP207.codex", surviving);
        const conflict = deletionConflict("files/target/EP207.codex", {
            ours: surviving,
            base: surviving,
        });

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP207.codex", resolution: "modified" },
        ]);
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP207.codex"), true);
    });

    test("honors deletion when a tombstone is newer than the surviving content's edits", async () => {
        const surviving = makeNotebookContent(1000);
        await writeFileText(workspaceDir, "files/target/EP206.codex", surviving);
        await writeFileText(
            workspaceDir,
            "metadata.json",
            makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 9999)])
        );

        const conflict = deletionConflict("files/target/EP206.codex", {
            ours: surviving,
            base: surviving,
        });

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP206.codex", resolution: "deleted" },
        ]);
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP206.codex"), false);
    });

    test("restores the file when its edits are newer than the tombstone", async () => {
        const surviving = makeNotebookContent(9999); // edited AFTER the recorded deletion
        await writeFileText(
            workspaceDir,
            "metadata.json",
            makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 5000)])
        );

        const conflict = deletionConflict("files/target/EP206.codex", {
            theirs: surviving,
            base: makeNotebookContent(1000),
        });

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP206.codex", resolution: "created" },
        ]);
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP206.codex"), true);
    });

    test("honors a tombstone that only exists in the incoming metadata.json conflict", async () => {
        const surviving = makeNotebookContent(1000);
        await writeFileText(workspaceDir, "files/target/EP206.codex", surviving);
        // Local metadata has no tombstone; the remote (theirs) copy in the same
        // conflict batch records the deletion.
        await writeFileText(workspaceDir, "metadata.json", makeMetadataContent([]));
        const metadataConflict: ConflictFile = {
            filepath: "metadata.json",
            ours: makeMetadataContent([]),
            theirs: makeMetadataContent([deletedFileEdit("files/target/EP206.codex", 9999)]),
            base: makeMetadataContent([]),
            isDeleted: false,
            isNew: false,
        };
        const conflict = deletionConflict("files/target/EP206.codex", {
            ours: surviving,
            base: surviving,
        });

        const { resolved } = await resolveConflictFiles(
            [metadataConflict, conflict],
            workspaceDir
        );

        const codexResolution = resolved.find(
            (r) => r.filepath === "files/target/EP206.codex"
        );
        assert.deepStrictEqual(codexResolution, {
            filepath: "files/target/EP206.codex",
            resolution: "deleted",
        });
        assert.strictEqual(await fileExists(workspaceDir, "files/target/EP206.codex"), false);
    });

    test("still deletes non-content files unconditionally", async () => {
        await writeFileText(workspaceDir, "some/other/file.json", "{}");
        const conflict = deletionConflict("some/other/file.json", { theirs: "{}" });

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "some/other/file.json", resolution: "deleted" },
        ]);
        assert.strictEqual(await fileExists(workspaceDir, "some/other/file.json"), false);
    });

    test("deletes a content file when both sides are empty (no surviving content)", async () => {
        const conflict = deletionConflict("files/target/EP208.codex", {});

        const { resolved, failed } = await resolveConflictFiles([conflict], workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP208.codex", resolution: "deleted" },
        ]);
    });
});
