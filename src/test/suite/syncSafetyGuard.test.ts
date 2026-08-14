import * as assert from "assert";
import {
    countNotebookCells,
    findEmptiedCodexFiles,
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

    function makeDeps(files: {
        [relativePath: string]: { working?: string; head?: string; };
    }): SyncSafetyGuardDeps {
        return {
            async listCodexFiles() {
                return Object.keys(files);
            },
            async readWorkingText(relativePath) {
                const working = files[relativePath]?.working;
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
