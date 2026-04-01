import * as assert from "assert";
import { mergeOriginalFilesHashes } from "../../../projectManager/utils/merge/resolvers";

type HashRegistryInput = Parameters<typeof mergeOriginalFilesHashes>[0];

const makeEntry = (hash: string, fileName: string, referencedBy: string[], originalNames: string[] = [fileName], addedAt = new Date().toISOString()) => ({
    hash,
    fileName,
    originalNames,
    referencedBy,
    addedAt,
});

const makeRegistry = (
    files: Record<string, ReturnType<typeof makeEntry>>,
    version = 1
): HashRegistryInput => ({
    version,
    files,
    fileNameToHash: Object.fromEntries(
        Object.entries(files).map(([hash, entry]) => [entry.fileName, hash])
    ),
});

suite("Resolver unit: mergeOriginalFilesHashes", () => {
    test("returns undefined when all three inputs are undefined", () => {
        const result = mergeOriginalFilesHashes(undefined, undefined, undefined);
        assert.strictEqual(result, undefined);
    });

    test("returns undefined when ours and theirs have no files and base is also undefined", () => {
        const result = mergeOriginalFilesHashes(undefined, { version: 1, files: {}, fileNameToHash: {} }, { version: 1, files: {}, fileNameToHash: {} });
        assert.strictEqual(result, undefined);
    });

    test("falls back to base when ours and theirs have no files but base does", () => {
        const base = makeRegistry({ abc: makeEntry("abc", "doc.docx", ["MAT"]) });
        const result = mergeOriginalFilesHashes(base, { version: 1, files: {}, fileNameToHash: {} }, { version: 1, files: {}, fileNameToHash: {} });
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 1);
        assert.ok(result.files["abc"]);
        assert.strictEqual(result.fileNameToHash["doc.docx"], "abc");
    });

    test("returns ours entry when theirs is undefined", () => {
        const ours = makeRegistry({ h1: makeEntry("h1", "file1.docx", ["MAT"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, undefined);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 1);
        assert.deepStrictEqual(result.files["h1"].referencedBy, ["MAT"]);
    });

    test("returns theirs entry when ours is undefined", () => {
        const theirs = makeRegistry({ h2: makeEntry("h2", "file2.docx", ["GEN"]) });
        const result = mergeOriginalFilesHashes(undefined, undefined, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 1);
        assert.deepStrictEqual(result.files["h2"].referencedBy, ["GEN"]);
    });

    test("unions entries with different hashes from ours and theirs", () => {
        const ours = makeRegistry({ h1: makeEntry("h1", "user1-doc.docx", ["MAT"]) });
        const theirs = makeRegistry({ h2: makeEntry("h2", "user2-doc.docx", ["GEN"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 2);
        assert.ok(result.files["h1"]);
        assert.ok(result.files["h2"]);
        assert.strictEqual(result.fileNameToHash["user1-doc.docx"], "h1");
        assert.strictEqual(result.fileNameToHash["user2-doc.docx"], "h2");
    });

    test("merges referencedBy when both sides have the same hash", () => {
        const ours = makeRegistry({ shared: makeEntry("shared", "document.docx", ["MAT-user1"]) });
        const theirs = makeRegistry({ shared: makeEntry("shared", "document.docx", ["MAT-user2"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 1);
        const entry = result.files["shared"];
        assert.deepStrictEqual(entry.referencedBy.sort(), ["MAT-user1", "MAT-user2"]);
    });

    test("deduplicates referencedBy when both sides have overlapping entries", () => {
        const ours = makeRegistry({ h: makeEntry("h", "doc.docx", ["MAT", "GEN"]) });
        const theirs = makeRegistry({ h: makeEntry("h", "doc.docx", ["MAT", "REV"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        const entry = result.files["h"];
        assert.deepStrictEqual(entry.referencedBy.sort(), ["GEN", "MAT", "REV"]);
    });

    test("merges originalNames when both sides have the same hash", () => {
        const ours = makeRegistry({ h: makeEntry("h", "stored.docx", ["MAT"], ["original-a.docx"]) });
        const theirs = makeRegistry({ h: makeEntry("h", "stored.docx", ["GEN"], ["original-b.docx"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        const entry = result.files["h"];
        assert.deepStrictEqual(entry.originalNames.sort(), ["original-a.docx", "original-b.docx"]);
    });

    test("deduplicates originalNames when both sides share entries", () => {
        const ours = makeRegistry({ h: makeEntry("h", "stored.docx", ["MAT"], ["same.docx", "unique-a.docx"]) });
        const theirs = makeRegistry({ h: makeEntry("h", "stored.docx", ["GEN"], ["same.docx", "unique-b.docx"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        const entry = result.files["h"];
        assert.deepStrictEqual(entry.originalNames.sort(), ["same.docx", "unique-a.docx", "unique-b.docx"]);
    });

    test("uses Math.max for version number", () => {
        const ours = makeRegistry({ h1: makeEntry("h1", "a.docx", ["MAT"]) }, 2);
        const theirs = makeRegistry({ h2: makeEntry("h2", "b.docx", ["GEN"]) }, 5);
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.version, 5);
    });

    test("defaults version to 1 when both sides omit it", () => {
        const ours: HashRegistryInput = { files: { h: makeEntry("h", "a.docx", ["MAT"]) }, fileNameToHash: { "a.docx": "h" } };
        const theirs: HashRegistryInput = { files: {}, fileNameToHash: {} };
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.version, 1);
    });

    test("builds fileNameToHash from merged entries correctly", () => {
        const ours = makeRegistry({
            h1: makeEntry("h1", "alpha.docx", ["MAT"]),
            h2: makeEntry("h2", "beta.docx", ["GEN"]),
        });
        const theirs = makeRegistry({
            h2: makeEntry("h2", "beta.docx", ["REV"]),
            h3: makeEntry("h3", "gamma.docx", ["EXO"]),
        });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.fileNameToHash["alpha.docx"], "h1");
        assert.strictEqual(result.fileNameToHash["beta.docx"], "h2");
        assert.strictEqual(result.fileNameToHash["gamma.docx"], "h3");
    });

    test("handles ours-only entry correctly (theirs missing that hash)", () => {
        const ours = makeRegistry({
            exclusive: makeEntry("exclusive", "only-ours.docx", ["MAT"]),
            shared: makeEntry("shared", "common.docx", ["GEN"]),
        });
        const theirs = makeRegistry({
            shared: makeEntry("shared", "common.docx", ["REV"]),
        });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 2);
        assert.deepStrictEqual(result.files["exclusive"].referencedBy, ["MAT"]);
        assert.deepStrictEqual(result.files["shared"].referencedBy.sort(), ["GEN", "REV"]);
    });

    test("handles theirs-only entry correctly (ours missing that hash)", () => {
        const ours = makeRegistry({
            shared: makeEntry("shared", "common.docx", ["MAT"]),
        });
        const theirs = makeRegistry({
            shared: makeEntry("shared", "common.docx", ["GEN"]),
            exclusive: makeEntry("exclusive", "only-theirs.docx", ["REV"]),
        });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 2);
        assert.deepStrictEqual(result.files["exclusive"].referencedBy, ["REV"]);
        assert.deepStrictEqual(result.files["shared"].referencedBy.sort(), ["GEN", "MAT"]);
    });

    test("preserves extra properties on entries during merge", () => {
        const addedAt = "2025-01-15T10:00:00.000Z";
        const ours = makeRegistry({ h: makeEntry("h", "doc.docx", ["MAT"], ["doc.docx"], addedAt) });
        const theirs = makeRegistry({ h: makeEntry("h", "doc.docx", ["GEN"], ["doc.docx"], addedAt) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.files["h"].addedAt, addedAt);
        assert.strictEqual(result.files["h"].hash, "h");
        assert.strictEqual(result.files["h"].fileName, "doc.docx");
    });

    test("handles empty referencedBy and originalNames arrays gracefully", () => {
        const ours = makeRegistry({ h: { hash: "h", fileName: "doc.docx", originalNames: [], referencedBy: [], addedAt: "" } as any });
        const theirs = makeRegistry({ h: makeEntry("h", "doc.docx", ["MAT"], ["original.docx"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.deepStrictEqual(result.files["h"].referencedBy, ["MAT"]);
        assert.deepStrictEqual(result.files["h"].originalNames, ["original.docx"]);
    });

    test("handles missing referencedBy and originalNames properties via fallback to empty array", () => {
        const ours: HashRegistryInput = {
            version: 1,
            files: { h: { hash: "h", fileName: "doc.docx" } as any },
            fileNameToHash: { "doc.docx": "h" },
        };
        const theirs = makeRegistry({ h: makeEntry("h", "doc.docx", ["GEN"], ["name.docx"]) });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.deepStrictEqual(result.files["h"].referencedBy, ["GEN"]);
        assert.deepStrictEqual(result.files["h"].originalNames, ["name.docx"]);
    });

    test("complex scenario: multiple hashes, some shared, some exclusive per side", () => {
        const ours = makeRegistry({
            shared1: makeEntry("shared1", "common1.docx", ["MAT-u1"], ["common1.docx"]),
            shared2: makeEntry("shared2", "common2.idml", ["GEN-u1", "EXO-u1"], ["common2.idml"]),
            oursOnly: makeEntry("oursOnly", "local.pdf", ["REV-u1"], ["local.pdf"]),
        });
        const theirs = makeRegistry({
            shared1: makeEntry("shared1", "common1.docx", ["MAT-u2"], ["common1-renamed.docx"]),
            shared2: makeEntry("shared2", "common2.idml", ["GEN-u2"], ["common2.idml"]),
            theirsOnly: makeEntry("theirsOnly", "remote.pdf", ["LEV-u2"], ["remote.pdf"]),
        });
        const result = mergeOriginalFilesHashes(undefined, ours, theirs);
        assert.ok(result);
        assert.strictEqual(Object.keys(result.files).length, 4);

        assert.deepStrictEqual(result.files["shared1"].referencedBy.sort(), ["MAT-u1", "MAT-u2"]);
        assert.deepStrictEqual(result.files["shared1"].originalNames.sort(), ["common1-renamed.docx", "common1.docx"]);

        assert.deepStrictEqual(result.files["shared2"].referencedBy.sort(), ["EXO-u1", "GEN-u1", "GEN-u2"]);
        assert.deepStrictEqual(result.files["shared2"].originalNames, ["common2.idml"]);

        assert.deepStrictEqual(result.files["oursOnly"].referencedBy, ["REV-u1"]);
        assert.deepStrictEqual(result.files["theirsOnly"].referencedBy, ["LEV-u2"]);

        assert.strictEqual(result.fileNameToHash["common1.docx"], "shared1");
        assert.strictEqual(result.fileNameToHash["common2.idml"], "shared2");
        assert.strictEqual(result.fileNameToHash["local.pdf"], "oursOnly");
        assert.strictEqual(result.fileNameToHash["remote.pdf"], "theirsOnly");
    });
});
