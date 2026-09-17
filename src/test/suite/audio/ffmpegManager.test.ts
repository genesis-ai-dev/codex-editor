import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import * as vscode from "vscode";
import sinon from "sinon";
import * as catalog from "../../../utils/ffmpegBuilds";
import * as storage from "../../../utils/ffmpegStorage";
import * as validation from "../../../utils/ffmpegValidation";
import * as preferences from "../../../utils/toolPreferences";
import { checkAudioToolsAvailable, downloadFFmpeg, getFFmpegPath, resetBinaryCache, verifyFfmpegAvailable } from "../../../utils/ffmpegManager";

suite("FFmpeg manager verification paths", () => {
    const sandbox = sinon.createSandbox();
    let root: string;
    let context: vscode.ExtensionContext;
    let binary: string;
    let install: sinon.SinonStub;
    let mode: sinon.SinonStub;
    let validate: sinon.SinonStub;
    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-manager-test-"));
        context = { globalStorageUri: { fsPath: root } } as vscode.ExtensionContext;
        const builds: catalog.FfmpegPlatformBuilds = { current: {
            id: "fixture", platform: "linux-x64", ffmpegVersion: "4.4", storageVersion: "4.4-fixture",
            license: "GPL-3.0-or-later", sha256: createHash("sha256").update("verified").digest("hex"),
        }, previous: [] };
        binary = storage.ffmpegBuildPath(path.join(root, "ffmpeg"), builds.current);
        sandbox.stub(catalog, "resolveFfmpegBuilds").returns(builds);
        mode = sandbox.stub(preferences, "getAudioToolMode").returns("auto");
        validate = sandbox.stub(validation, "validateFfmpegBuild").resolves();
        install = sandbox.stub(storage, "ensureFfmpegBuild").callsFake(async () => {
            await fs.mkdir(path.dirname(binary), { recursive: true });
            await fs.writeFile(binary, "verified");
            return binary;
        });
        sandbox.stub(vscode.window, "withProgress").callsFake((_options, task) => task({ report: () => undefined }, {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        }));
        resetBinaryCache();
    });
    teardown(async () => { resetBinaryCache(); sandbox.restore(); await fs.rm(root, { recursive: true, force: true }); });

    test("startup and progress resolution use verified installation and invalidate modified cached bytes", async () => {
        assert.strictEqual(await downloadFFmpeg(context), binary);
        assert.strictEqual(checkAudioToolsAvailable(), true);
        assert.strictEqual(await getFFmpegPath(context), binary);
        assert.strictEqual(install.callCount, 1);
        await fs.writeFile(binary, "tampered file");
        assert.strictEqual(checkAudioToolsAvailable(), false);
        assert.strictEqual(await getFFmpegPath(context), binary);
        assert.strictEqual(install.callCount, 2);
    });

    test("force-builtin blocks even a previously verified cache", async () => {
        await downloadFFmpeg(context);
        mode.returns("force-builtin");
        assert.strictEqual(await getFFmpegPath(context), null);
        assert.strictEqual(await downloadFFmpeg(context, { showProgress: true }), null);
        assert.strictEqual(install.callCount, 1);
    });

    test("Tools Status does not execute an unknown file even with a forged marker", async () => {
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, "old");
        await fs.writeFile(path.join(path.dirname(binary), "sha256.txt"), createHash("sha256").update("old").digest("hex"));
        assert.strictEqual(await verifyFfmpegAvailable(context), false);
        assert.strictEqual(validate.callCount, 0);
        assert.strictEqual(install.callCount, 0);
    });

    test("Tools Status verifies known bytes without downloading, and deletion invalidates cache", async () => {
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, "verified");
        assert.strictEqual(await verifyFfmpegAvailable(context), true);
        assert.strictEqual(validate.callCount, 1);
        assert.strictEqual(install.callCount, 0);
        await fs.unlink(binary);
        assert.strictEqual(checkAudioToolsAvailable(), false);
        assert.strictEqual(await verifyFfmpegAvailable(context), false);
    });

    for (const runtime of ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "linux-arm"]) {
        test(`${runtime}: validation migrates its historical package path and cleans it even with a cached current binary`, async () => {
            const [platform, arch] = runtime.split("-");
            const effective = runtime === "win32-arm64" ? "win32-x64" : `${platform}-${arch}`;
            const actual = catalog.FFMPEG_BUILDS.find(item => item.current.platform === effective)!;
            const legacy = actual.previous[0] ?? actual.current;
            const builds = {
                current: { ...actual.current, sha256: createHash("sha256").update("verified").digest("hex") },
                previous: actual.previous.map(build => ({ ...build, sha256: createHash("sha256").update("old").digest("hex") })),
            };
            (catalog.resolveFfmpegBuilds as sinon.SinonStub).returns(builds);
            const storageRoot = path.join(root, "ffmpeg");
            const oldDir = path.join(storageRoot, legacy.packageVersion!);
            const current = storage.ffmpegBuildPath(storageRoot, builds.current);
            const putLegacy = async () => {
                await fs.mkdir(oldDir, { recursive: true });
                await fs.writeFile(path.join(oldDir, catalog.ffmpegExecutableName(legacy)), actual.previous.length ? "old" : "verified");
                await fs.writeFile(path.join(oldDir, "package.json"), JSON.stringify({ name: `@ffmpeg-installer/${effective}`, version: legacy.packageVersion }));
                await fs.writeFile(path.join(oldDir, "README.md"), "legacy package");
            };
            await putLegacy();
            assert.strictEqual(await verifyFfmpegAvailable(context), actual.previous.length === 0);
            await assert.rejects(fs.access(oldDir));
            assert.strictEqual(install.callCount, 0); // Validation never downloads.
            await fs.mkdir(path.dirname(current), { recursive: true });
            await fs.writeFile(current, "verified");
            assert.strictEqual(await verifyFfmpegAvailable(context), true);
            await putLegacy();
            assert.strictEqual(await verifyFfmpegAvailable(context), true);
            await assert.rejects(fs.access(oldDir));
            await putLegacy();
            assert.strictEqual(await downloadFFmpeg(context), current);
            await assert.rejects(fs.access(oldDir));
            assert.strictEqual(install.callCount, 0); // Reuse current bytes after cleanup.
        });
    }

    test("reset during installation does not repopulate the cache", async () => {
        install.callsFake(async () => {
            await fs.mkdir(path.dirname(binary), { recursive: true });
            await fs.writeFile(binary, "verified");
            resetBinaryCache();
            return binary;
        });
        assert.strictEqual(await downloadFFmpeg(context), null);
        assert.strictEqual(checkAudioToolsAvailable(), false);
    });

    test("failed installation never returns an old or bundled binary", async () => {
        sandbox.stub(console, "warn");
        install.rejects(new Error("offline"));
        assert.strictEqual(await getFFmpegPath(context), null);
        assert.strictEqual(checkAudioToolsAvailable(), false);
    });
});
