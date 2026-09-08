import * as assert from "assert";
import { createHash } from "crypto";
import * as path from "path";
import { OriginalFileError, OriginalFileResolver } from "../../../exportHandler/originalFileResolver";
import { ExportCancelledError, downloadLfsWithRetry } from "../../../exportHandler/exportDownloadUtils";
import type { LFSPointer } from "../../../utils/lfsPointerUtils";

const root = path.resolve("/original-resolver-project");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pointerFor = (bytes: Uint8Array) => Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${hash(bytes)}\nsize ${bytes.byteLength}\n`
);
const originalPath = (folder: "files" | "pointers" | "legacy", name = "sample.docx") =>
    path.join(root, ".project", "attachments", ...(folder === "legacy" ? [] : [folder]), "originals", name);

function fixture(options: { signal?: AbortSignal; cacheLimitBytes?: number; } = {}) {
    const disk = new Map<string, Uint8Array>();
    const downloads: string[] = [];
    const announcements: string[] = [];
    const remote = new Map<string, Uint8Array>();
    const readFile = async (filePath: string) => {
        const data = disk.get(filePath);
        if (data === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" });
        return data;
    };
    const download = async (_project: string, pointer: LFSPointer) => {
        downloads.push(pointer.oid);
        const data = remote.get(pointer.oid);
        if (!data) throw new Error("404 original unavailable");
        return data;
    };
    const resolver = new OriginalFileResolver({
        ...options, readFile, download, onDownload: name => announcements.push(name),
    });
    return { disk, remote, downloads, announcements, resolver, readFile, download };
}

suite("Original file resolution for round-trip export", () => {
    for (const folder of ["files", "legacy", "pointers"] as const) {
        test(`uses full local originals from ${folder} without a download`, async () => {
            const f = fixture();
            const original = Buffer.from("PK-local original document");
            f.disk.set(originalPath(folder), original);
            const result = await f.resolver.read(root, { fileNames: ["sample.docx"] });
            assert.deepStrictEqual(result.data, original);
            assert.deepStrictEqual(f.downloads, []);
            assert.deepStrictEqual(f.announcements, []);
        });
    }

    test("a stub in files/ does not hide a full local original in the sync mirror", async () => {
        const f = fixture();
        const original = Buffer.from("PK-mirrored original document");
        const stub = pointerFor(original);
        f.disk.set(originalPath("files"), stub);
        f.disk.set(originalPath("pointers"), original);
        assert.deepStrictEqual((await f.resolver.read(root, { fileNames: ["sample.docx"] })).data, original);
        assert.deepStrictEqual(f.downloads, []);
        assert.deepStrictEqual(f.disk.get(originalPath("files")), stub, "export must not rewrite the stub");
    });

    test("skips a stale local copy rather than substituting the wrong original", async () => {
        const f = fixture();
        const correct = Buffer.from("correct document");
        f.disk.set(originalPath("files"), pointerFor(correct));
        f.disk.set(originalPath("legacy"), Buffer.from("wrong document"));
        f.disk.set(originalPath("pointers"), correct);
        assert.deepStrictEqual((await f.resolver.read(root, { fileNames: ["sample.docx"] })).data, correct);
        assert.deepStrictEqual(f.downloads, []);
    });

    test("respects the import hash when a local filename points at the wrong document", async () => {
        const f = fixture();
        const correct = Buffer.from("right");
        f.disk.set(originalPath("files"), Buffer.from("wrong"));
        f.disk.set(originalPath("pointers"), correct);
        const result = await f.resolver.read(root, { fileNames: ["sample.docx"], expectedHash: hash(correct) });
        assert.deepStrictEqual(result.data, correct);
    });

    test("finds legacy USFM filenames in the mirror", async () => {
        const f = fixture();
        f.disk.set(originalPath("pointers", "GEN.SFM"), Buffer.from("\\id GEN\n"));
        const result = await f.resolver.read(root, { fileNames: ["GEN.usfm", "GEN.sfm", "GEN.USFM", "GEN.SFM"] });
        assert.strictEqual(result.fileName, "GEN.SFM");
        assert.deepStrictEqual(f.downloads, []);
    });

    test("uses embedded originals offline even when the disk contains a pointer", async () => {
        const f = fixture();
        const raw = Buffer.from("\uFEFF\\id GEN\n");
        f.disk.set(originalPath("files", "GEN.usfm"), pointerFor(raw));
        const result = await f.resolver.read(root, {
            fileNames: ["GEN.usfm"], expectedHash: hash(raw), embeddedContent: "\\id GEN\n",
        });
        assert.strictEqual(Buffer.from(result.data).toString(), "\\id GEN\n");
        assert.deepStrictEqual(f.downloads, []);
    });

    test("uses verified local Git LFS objects without contacting the server", async () => {
        const f = fixture();
        const data = Buffer.from("PK-cached original");
        const oid = hash(data);
        f.disk.set(originalPath("pointers"), pointerFor(data));
        f.disk.set(path.join(root, ".git", "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid), data);
        assert.deepStrictEqual((await f.resolver.read(root, { fileNames: ["sample.docx"] })).data, data);
        assert.deepStrictEqual(f.downloads, []);
    });

    for (const name of ["sample.docx", "sample.idml", "sample.md", "sample.tmx", "sample.xlf", "GEN.usfm", "sample.csv", "sample.tsv"]) {
        test(`downloads and verifies pointer-only ${name} without modifying project files`, async () => {
            const f = fixture();
            const data = Buffer.from("Hi\n"); // Valid text can be shorter than ten bytes.
            const stub = pointerFor(data);
            f.disk.set(originalPath("pointers", name), stub);
            f.remote.set(hash(data), data);
            const before = [...f.disk.entries()];
            assert.deepStrictEqual((await f.resolver.read(root, { fileNames: [name] })).data, data);
            assert.deepStrictEqual([...f.disk.entries()], before);
            assert.deepStrictEqual(f.downloads, [hash(data)]);
            assert.deepStrictEqual(f.announcements, [name]);
        });
    }

    test("reuses an object's bytes within an export, and releases them on clear", async () => {
        const f = fixture();
        const data = Buffer.from("shared original");
        f.disk.set(originalPath("files"), pointerFor(data));
        f.remote.set(hash(data), data);
        await Promise.all([1, 2].map(() => f.resolver.read(root, { fileNames: ["sample.docx"] })));
        await f.resolver.read(root, { fileNames: ["sample.docx"] });
        assert.strictEqual(f.downloads.length, 1);
        f.resolver.clear();
        await f.resolver.read(root, { fileNames: ["sample.docx"] });
        assert.strictEqual(f.downloads.length, 2);
    });

    test("bounds the amount of downloaded data retained in memory", async () => {
        const f = fixture({ cacheLimitBytes: 4 });
        for (const name of ["one", "two"]) {
            const data = Buffer.from(name);
            f.disk.set(originalPath("files", name), pointerFor(data));
            f.remote.set(hash(data), data);
            await f.resolver.read(root, { fileNames: [name] });
        }
        await f.resolver.read(root, { fileNames: ["one"] });
        assert.strictEqual(f.downloads.length, 3);
    });

    for (const returned of [Buffer.from("wrong"), Buffer.from("longer than expected")]) {
        test(`rejects a corrupt download (${returned.length} bytes)`, async () => {
            const f = fixture();
            const original = Buffer.from("right");
            f.disk.set(originalPath("files"), pointerFor(original));
            f.remote.set(hash(original), returned);
            await assert.rejects(f.resolver.read(root, { fileNames: ["sample.docx"] }), /size or SHA-256/);
        });
    }

    for (const stub of [
        "version https://git-lfs.github.com/spec/v1\noid sha256:invalid\nsize 2\n",
        "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 2junk\n",
    ]) {
        test("rejects malformed pointers instead of returning pointer text to exporters", async () => {
            const f = fixture();
            f.disk.set(originalPath("files"), Buffer.from(stub));
            await assert.rejects(f.resolver.read(root, { fileNames: ["sample.docx"] }), /Invalid LFS pointer/);
            assert.deepStrictEqual(f.downloads, []);
        });
    }

    test("reports unavailable remote originals, without falling back to pointer text", async () => {
        const f = fixture();
        f.disk.set(originalPath("files"), pointerFor(Buffer.from("remote")));
        await assert.rejects(f.resolver.read(root, { fileNames: ["sample.docx"] }),
            (error: unknown) => error instanceof OriginalFileError && error.reason === "download" && error.message.includes("404"));
    });

    test("distinguishes missing originals from unreadable/corrupt originals", async () => {
        const f = fixture();
        await assert.rejects(f.resolver.read(root, { fileNames: ["missing.docx"] }),
            (error: unknown) => error instanceof OriginalFileError && error.reason === "missing");
        const unreadable = new OriginalFileResolver({
            readFile: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
            download: f.download,
        });
        await assert.rejects(unreadable.read(root, { fileNames: ["sample.docx"] }), /permission denied/);
    });

    test("does not read outside originals/ for untrusted filenames", async () => {
        const f = fixture();
        for (const fileName of ["../metadata.json", "..\\metadata.json", "/etc/passwd", "C:\\private.docx", ""]) {
            await assert.rejects(f.resolver.read(root, { fileNames: [fileName] }), /Invalid original filename/);
        }
        assert.deepStrictEqual(f.downloads, []);
    });

    test("pre-cancelled exports never start a download", async () => {
        const controller = new AbortController();
        controller.abort();
        const f = fixture({ signal: controller.signal });
        await assert.rejects(f.resolver.read(root, { fileNames: ["sample.docx"] }), ExportCancelledError);
        assert.deepStrictEqual(f.downloads, []);
    });

    test("cancels in-flight downloads even when the API ignores abort", async () => {
        const controller = new AbortController();
        const f = fixture();
        const data = Buffer.from("remote original");
        f.disk.set(originalPath("files"), pointerFor(data));
        const resolver = new OriginalFileResolver({
            readFile: f.readFile, signal: controller.signal,
            download: async (_project, _pointer, signal) => {
                assert.strictEqual(signal, controller.signal);
                controller.abort();
                return data;
            },
        });
        await assert.rejects(resolver.read(root, { fileNames: ["sample.docx"] }), ExportCancelledError);
        assert.deepStrictEqual(f.disk.get(originalPath("files")), pointerFor(data));
    });
});

suite("Shared export download retry policy", () => {
    test("does not retry authentication failures", async () => {
        let attempts = 0;
        await assert.rejects(downloadLfsWithRetry({ downloadLFSFile: async () => {
            attempts++;
            throw new Error("401 unauthorized");
        } }, root, "a".repeat(64), 10), /401/);
        assert.strictEqual(attempts, 1);
    });

    test("retries transient download failures", async function () {
        this.timeout(3000);
        let attempts = 0;
        const result = await downloadLfsWithRetry({ downloadLFSFile: async () => {
            if (++attempts === 1) throw new Error("503 unavailable");
            return Buffer.from("ok");
        } }, root, "a".repeat(64), 2);
        assert.strictEqual(Buffer.from(result).toString(), "ok");
        assert.strictEqual(attempts, 2);
    });
});
