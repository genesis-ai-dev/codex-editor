import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

import {
    normalizeSyncPath,
    synthesizeConflictsForPaths,
    enforceConflictListInvariant,
    ConflictSynthesisGitOps,
} from "../../projectManager/utils/merge/conflictSynthesis";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";
import { TransientSyncError } from "../../projectManager/utils/merge/transientSyncError";

async function makeTempWorkspace(): Promise<string> {
    const dir = path.join(
        os.tmpdir(),
        `conflict-synthesis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

async function writeFileText(dir: string, relPath: string, content: string): Promise<void> {
    const target = vscode.Uri.file(path.join(dir, relPath));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(content));
}

/** blobs keyed by "<ref>:<filepath>"; refs listed in `refs` resolve. */
function fakeGitOps(
    refs: string[],
    blobs: Record<string, string>
): ConflictSynthesisGitOps {
    return {
        resolveRef: async (_dir: string, ref: string) => {
            if (!refs.includes(ref)) throw new Error(`unknown ref ${ref}`);
            return ref;
        },
        readBlobAtRef: async (_dir: string, ref: string, filepath: string) => {
            const key = `${ref}:${filepath}`;
            if (!(key in blobs)) throw new Error(`no blob for ${key}`);
            return Buffer.from(blobs[key]);
        },
    };
}

/** Minimal `.codex` notebook with one cell whose newest edit has the given value/timestamp. */
function notebookWithEdit(value: string, timestamp: number): string {
    return JSON.stringify({
        cells: [
            {
                kind: 2,
                languageId: "html",
                value,
                metadata: {
                    id: "EP 1:1",
                    type: "text",
                    edits: [
                        {
                            editMap: ["value"],
                            value,
                            timestamp,
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

suite("conflictSynthesis - normalizeSyncPath", () => {
    test("canonicalizes separators, leading ./ and /, and Unicode form", () => {
        assert.strictEqual(normalizeSyncPath("files\\target\\EP.codex"), "files/target/EP.codex");
        assert.strictEqual(normalizeSyncPath("./files/target/EP.codex"), "files/target/EP.codex");
        assert.strictEqual(normalizeSyncPath("././files/target/EP.codex"), "files/target/EP.codex");
        assert.strictEqual(normalizeSyncPath("/files/target/EP.codex"), "files/target/EP.codex");
        // NFD (e + combining acute) normalizes to NFC (precomposed é)
        assert.strictEqual(normalizeSyncPath("files/target/Genèse.codex".normalize("NFD")), "files/target/Genèse.codex".normalize("NFC"));
        // already-canonical paths pass through unchanged
        assert.strictEqual(normalizeSyncPath("files/target/EP.codex"), "files/target/EP.codex");
    });
});

suite("conflictSynthesis - synthesizeConflictsForPaths", () => {
    let workspaceDir: string;

    setup(async () => {
        workspaceDir = await makeTempWorkspace();
    });

    teardown(async () => {
        await removeDir(workspaceDir);
    });

    test("builds ours from the working tree, theirs from the remote ref, base from HEAD", async () => {
        await writeFileText(workspaceDir, "files/target/EP.codex", "working-content");
        const gitOps = fakeGitOps(["FETCH_HEAD"], {
            "FETCH_HEAD:files/target/EP.codex": "remote-content",
            "HEAD:files/target/EP.codex": "head-content",
        });

        const { synthesized, unsynthesizable } = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/EP.codex"],
            gitOps
        );

        assert.deepStrictEqual(unsynthesizable, []);
        assert.deepStrictEqual(synthesized, [
            {
                filepath: "files/target/EP.codex",
                ours: "working-content",
                theirs: "remote-content",
                base: "head-content",
                isDeleted: false,
                isNew: false,
            },
        ]);
    });

    test("falls back to HEAD for ours when the working tree lacks the file, and flags remote-new files", async () => {
        const gitOps = fakeGitOps(["FETCH_HEAD"], {
            "FETCH_HEAD:files/target/EXISTING.codex": "remote-content",
            "HEAD:files/target/EXISTING.codex": "head-content",
            "FETCH_HEAD:files/target/NEW.codex": "brand-new-remote-content",
        });

        const { synthesized, unsynthesizable } = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/EXISTING.codex", "files/target/NEW.codex"],
            gitOps
        );

        assert.deepStrictEqual(unsynthesizable, []);
        const existing = synthesized.find((c) => c.filepath === "files/target/EXISTING.codex");
        assert.deepStrictEqual(existing, {
            filepath: "files/target/EXISTING.codex",
            ours: "head-content",
            theirs: "remote-content",
            base: "head-content",
            isDeleted: false,
            // isNew keys off disk presence: absent locally → the resolvers'
            // creation path must handle it (their existing-file path would
            // fail a disk stat).
            isNew: true,
        });
        const brandNew = synthesized.find((c) => c.filepath === "files/target/NEW.codex");
        assert.deepStrictEqual(brandNew, {
            filepath: "files/target/NEW.codex",
            ours: "",
            theirs: "brand-new-remote-content",
            base: "",
            isDeleted: false,
            isNew: true,
        });
    });

    test("normalizes incoming paths before reading git state", async () => {
        const gitOps = fakeGitOps(["FETCH_HEAD"], {
            "FETCH_HEAD:files/target/EP.codex": "remote-content",
        });

        const { synthesized } = await synthesizeConflictsForPaths(
            workspaceDir,
            ["./files\\target\\EP.codex"],
            gitOps
        );

        assert.strictEqual(synthesized.length, 1);
        assert.strictEqual(synthesized[0].filepath, "files/target/EP.codex");
    });

    test("reports paths whose remote content cannot be read as unsynthesizable — never invents content", async () => {
        const gitOps = fakeGitOps(["FETCH_HEAD"], {
            "FETCH_HEAD:files/target/OK.codex": "remote-content",
        });

        const { synthesized, unsynthesizable } = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/OK.codex", "files/target/UNREADABLE.codex"],
            gitOps
        );

        assert.deepStrictEqual(
            synthesized.map((c) => c.filepath),
            ["files/target/OK.codex"]
        );
        assert.deepStrictEqual(unsynthesizable, ["files/target/UNREADABLE.codex"]);
    });

    test("falls back through remote ref candidates and gives up cleanly when none resolve", async () => {
        const viaOriginMain = fakeGitOps(["refs/remotes/origin/main"], {
            "refs/remotes/origin/main:files/target/EP.codex": "remote-content",
        });
        const ok = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/EP.codex"],
            viaOriginMain
        );
        assert.strictEqual(ok.synthesized.length, 1);
        assert.strictEqual(ok.synthesized[0].theirs, "remote-content");

        const noRefs = fakeGitOps([], {});
        const failed = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/EP.codex"],
            noRefs
        );
        assert.deepStrictEqual(failed.synthesized, []);
        assert.deepStrictEqual(failed.unsynthesizable, ["files/target/EP.codex"]);
    });

    test("synthesized .codex conflicts resolve through the normal resolvers (newest edit wins)", async () => {
        const ourContent = notebookWithEdit("<span>older local</span>", 1000);
        const theirContent = notebookWithEdit("<span>newer remote</span>", 2000);
        await writeFileText(workspaceDir, "files/target/EP.codex", ourContent);
        const gitOps = fakeGitOps(["FETCH_HEAD"], {
            "FETCH_HEAD:files/target/EP.codex": theirContent,
            "HEAD:files/target/EP.codex": ourContent,
        });

        const { synthesized } = await synthesizeConflictsForPaths(
            workspaceDir,
            ["files/target/EP.codex"],
            gitOps
        );
        const { resolved, failed } = await resolveConflictFiles(synthesized, workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP.codex", resolution: "modified" },
        ]);
        const mergedBytes = await vscode.workspace.fs.readFile(
            vscode.Uri.file(path.join(workspaceDir, "files/target/EP.codex"))
        );
        const merged = JSON.parse(new TextDecoder().decode(mergedBytes));
        assert.strictEqual(merged.cells[0].value, "<span>newer remote</span>");
    });
});

suite("conflictSynthesis - enforceConflictListInvariant", () => {
    let workspaceDir: string;

    setup(async () => {
        workspaceDir = await makeTempWorkspace();
    });

    teardown(async () => {
        await removeDir(workspaceDir);
    });

    // The extension host defines console methods as non-writable, so the log
    // emission is verified through the injectable `log` option instead.

    test("returns no entries when every remote-changed path is in the conflict list", async () => {
        const result = await enforceConflictListInvariant(
            {
                conflicts: [{ filepath: "files/target/EP.codex" }],
                changedPaths: ["files/target/EP.codex"],
                retryCount: 0,
                workspaceDir,
            },
            fakeGitOps([], {})
        );
        assert.deepStrictEqual(result, []);
    });

    test("path formatting differences are not violations (separators, ./, Unicode form)", async () => {
        const result = await enforceConflictListInvariant(
            {
                conflicts: [
                    { filepath: "files/target/EP.codex" },
                    { filepath: "files/target/Genèse.codex".normalize("NFC") },
                ],
                changedPaths: [
                    ".\\files\\target\\EP.codex",
                    "files/target/Genèse.codex".normalize("NFD"),
                ],
                retryCount: 0,
                workspaceDir,
            },
            fakeGitOps([], {})
        );
        assert.deepStrictEqual(result, []);
    });

    test("throws TransientSyncError on early attempts so the retry layer refetches", async () => {
        for (const retryCount of [0, 1]) {
            await assert.rejects(
                enforceConflictListInvariant(
                    {
                        conflicts: [],
                        changedPaths: ["files/target/MISSING.codex"],
                        retryCount,
                        workspaceDir,
                    },
                    fakeGitOps(["FETCH_HEAD"], {
                        "FETCH_HEAD:files/target/MISSING.codex": "remote-content",
                    })
                ),
                (error: unknown) =>
                    error instanceof TransientSyncError &&
                    error.message.includes("files/target/MISSING.codex")
            );
        }
    });

    test("self-heals on the final attempt: synthesizes the missing paths and logs the event", async () => {
        const warns: any[][] = [];
        const result = await enforceConflictListInvariant(
            {
                conflicts: [],
                changedPaths: ["files/target/MISSING.codex"],
                retryCount: 2,
                workspaceDir,
                log: (...args: unknown[]) => {
                    warns.push(args);
                },
            },
            fakeGitOps(["FETCH_HEAD"], {
                "FETCH_HEAD:files/target/MISSING.codex": "remote-content",
                "HEAD:files/target/MISSING.codex": "head-content",
            })
        );

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].filepath, "files/target/MISSING.codex");
        assert.strictEqual(result[0].theirs, "remote-content");
        assert.strictEqual(result[0].ours, "head-content");
        assert.ok(
            warns.some((args) => String(args[0]).includes("invariant self-heal")),
            "the self-heal must emit a log entry"
        );
    });

    test("keeps failing loudly on the final attempt for paths that cannot be synthesized", async () => {
        await assert.rejects(
            enforceConflictListInvariant(
                {
                    conflicts: [],
                    changedPaths: ["files/target/UNREADABLE.codex"],
                    retryCount: 2,
                    workspaceDir,
                },
                fakeGitOps(["FETCH_HEAD"], {})
            ),
            (error: unknown) =>
                error instanceof TransientSyncError &&
                error.message.includes("could not be recovered") &&
                error.message.includes("files/target/UNREADABLE.codex")
        );
    });

    test("integration: a persistent mismatch self-heals end-to-end — the missing file lands merged on disk", async () => {
        // Simulates the frontier response shape on the final attempt: a
        // remote-changed .codex absent from the conflict list on every attempt.
        // The invariant must synthesize it, and the normal resolvers must leave
        // the merged content on disk — which is exactly what the subsequent
        // sync commit stages.
        const ourContent = notebookWithEdit("<span>older local</span>", 1000);
        const theirContent = notebookWithEdit("<span>newer remote</span>", 2000);
        await writeFileText(workspaceDir, "files/target/EP.codex", ourContent);

        const warns: any[][] = [];
        const synthesized = await enforceConflictListInvariant(
            {
                conflicts: [],
                changedPaths: ["files/target/EP.codex"],
                retryCount: 2,
                workspaceDir,
                log: (...args: unknown[]) => {
                    warns.push(args);
                },
            },
            fakeGitOps(["FETCH_HEAD"], {
                "FETCH_HEAD:files/target/EP.codex": theirContent,
                "HEAD:files/target/EP.codex": ourContent,
            })
        );

        const { resolved, failed } = await resolveConflictFiles(synthesized, workspaceDir);

        assert.deepStrictEqual(failed, []);
        assert.deepStrictEqual(resolved, [
            { filepath: "files/target/EP.codex", resolution: "modified" },
        ]);
        const mergedBytes = await vscode.workspace.fs.readFile(
            vscode.Uri.file(path.join(workspaceDir, "files/target/EP.codex"))
        );
        const merged = JSON.parse(new TextDecoder().decode(mergedBytes));
        assert.strictEqual(
            merged.cells[0].value,
            "<span>newer remote</span>",
            "the remote-changed file is merged, not dropped"
        );
        assert.ok(warns.some((args) => String(args[0]).includes("invariant self-heal")));
    });
});
