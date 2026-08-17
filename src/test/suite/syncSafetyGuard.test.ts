import * as assert from "assert";
import {
    confirmEmptiedCodexFiles,
    countNotebookCells,
    findEmptiedCodexFiles,
    type EmptiedCodexFile,
    type SyncSafetyGuardDeps,
} from "../../projectManager/utils/syncSafetyGuard";

/**
 * Issue #1119: sync must refuse to commit a working tree in which a
 * previously-translated `.codex` file has collapsed to zero cells (or become
 * unparseable) — committing it pushes the data loss to the whole team.
 */
suite("syncSafetyGuard", () => {
    const notebook = (cellCount: number): string =>
        JSON.stringify({
            cells: Array.from({ length: cellCount }, (_, i) => ({
                kind: 2,
                value: `cell ${i}`,
                languageId: "html",
                metadata: { id: `c${i}` },
            })),
            metadata: { edits: [] },
        });

    function makeDeps(
        files: {
            [relativePath: string]: { working?: string; head?: string; };
        },
        options: {
            changedPaths?: string[];
            changedPathsError?: Error;
            onWorkingRead?: (relativePath: string) => void;
            workingOverride?: (relativePath: string) => string | undefined;
        } = {}
    ): SyncSafetyGuardDeps {
        return {
            async listCodexFiles() {
                return Object.keys(files);
            },
            ...(options.changedPaths || options.changedPathsError
                ? {
                      async listPathsChangedFromHead() {
                          if (options.changedPathsError) {
                              throw options.changedPathsError;
                          }
                          return new Set(options.changedPaths ?? []);
                      },
                  }
                : {}),
            async readWorkingText(relativePath) {
                options.onWorkingRead?.(relativePath);
                const working = options.workingOverride?.(relativePath) ?? files[relativePath]?.working;
                if (working === undefined) {
                    throw new Error(`unreadable: ${relativePath}`);
                }
                return working;
            },
            async readHeadText(relativePath) {
                return files[relativePath]?.head;
            },
        };
    }

    suite("countNotebookCells", () => {
        test("counts cells of a valid notebook", () => {
            assert.strictEqual(countNotebookCells(notebook(3)), 3);
            assert.strictEqual(countNotebookCells(notebook(0)), 0);
        });

        test("returns null for invalid JSON and non-notebook JSON", () => {
            assert.strictEqual(countNotebookCells(""), null);
            assert.strictEqual(countNotebookCells("{ truncated"), null);
            assert.strictEqual(countNotebookCells('{"metadata":{}}'), null);
        });
    });

    suite("confirmEmptiedCodexFiles (mid-write re-check)", () => {
        const candidate: EmptiedCodexFile = {
            relativePath: "files/target/EP1.codex",
            headCellCount: 40,
            reason: "unparseable",
        };

        test("drops a file whose real content lands during the re-check", async () => {
            // The scan caught the file mid-write. It is still truncated on the
            // first re-read and only lands on the second, so the guard must
            // keep looking rather than restoring HEAD over newer work.
            let reads = 0;
            const deps = makeDeps(
                { "files/target/EP1.codex": { head: notebook(40) } },
                {
                    workingOverride: () => {
                        reads++;
                        return reads === 1 ? "{\"cells\":[{\"va" : notebook(41);
                    },
                }
            );

            const confirmed = await confirmEmptiedCodexFiles(deps, [candidate], {
                delaysMs: [0, 0],
                wait: async () => undefined,
            });
            assert.strictEqual(reads, 2, "must re-read until the file settles");
            assert.deepStrictEqual(confirmed, []);
        });

        test("keeps a file that is still empty on every re-read", async () => {
            const deps = makeDeps(
                { "files/target/EP1.codex": { working: notebook(0), head: notebook(40) } }
            );

            const confirmed = await confirmEmptiedCodexFiles(deps, [candidate], {
                delaysMs: [0, 0],
                wait: async () => undefined,
            });
            assert.deepStrictEqual(confirmed, [candidate]);
        });

        test("keeps a file that stays unreadable on every re-read", async () => {
            const deps = makeDeps({ "files/target/EP1.codex": { head: notebook(40) } });

            const confirmed = await confirmEmptiedCodexFiles(deps, [candidate], {
                delaysMs: [0, 0],
                wait: async () => undefined,
            });
            assert.deepStrictEqual(confirmed, [candidate]);
        });

        test("does not wait at all when nothing was flagged", async () => {
            let waited = 0;
            const deps = makeDeps({});

            const confirmed = await confirmEmptiedCodexFiles(deps, [], {
                delaysMs: [50, 250],
                wait: async () => {
                    waited++;
                },
            });
            assert.deepStrictEqual(confirmed, []);
            assert.strictEqual(waited, 0, "healthy syncs must not pay the re-check delay");
        });
    });

    suite("findEmptiedCodexFiles", () => {
        test("flags a file emptied relative to HEAD (the Lingala S306 wipe)", async () => {
            const wipedSkeleton = JSON.stringify({
                cells: [],
                metadata: {
                    edits: [],
                    corpusMarker: "subtitles",
                    fileDisplayName: "TheChosen_306_en_SingleSpeaker",
                },
            });
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/TheChosen_306.codex": {
                        working: wipedSkeleton,
                        head: notebook(1020),
                    },
                })
            );
            assert.strictEqual(violations.length, 1);
            assert.strictEqual(violations[0].relativePath, "files/target/TheChosen_306.codex");
            assert.strictEqual(violations[0].headCellCount, 1020);
            assert.strictEqual(violations[0].reason, "emptied");
        });

        test("flags an unparseable (truncated) working file", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/A.codex": {
                        working: notebook(50).slice(0, 100),
                        head: notebook(50),
                    },
                })
            );
            assert.strictEqual(violations.length, 1);
            assert.strictEqual(violations[0].reason, "unparseable");
        });

        test("flags an unreadable working file when HEAD had cells", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/A.codex": { head: notebook(5) },
                })
            );
            assert.strictEqual(violations.length, 1);
            assert.strictEqual(violations[0].reason, "unparseable");
        });

        test("does not flag files with cells in the working tree", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/A.codex": { working: notebook(3), head: notebook(500) },
                })
            );
            assert.strictEqual(violations.length, 0);
        });

        test("does not flag a genuinely new empty notebook (no HEAD version)", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/New.codex": { working: notebook(0) },
                })
            );
            assert.strictEqual(violations.length, 0);
        });

        test("does not flag a file that was already empty at HEAD", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/Empty.codex": { working: notebook(0), head: notebook(0) },
                })
            );
            assert.strictEqual(violations.length, 0);
        });

        test("skips files git reports as identical to HEAD (never reads them)", async () => {
            const read: string[] = [];
            const deps = makeDeps(
                {
                    "files/target/EP1.codex": { working: notebook(0), head: notebook(40) },
                    "files/target/EP2.codex": { working: notebook(0), head: notebook(40) },
                },
                { changedPaths: ["files/target/EP2.codex"], onWorkingRead: (p) => read.push(p) }
            );

            const violations = await findEmptiedCodexFiles(deps);

            // EP1 looks emptied on paper, but git says it matches HEAD, so it
            // cannot have been emptied relative to HEAD — and must not be read.
            assert.deepStrictEqual(read, ["files/target/EP2.codex"]);
            assert.strictEqual(violations.length, 1);
            assert.strictEqual(violations[0].relativePath, "files/target/EP2.codex");
        });

        test("still flags a changed file that was emptied", async () => {
            const deps = makeDeps(
                { "files/target/EP1.codex": { working: notebook(0), head: notebook(40) } },
                { changedPaths: ["files/target/EP1.codex"] }
            );

            const violations = await findEmptiedCodexFiles(deps);
            assert.strictEqual(violations.length, 1);
            assert.strictEqual(violations[0].reason, "emptied");
            assert.strictEqual(violations[0].headCellCount, 40);
        });

        test("scans everything when the changed-path lookup fails (fails safe)", async () => {
            const read: string[] = [];
            const deps = makeDeps(
                {
                    "files/target/EP1.codex": { working: notebook(0), head: notebook(40) },
                    "files/target/EP2.codex": { working: notebook(0), head: notebook(12) },
                },
                { changedPathsError: new Error("git unavailable"), onWorkingRead: (p) => read.push(p) }
            );

            const violations = await findEmptiedCodexFiles(deps);

            // A broken git lookup must never silently disable the guard.
            assert.strictEqual(read.length, 2);
            assert.strictEqual(violations.length, 2);
        });

        test("scans everything when no changed-path lookup is provided", async () => {
            const read: string[] = [];
            const deps = makeDeps(
                { "files/target/EP1.codex": { working: notebook(0), head: notebook(40) } },
                { onWorkingRead: (p) => read.push(p) }
            );

            const violations = await findEmptiedCodexFiles(deps);
            assert.deepStrictEqual(read, ["files/target/EP1.codex"]);
            assert.strictEqual(violations.length, 1);
        });

        test("checks every file and reports all violations", async () => {
            const violations = await findEmptiedCodexFiles(
                makeDeps({
                    "files/target/Fine.codex": { working: notebook(10), head: notebook(10) },
                    "files/target/Wiped1.codex": { working: notebook(0), head: notebook(10) },
                    "files/target/Wiped2.codex": { working: "garbage", head: notebook(7) },
                    "files/target/New.codex": { working: notebook(0) },
                })
            );
            assert.deepStrictEqual(
                violations.map((v) => v.relativePath).sort(),
                ["files/target/Wiped1.codex", "files/target/Wiped2.codex"]
            );
        });
    });
});
