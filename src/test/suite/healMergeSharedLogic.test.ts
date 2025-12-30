import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { resolveConflictFile } from "../../projectManager/utils/merge/resolvers";
import { ConflictFile } from "../../projectManager/utils/merge/types";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";

suite("Heal + Sync shared merge engine", () => {
    test("resolveConflictFile(refreshOursFromDisk=false) preserves provided ours content", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-refresh-"));
        try {
            const filePath = path.join(tempDir, "test.txt");
            fs.writeFileSync(filePath, "disk-content", "utf8");

            const conflict: ConflictFile = {
                filepath: "test.txt",
                ours: "snapshot-content",
                theirs: "cloned-content",
                base: "cloned-content",
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const finalContent = fs.readFileSync(filePath, "utf8");
            assert.strictEqual(finalContent, "snapshot-content");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("resolveConflictFile(default refresh) re-reads disk and can override provided ours", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-refresh-default-"));
        try {
            const filePath = path.join(tempDir, "test.txt");
            fs.writeFileSync(filePath, "disk-content", "utf8");

            const conflict: ConflictFile = {
                filepath: "test.txt",
                ours: "snapshot-content",
                theirs: "cloned-content",
                base: "cloned-content",
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir);

            const finalContent = fs.readFileSync(filePath, "utf8");
            assert.strictEqual(finalContent, "disk-content");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("buildConflictsFromDirectories builds text conflicts, binary copies, and excludes .git/**", async function () {
        this.timeout(10000);

        const oursDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-ours-"));
        const theirsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-theirs-"));
        try {
            // Theirs has a.txt and a .git folder (should be ignored anyway)
            fs.writeFileSync(path.join(theirsDir, "a.txt"), "theirs-a", "utf8");
            fs.mkdirSync(path.join(theirsDir, ".git"), { recursive: true });
            fs.writeFileSync(path.join(theirsDir, ".git", "config"), "theirs-git", "utf8");

            // Ours snapshot has a.txt (modified), b.txt (new), an image (binary), and a .git folder
            fs.writeFileSync(path.join(oursDir, "a.txt"), "ours-a", "utf8");
            fs.writeFileSync(path.join(oursDir, "b.txt"), "ours-b", "utf8");
            fs.writeFileSync(path.join(oursDir, "image.png"), Buffer.from([1, 2, 3]));
            // Generated databases should be skippable via exclude callback
            fs.writeFileSync(path.join(oursDir, "generated.sqlite"), "sqlite-bytes", "utf8");
            fs.mkdirSync(path.join(oursDir, ".git"), { recursive: true });
            fs.writeFileSync(path.join(oursDir, ".git", "config"), "ours-git", "utf8");

            const result = await buildConflictsFromDirectories({
                oursRoot: vscode.Uri.file(oursDir),
                theirsRoot: vscode.Uri.file(theirsDir),
                exclude: (rel) => rel.endsWith(".sqlite") || rel.endsWith(".sqlite3") || rel.endsWith(".db"),
                isBinary: (rel) => rel.endsWith(".png"),
            });

            // .git/** excluded
            assert.ok(!result.textConflicts.some((c) => c.filepath.startsWith(".git/")));
            assert.ok(!result.binaryCopies.some((c) => c.filepath.startsWith(".git/")));
            assert.ok(!result.textConflicts.some((c) => c.filepath.endsWith(".sqlite")));
            assert.ok(!result.binaryCopies.some((c) => c.filepath.endsWith(".sqlite")));

            // Binary copied, not merged
            assert.deepStrictEqual(
                result.binaryCopies.map((b) => b.filepath).sort(),
                ["image.png"]
            );
            assert.strictEqual(result.binaryCopies[0].content.length, 3);

            // Text conflicts include both a.txt and b.txt
            const byPath = new Map(result.textConflicts.map((c) => [c.filepath, c] as const));
            assert.ok(byPath.has("a.txt"));
            assert.ok(byPath.has("b.txt"));

            const a = byPath.get("a.txt")!;
            assert.strictEqual(a.ours, "ours-a");
            assert.strictEqual(a.theirs, "theirs-a");
            assert.strictEqual(a.base, "theirs-a");
            assert.strictEqual(a.isNew, false);
            assert.strictEqual(a.isDeleted, false);

            const b = byPath.get("b.txt")!;
            assert.strictEqual(b.ours, "ours-b");
            assert.strictEqual(b.theirs, "");
            assert.strictEqual(b.base, "");
            assert.strictEqual(b.isNew, true);
            assert.strictEqual(b.isDeleted, false);
        } finally {
            fs.rmSync(oursDir, { recursive: true, force: true });
            fs.rmSync(theirsDir, { recursive: true, force: true });
        }
    });
});

