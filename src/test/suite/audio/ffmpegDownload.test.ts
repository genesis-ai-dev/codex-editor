import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import https from "https";
import { PassThrough } from "stream";
import { EventEmitter } from "events";
import type { IncomingMessage } from "http";
import sinon from "sinon";
import { downloadFfmpegArchive } from "../../../utils/ffmpegDownload";

suite("FFmpeg download transport", () => {
    let root: string;
    const sandbox = sinon.createSandbox();
    setup(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-download-test-")); });
    teardown(async () => { sandbox.restore(); await fs.rm(root, { recursive: true, force: true }); });

    function responses(sequence: { status: number; location?: string; bytes?: string; stalled?: boolean }[]): sinon.SinonStub {
        return sandbox.stub(https, "get").callsFake(((url: string, options: { signal: AbortSignal }, callback: (response: IncomingMessage) => void) => {
            const item = sequence.shift();
            assert.ok(item, `Unexpected request: ${url}`);
            const request = new EventEmitter();
            queueMicrotask(() => {
                const stream = new PassThrough() as unknown as IncomingMessage;
                stream.statusCode = item.status;
                stream.headers = item.location ? { location: item.location } : {};
                callback(stream);
                if (!item.stalled) { (stream as unknown as PassThrough).end(item.bytes ?? ""); }
            });
            return request;
        }) as typeof https.get);
    }

    test("follows relative and absolute redirects before saving a successful body", async () => {
        const get = responses([{ status: 302, location: "/asset" }, { status: 307, location: "https://cdn.example.invalid/binary" }, { status: 200, bytes: "verified later" }]);
        const file = path.join(root, "archive");
        await downloadFfmpegArchive("https://example.invalid/release", file, new AbortController().signal);
        assert.strictEqual(await fs.readFile(file, "utf8"), "verified later");
        assert.strictEqual(get.callCount, 3);
    });

    test("rejects error pages after a redirect instead of extracting them", async () => {
        responses([{ status: 302, location: "/missing" }, { status: 404, bytes: "not an archive" }]);
        await assert.rejects(downloadFfmpegArchive("https://example.invalid/release", path.join(root, "archive"), new AbortController().signal), /HTTP 404/);
        assert.deepStrictEqual(await fs.readdir(root), []);
    });

    test("rejects HTTPS downgrade and bounded redirect loops", async () => {
        responses([{ status: 302, location: "http://example.invalid/insecure" }]);
        await assert.rejects(downloadFfmpegArchive("https://example.invalid", path.join(root, "archive"), new AbortController().signal), /HTTPS/);
        sandbox.restore();
        responses(Array.from({ length: 6 }, () => ({ status: 302, location: "/loop" })));
        await assert.rejects(downloadFfmpegArchive("https://example.invalid", path.join(root, "archive"), new AbortController().signal), /redirects/);
    });

    test("aborting a stalled response rejects the body pipeline", async () => {
        responses([{ status: 200, stalled: true }]);
        const controller = new AbortController();
        const result = downloadFfmpegArchive("https://example.invalid", path.join(root, "archive"), controller.signal);
        setImmediate(() => controller.abort());
        await assert.rejects(result, /abort/i);
    });
});
