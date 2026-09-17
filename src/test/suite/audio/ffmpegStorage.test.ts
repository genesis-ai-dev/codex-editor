import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import { gzipSync } from "zlib";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tar: { c(options: { gzip: boolean; file: string; cwd: string }, files: string[]): Promise<void> } = require("tar");
import { FFMPEG_BUILDS, ffmpegExecutableName, identifyFfmpegBuild, resolveFfmpegBuilds } from "../../../utils/ffmpegBuilds";
import type { FfmpegPlatformBuilds } from "../../../utils/ffmpegBuilds";
import { ensureFfmpegBuild, ffmpegBuildPath, migrateFfmpegStorage } from "../../../utils/ffmpegStorage";
import { extractFfmpegArchive, downloadFfmpegArchive } from "../../../utils/ffmpegDownload";

const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

suite("FFmpeg build identity and migration", () => {
    let root: string;
    setup(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-storage-test-")); });
    teardown(async () => { await fs.rm(root, { recursive: true, force: true }); });

    function fixtures(platform = "linux-x64"): FfmpegPlatformBuilds {
        return {
            current: { id: `new-${platform}`, platform, ffmpegVersion: "4.4", storageVersion: `4.4-b4.4-${platform}`, sha256: hash("new"), license: "GPL-3.0-or-later", download: { url: "https://example.invalid/ffmpeg.gz", format: "gzip" } },
            previous: [{ id: `old-${platform}`, platform, ffmpegVersion: "N-old", packageVersion: "4.1.0", storageVersion: "4.1.0", sha256: hash("old"), license: "GPL-3.0-or-later" }],
        };
    }
    async function put(file: string, content: string | Buffer): Promise<void> {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content);
    }
    const neverDownload = async () => { assert.fail("Should reuse the verified executable"); };
    const validate = async () => { /* Fixture bytes are deliberately not executable. */ };

    test("catalog distinguishes package/build versions and preserves only the Windows ARM64 fallback", () => {
        assert.strictEqual(resolveFfmpegBuilds("win32", "arm64"), resolveFfmpegBuilds("win32", "x64"));
        assert.strictEqual(resolveFfmpegBuilds("win32", "ia32"), undefined);
        assert.strictEqual(resolveFfmpegBuilds("linux", "riscv64"), undefined);
        const apple = resolveFfmpegBuilds("darwin", "arm64")!;
        assert.strictEqual(apple.current.packageVersion, "4.1.5");
        assert.strictEqual(apple.current.ffmpegVersion, "4.4");
        assert.deepStrictEqual(apple.current.legacyStorageVersions, ["4.1.5"]);
        for (const builds of FFMPEG_BUILDS) {
            assert.strictEqual(builds.current.ffmpegVersion, "4.4");
            for (const build of [builds.current, ...builds.previous]) {
                assert.match(build.sha256, /^[a-f0-9]{64}$/);
                assert.strictEqual(identifyFfmpegBuild(builds, build.sha256), build);
            }
        }
        assert.strictEqual(identifyFfmpegBuild(apple, resolveFfmpegBuilds("darwin", "x64")!.current.sha256), undefined);
    });

    for (const platform of ["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "linux-arm"]) {
        test(`${platform}: flat obsolete executable is deleted, never labeled as 4.4`, async () => {
            const builds = fixtures(platform);
            const flat = path.join(root, ffmpegExecutableName(builds.current));
            await put(flat, "old");
            await put(path.join(root, "sha256.txt"), builds.current.sha256);
            await put(path.join(root, "notes.txt"), "keep");
            await migrateFfmpegStorage(root, builds);
            await assert.rejects(fs.access(ffmpegBuildPath(root, builds.previous[0])));
            await assert.rejects(fs.access(ffmpegBuildPath(root, builds.current)));
            assert.strictEqual(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "keep");
            await migrateFfmpegStorage(root, builds); // idempotent
        });
    }

    test("Windows ARM64 obsolete x64 executable is deleted", async () => {
        const effective = resolveFfmpegBuilds("win32", "arm64")!.current.platform;
        const builds = fixtures(effective);
        await put(path.join(root, "ffmpeg.exe"), "old");
        await migrateFfmpegStorage(root, builds);
        await assert.rejects(fs.access(path.join(root, "4.1.0", "ffmpeg.exe")));
    });

    test("Apple Silicon reuses 4.4 from the old 4.1.5 package folder without downloading", async () => {
        const base = fixtures("darwin-arm64");
        const builds = { current: { ...base.current, packageVersion: "4.1.5", legacyStorageVersions: ["4.1.5"] }, previous: [] };
        await put(path.join(root, "4.1.5", "ffmpeg"), "new");
        const result = await ensureFfmpegBuild(root, builds, { download: neverDownload, validate });
        assert.strictEqual(result, ffmpegBuildPath(root, builds.current));
        const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(result), "build.json"), "utf8"));
        assert.strictEqual(metadata.packageVersion, "4.1.5");
        assert.strictEqual(metadata.ffmpegVersion, "4.4");
    });

    test("a flat new executable is reused, even with no local hash marker", async () => {
        const builds = fixtures();
        await put(path.join(root, "ffmpeg"), "new");
        await ensureFfmpegBuild(root, builds, { download: neverDownload, validate });
        assert.strictEqual(await fs.readFile(ffmpegBuildPath(root, builds.current), "utf8"), "new");
    });

    test("an old executable mislabeled as current is deleted before downloading", async () => {
        const builds = fixtures();
        await put(ffmpegBuildPath(root, builds.current), "old");
        let calls = 0;
        await ensureFfmpegBuild(root, builds, { validate, download: async (_, stage) => {
            calls++;
            await assert.rejects(fs.access(ffmpegBuildPath(root, builds.previous[0])));
            await assert.rejects(fs.access(ffmpegBuildPath(root, builds.current)));
            await put(path.join(stage, "ffmpeg"), "new");
        } });
        assert.strictEqual(calls, 1);
        await assert.rejects(fs.access(ffmpegBuildPath(root, builds.previous[0])));
        assert.strictEqual(await fs.readFile(ffmpegBuildPath(root, builds.current), "utf8"), "new");
    });

    test("unknown bytes with a matching self-written marker are quarantined without execution", async () => {
        const builds = fixtures();
        const binary = ffmpegBuildPath(root, builds.current);
        await put(binary, "unknown");
        await put(path.join(path.dirname(binary), "sha256.txt"), hash("unknown"));
        let validated = false;
        await assert.rejects(ensureFfmpegBuild(root, builds, {
            attempts: 1, validate: async () => { validated = true; }, download: async () => { throw new Error("offline"); },
        }), /offline/);
        assert.strictEqual(validated, false);
        await assert.rejects(fs.access(binary));
        const entries = await fs.readdir(path.join(root, "quarantine"));
        assert.strictEqual(await fs.readFile(path.join(root, "quarantine", entries[0], "ffmpeg"), "utf8"), "unknown");
    });

    test("duplicates do not overwrite an existing verified binary or unrelated directories", async () => {
        const builds = fixtures();
        await put(path.join(root, "ffmpeg"), "old");
        await put(ffmpegBuildPath(root, builds.previous[0]), "old");
        await put(ffmpegBuildPath(root, builds.current), "new");
        await put(path.join(root, "unrelated", "ffmpeg"), "untouched");
        await migrateFfmpegStorage(root, builds);
        assert.strictEqual(await fs.readFile(ffmpegBuildPath(root, builds.current), "utf8"), "new");
        assert.strictEqual(await fs.readFile(path.join(root, "unrelated", "ffmpeg"), "utf8"), "untouched");
    });

    test("swapped folders retain only the current binary without needing a download", async () => {
        const builds = fixtures();
        await put(ffmpegBuildPath(root, builds.previous[0]), "new");
        await put(ffmpegBuildPath(root, builds.current), "old");
        await ensureFfmpegBuild(root, builds, { download: neverDownload, validate });
        await assert.rejects(fs.access(ffmpegBuildPath(root, builds.previous[0])));
        assert.strictEqual(await fs.readFile(ffmpegBuildPath(root, builds.current), "utf8"), "new");
    });

    test("failed upgrade leaves no obsolete executable, cleans metadata, and preserves unrelated files", async () => {
        const builds = fixtures();
        const old = ffmpegBuildPath(root, builds.previous[0]);
        await put(old, "old");
        await put(path.join(path.dirname(old), "sha256.txt"), hash("old"));
        await put(path.join(path.dirname(old), "build.json"), "{}");
        await put(path.join(path.dirname(old), "notes.txt"), "keep");
        await assert.rejects(ensureFfmpegBuild(root, builds, { attempts: 1, download: async () => {
            await assert.rejects(fs.access(old));
            throw new Error("offline");
        } }), /offline/);
        assert.deepStrictEqual(await fs.readdir(path.dirname(old)), ["notes.txt"]);
        await assert.rejects(fs.access(ffmpegBuildPath(root, builds.current)));
    });

    test("a hash mismatch retries but is never executed or installed", async () => {
        const builds = fixtures();
        let calls = 0;
        await assert.rejects(ensureFfmpegBuild(root, builds, {
            retryDelayMs: 0, download: async (_, stage) => { calls++; await put(path.join(stage, "ffmpeg"), "corrupt"); },
            validate: async () => assert.fail("Must hash before execution"),
        }), /SHA-256 mismatch/);
        assert.strictEqual(calls, 2);
        await assert.rejects(fs.access(ffmpegBuildPath(root, builds.current)));
        assert.ok(!(await fs.readdir(root)).some(name => name.startsWith(".install-")));
    });

    test("failed download can be retried later and concurrent callers share one install", async () => {
        const builds = fixtures();
        await assert.rejects(ensureFfmpegBuild(root, builds, { attempts: 1, download: async () => { throw new Error("network"); } }), /network/);
        let calls = 0;
        const options = { validate, download: async (_: unknown, stage: string) => {
            calls++;
            await put(path.join(stage, "ffmpeg"), "new");
        } };
        const paths = await Promise.all([ensureFfmpegBuild(root, builds, options), ensureFfmpegBuild(root, builds, options)]);
        assert.strictEqual(calls, 1);
        assert.strictEqual(paths[0], paths[1]);
    });

    test("execution/capability failure does not promote a downloaded binary", async () => {
        const builds = fixtures();
        await assert.rejects(ensureFfmpegBuild(root, builds, {
            attempts: 1, download: async (_, stage) => put(path.join(stage, "ffmpeg"), "new"),
            validate: async () => { throw new Error("missing normalize"); },
        }), /missing normalize/);
        await assert.rejects(fs.access(ffmpegBuildPath(root, builds.current)));
    });

    test("gzip and npm archives extract the executable without replacing unrelated files", async () => {
        const build = fixtures().current;
        const archive = path.join(root, "archive.gz");
        const output = path.join(root, "out");
        await fs.mkdir(output);
        await put(archive, gzipSync("new"));
        await extractFfmpegArchive(archive, build, output);
        assert.strictEqual(await fs.readFile(path.join(output, "ffmpeg"), "utf8"), "new");
        await fs.unlink(path.join(output, "ffmpeg"));
        await put(path.join(root, "package", "ffmpeg"), "new");
        await put(path.join(root, "package", "unrelated.txt"), "skip");
        await tar.c({ gzip: true, file: archive, cwd: root }, ["package"]);
        await extractFfmpegArchive(archive, { ...build, download: { url: "https://example.invalid", format: "tgz" } }, output);
        assert.deepStrictEqual(await fs.readdir(output), ["ffmpeg"]);
        await assert.rejects(downloadFfmpegArchive("http://example.invalid", archive, new AbortController().signal), /HTTPS/);
    });
});
