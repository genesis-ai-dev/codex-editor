import { EXTENSION_PIN_POLICY } from "../../../sharedUtils/extensionPinFeatureFlag";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { MetadataManager } from "../../utils/metadataManager";
import { resolveConflictFile, resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";
import type { ConflictFile } from "../../projectManager/utils/merge/types";

suite("Pin cleanup in metadata merges", () => {
    let directory: string;
    setup(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-pin-merge-")); });
    teardown(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    test("disabled policy preserves incoming pins on new metadata", async () => {
        EXTENSION_PIN_POLICY.ignoreProjectPins = false;
        try {
            const content = '{"meta":{"pinnedExtensions":{"ext":{"version":"1","url":"url"}}}}';
            const conflict: ConflictFile = { filepath: "metadata.json", base: "", ours: "", theirs: content, isDeleted: false, isNew: true };
            assert.deepStrictEqual((await resolveConflictFiles([conflict], directory)).failed, []);
            assert.strictEqual(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"), content);
        } finally { EXTENSION_PIN_POLICY.ignoreProjectPins = true; }
    });

    test("queued merges retain fresh local edits and remote fields while clearing pins", async () => {
        const file = path.join(directory, "metadata.json");
        const base = { projectName: "original", meta: { requiredExtensions: { codexEditor: "1.0.0" }, pinnedExtensions: {} } };
        fs.writeFileSync(file, JSON.stringify(base));
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const writer = MetadataManager.withMetadataWrite(vscode.Uri.file(directory), async () => {
            await gate;
            fs.writeFileSync(file, JSON.stringify({ ...base, projectName: "new local name", localOnly: "keep" }));
        });
        const remote = { ...base, remoteOnly: "keep too", meta: { ...base.meta,
            requiredExtensions: { codexEditor: "2.0.0" },
            pinnedExtensions: { ext: { version: "9.0.0", url: "url" } },
        } };
        const conflict: ConflictFile = { filepath: "metadata.json", base: JSON.stringify(base), ours: JSON.stringify(base),
            theirs: JSON.stringify(remote), isDeleted: false, isNew: false };
        const merge = resolveConflictFile(conflict, directory);
        release();
        await writer;
        assert.strictEqual(await merge, "metadata.json");
        const actual = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.strictEqual(actual.projectName, "new local name");
        assert.strictEqual(actual.localOnly, "keep");
        assert.strictEqual(actual.remoteOnly, "keep too");
        assert.deepStrictEqual(actual.meta.requiredExtensions, { codexEditor: "2.0.0" });
        assert.deepStrictEqual(actual.meta.pinnedExtensions, {});
    });

    test("new remote metadata receives only the pin-value edit", async () => {
        const content = '{\r\n "meta":{"pinnedExtensions":{"ext":{}},"keep":1e2},"custom":"\\u0061"\r\n}\r\n';
        const conflict: ConflictFile = { filepath: "metadata.json", base: "", ours: "", theirs: content, isDeleted: false, isNew: true };
        const result = await resolveConflictFiles([conflict], directory);
        assert.deepStrictEqual(result.failed, []);
        assert.strictEqual(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"), content.replace('{"ext":{}}', '{}'));
    });
    test("a new-file import merges metadata created by an earlier queued writer", async () => {
        const file = path.join(directory, "metadata.json");
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const writer = MetadataManager.withMetadataWrite(vscode.Uri.file(directory), async () => {
            await gate;
            fs.writeFileSync(file, JSON.stringify({ localOnly: "preserve", meta: { pinnedExtensions: {} } }));
        });
        const conflict: ConflictFile = { filepath: "metadata.json", base: "", ours: "",
            theirs: '{"remoteOnly":"preserve too","meta":{"pinnedExtensions":{"ext":{}}}}',
            isDeleted: false, isNew: true };
        const merge = resolveConflictFiles([conflict], directory);
        release();
        await writer;
        assert.deepStrictEqual((await merge).failed, []);
        const actual = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.strictEqual(actual.localOnly, "preserve");
        assert.strictEqual(actual.remoteOnly, "preserve too");
        assert.deepStrictEqual(actual.meta.pinnedExtensions, {});
    });

});
