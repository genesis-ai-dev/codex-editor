import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Locks in the video media-strategy switch rules:
 *  - Switching to a more restrictive strategy (stream-only) erases SYNCED video
 *    (reverts files/ to a pointer) to free disk space.
 *  - Unsynced video (pointers/ still holds real bytes) is NEVER erased.
 *  - Switching to a less restrictive strategy (removeFilesPointerStubs) preserves
 *    real video bytes and only drops tiny pointer stubs.
 */
suite("Media strategy: video preserve/erase rules", () => {
    const BOOK = "JUD";
    const OID = "a".repeat(64);

    const makePointer = (size: number): string =>
        `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize ${size}\n`;

    const setup = (): { tempDir: string; filesPath: (name: string) => string; pointersPath: (name: string) => string; } => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-video-strategy-"));
        const filesDir = path.join(tempDir, ".project", "attachments", "files", BOOK);
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", BOOK);
        fs.mkdirSync(filesDir, { recursive: true });
        fs.mkdirSync(pointersDir, { recursive: true });
        return {
            tempDir,
            filesPath: (name: string) => path.join(filesDir, name),
            pointersPath: (name: string) => path.join(pointersDir, name),
        };
    };

    test("stream-only switch reverts a SYNCED video to a pointer", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { replaceFilesWithPointers } = await import("../../../utils/mediaStrategyManager");
        const { isPointerFile } = await import("../../../utils/lfsHelpers");

        try {
            // Synced: pointers/ holds the LFS pointer, files/ holds real bytes.
            const realBytes = Buffer.alloc(2048, 7);
            fs.writeFileSync(pointersPath("video.mp4"), makePointer(realBytes.length), "utf8");
            fs.writeFileSync(filesPath("video.mp4"), realBytes);

            const replaced = await replaceFilesWithPointers(tempDir);

            assert.ok(replaced >= 1, "expected at least one file replaced with a pointer");
            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                true,
                "synced video in files/ should be reverted to a pointer"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("stream-only switch preserves an UNSYNCED video", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { replaceFilesWithPointers } = await import("../../../utils/mediaStrategyManager");
        const { isPointerFile } = await import("../../../utils/lfsHelpers");

        try {
            // Unsynced: BOTH files/ and pointers/ hold real bytes (not uploaded yet).
            const realBytes = Buffer.alloc(2048, 7);
            fs.writeFileSync(pointersPath("video.mp4"), realBytes);
            fs.writeFileSync(filesPath("video.mp4"), realBytes);

            await replaceFilesWithPointers(tempDir);

            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                false,
                "unsynced video must NOT be reverted to a pointer"
            );
            assert.strictEqual(
                fs.statSync(filesPath("video.mp4")).size,
                realBytes.length,
                "unsynced video bytes must be untouched"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("restrictToVideos pointerizes only videos, leaving audio untouched", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { replaceFilesWithPointers } = await import("../../../utils/mediaStrategyManager");
        const { isPointerFile } = await import("../../../utils/lfsHelpers");

        try {
            const realVideo = Buffer.alloc(2048, 7);
            fs.writeFileSync(pointersPath("video.mp4"), makePointer(realVideo.length), "utf8");
            fs.writeFileSync(filesPath("video.mp4"), realVideo);

            const realAudio = Buffer.alloc(1024, 3);
            fs.writeFileSync(pointersPath("audio.wav"), makePointer(realAudio.length), "utf8");
            fs.writeFileSync(filesPath("audio.wav"), realAudio);

            await replaceFilesWithPointers(tempDir, { restrictToVideos: true });

            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                true,
                "video should be pointerized when restrictToVideos is set"
            );
            assert.strictEqual(
                await isPointerFile(filesPath("audio.wav")),
                false,
                "audio must be left untouched when restrictToVideos is set"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("restrictToAudio pointerizes only audio, leaving video untouched", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { replaceFilesWithPointers } = await import("../../../utils/mediaStrategyManager");
        const { isPointerFile } = await import("../../../utils/lfsHelpers");

        try {
            const realVideo = Buffer.alloc(2048, 7);
            fs.writeFileSync(pointersPath("video.mp4"), makePointer(realVideo.length), "utf8");
            fs.writeFileSync(filesPath("video.mp4"), realVideo);

            const realAudio = Buffer.alloc(1024, 3);
            fs.writeFileSync(pointersPath("audio.wav"), makePointer(realAudio.length), "utf8");
            fs.writeFileSync(filesPath("audio.wav"), realAudio);

            await replaceFilesWithPointers(tempDir, { ignorePersisted: true, restrictToAudio: true });

            assert.strictEqual(
                await isPointerFile(filesPath("audio.wav")),
                true,
                "audio should be pointerized when restrictToAudio is set"
            );
            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                false,
                "video must be left untouched when restrictToAudio is set"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("ignorePersisted frees a saved (allowlisted) video", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { replaceFilesWithPointers } = await import("../../../utils/mediaStrategyManager");
        const { isPointerFile } = await import("../../../utils/lfsHelpers");
        const { addPersistedMediaFile } = await import("../../../utils/localProjectSettings");

        try {
            const realVideo = Buffer.alloc(2048, 7);
            fs.writeFileSync(pointersPath("video.mp4"), makePointer(realVideo.length), "utf8");
            fs.writeFileSync(filesPath("video.mp4"), realVideo);

            await addPersistedMediaFile(`${BOOK}/video.mp4`, vscode.Uri.file(tempDir));

            // Honoring the allowlist (default) keeps the saved video.
            await replaceFilesWithPointers(tempDir);
            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                false,
                "saved video must be protected during automatic cleanup"
            );

            // An explicit Free Space (ignorePersisted) frees it anyway.
            await replaceFilesWithPointers(tempDir, { ignorePersisted: true });
            assert.strictEqual(
                await isPointerFile(filesPath("video.mp4")),
                true,
                "ignorePersisted must free even saved videos"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("countLocalVideoFiles counts real videos, ignoring pointers and audio", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { countLocalVideoFiles, collectLocalVideoRelPaths } = await import(
            "../../../utils/mediaStrategyManager"
        );

        try {
            // Real video -> counts.
            fs.writeFileSync(filesPath("real.mp4"), Buffer.alloc(2048, 7));
            // Pointer stub video -> does not count.
            fs.writeFileSync(filesPath("stub.mp4"), makePointer(2048), "utf8");
            // Real audio -> not a video, does not count.
            fs.writeFileSync(filesPath("audio.wav"), Buffer.alloc(1024, 3));
            // keep pointers/ consistent (not required for counting)
            fs.writeFileSync(pointersPath("real.mp4"), makePointer(2048), "utf8");

            const count = await countLocalVideoFiles(tempDir);
            assert.strictEqual(count, 1, "only the real video should be counted");

            const rels = await collectLocalVideoRelPaths(tempDir);
            assert.deepStrictEqual(rels, [`${BOOK}/real.mp4`], "should list the real video rel-path");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("collectLocalVideoRelPaths treats audio .webm as audio, not video", async function () {
        // Regression: browser audio recordings are saved as `.webm`, which used
        // to be in VIDEO_EXTENSIONS, so 1000+ audio takes were reported as
        // "videos". Only `.webm` files actually referenced by a notebook's
        // videoUrl are videos.
        this.timeout(15000);
        const { tempDir, filesPath } = setup();
        const { countLocalVideoFiles, collectLocalVideoRelPaths } = await import(
            "../../../utils/mediaStrategyManager"
        );

        try {
            // Audio recordings saved as .webm (NOT referenced as videos) -> must NOT count.
            fs.writeFileSync(filesPath("JUD_001_001-take1.webm"), Buffer.alloc(1024, 3));
            fs.writeFileSync(filesPath("JUD_001_002-take1.webm"), Buffer.alloc(1024, 4));
            // A real video saved as .webm, referenced by a notebook's videoUrl -> must count.
            fs.writeFileSync(filesPath("clip.webm"), Buffer.alloc(4096, 9));

            // Notebook (.codex under files/target) referencing the video.
            const targetDir = path.join(tempDir, "files", "target");
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(
                path.join(targetDir, "JUD.codex"),
                JSON.stringify({
                    cells: [],
                    metadata: { videoUrl: `.project/attachments/files/${BOOK}/clip.webm` },
                }),
                "utf8"
            );

            const count = await countLocalVideoFiles(tempDir);
            assert.strictEqual(count, 1, "audio .webm recordings must not be counted as videos");

            const rels = await collectLocalVideoRelPaths(tempDir);
            assert.deepStrictEqual(
                rels,
                [`${BOOK}/clip.webm`],
                "only the .webm referenced via videoUrl should be listed"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("less-restrictive switch keeps real video and drops only pointer stubs", async function () {
        this.timeout(15000);
        const { tempDir, filesPath, pointersPath } = setup();
        const { removeFilesPointerStubs } = await import("../../../utils/mediaStrategyManager");

        try {
            // Stubbed entry: files/ is a tiny pointer stub -> should be removed.
            fs.writeFileSync(pointersPath("stub.mp4"), makePointer(2048), "utf8");
            fs.writeFileSync(filesPath("stub.mp4"), makePointer(2048), "utf8");

            // Real downloaded video: files/ holds real bytes -> must be preserved.
            const realBytes = Buffer.alloc(4096, 9);
            fs.writeFileSync(pointersPath("real.mp4"), makePointer(realBytes.length), "utf8");
            fs.writeFileSync(filesPath("real.mp4"), realBytes);

            await removeFilesPointerStubs(tempDir);

            assert.strictEqual(
                fs.existsSync(filesPath("stub.mp4")),
                false,
                "pointer stub in files/ should be removed so it can re-download"
            );
            assert.strictEqual(
                fs.existsSync(filesPath("real.mp4")),
                true,
                "real downloaded video must be preserved on a less-restrictive switch"
            );
            assert.strictEqual(
                fs.statSync(filesPath("real.mp4")).size,
                realBytes.length,
                "preserved video bytes must be untouched"
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

/**
 * Locks in the fix for the intermittent "saved video not protected" bug: the
 * persisted-media allowlist must survive concurrent settings writes. Previously
 * a general settings write that read a stale snapshot could clobber a freshly
 * added entry (and the file's force-controlled persistedMediaFiles key dropped
 * it), so some saved videos lost protection at random.
 */
suite("Persisted media allowlist: concurrency safety", () => {
    const newProject = (): string => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-allowlist-"));
        fs.mkdirSync(path.join(tempDir, ".project"), { recursive: true });
        return tempDir;
    };

    test("concurrent adds + unrelated settings write keep every entry", async function () {
        this.timeout(15000);
        const tempDir = newProject();
        const uri = vscode.Uri.file(tempDir);
        const {
            addPersistedMediaFile,
            addPersistedMediaFiles,
            getPersistedMediaFiles,
            setApplyState,
            setMediaFilesStrategy,
        } = await import("../../../utils/localProjectSettings");

        try {
            // Fire adds interleaved with unrelated settings writes that previously
            // would have clobbered the allowlist.
            await Promise.all([
                addPersistedMediaFile("JUD/a.mp4", uri),
                setApplyState("applying", uri),
                addPersistedMediaFile("JUD/b.mp4", uri),
                setMediaFilesStrategy("stream-only", uri),
                addPersistedMediaFiles(["JUD/c.mp4", "JUD/d.mp4"], uri),
                setApplyState("applied", uri),
            ]);

            const entries = (await getPersistedMediaFiles(uri)).sort();
            assert.deepStrictEqual(
                entries,
                ["JUD/a.mp4", "JUD/b.mp4", "JUD/c.mp4", "JUD/d.mp4"],
                "no allowlist entry should be lost to a concurrent settings write"
            );

            // The unrelated write must still have taken effect.
            const raw = JSON.parse(
                fs.readFileSync(path.join(tempDir, ".project", "localProjectSettings.json"), "utf8")
            );
            assert.strictEqual(raw.currentMediaFilesStrategy, "stream-only");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("removeByExtension drops video entries but keeps others", async function () {
        this.timeout(15000);
        const tempDir = newProject();
        const uri = vscode.Uri.file(tempDir);
        const {
            addPersistedMediaFiles,
            getPersistedMediaFiles,
            removePersistedMediaFilesByExtension,
        } = await import("../../../utils/localProjectSettings");

        try {
            await addPersistedMediaFiles(["JUD/clip.mp4", "JUD/song.wav", "JUD/movie.mkv"], uri);
            await removePersistedMediaFilesByExtension(new Set([".mp4", ".mkv"]), uri);

            const entries = await getPersistedMediaFiles(uri);
            assert.deepStrictEqual(entries, ["JUD/song.wav"], "only non-video entries should remain");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
