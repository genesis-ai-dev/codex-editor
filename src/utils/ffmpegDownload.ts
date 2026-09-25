import * as fs from "fs";
import * as path from "path";
import https from "https";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import type { FfmpegBuild } from "./ffmpegBuilds";
import { ffmpegExecutableName } from "./ffmpegBuilds";

// tar 6 is already bundled by the extension, but does not ship TypeScript types.
// Only its streaming parser is used; it never writes to disk, so archive paths are never trusted.
interface TarEntry {
    type: string;
    pipe(destination: NodeJS.WritableStream): void;
    unpipe(destination: NodeJS.WritableStream): void;
    resume(): void;
}
interface TarListOptions {
    file: string;
    strict: boolean;
    noResume: boolean;
    filter: (name: string, entry: TarEntry) => boolean;
    onentry: (entry: TarEntry) => void;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tar: { t(options: TarListOptions): Promise<void> } = require("tar");

const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

/** Follow bounded HTTPS redirects, checking status and timing out the entire body. */
export async function downloadFfmpegArchive(url: string, destination: string, signal: AbortSignal, redirects = 0): Promise<void> {
    if (new URL(url).protocol !== "https:") {
        throw new Error("FFmpeg downloads require HTTPS");
    }
    const response = await new Promise<import("http").IncomingMessage>((resolve, reject) => {
        const request = https.get(url, { signal, headers: { "User-Agent": "codex-editor-ffmpeg" } }, resolve);
        request.on("error", reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.resume();
        if (!response.headers.location || redirects >= 5) {
            throw new Error("Invalid or excessive FFmpeg download redirects");
        }
        return downloadFfmpegArchive(new URL(response.headers.location, url).href, destination, signal, redirects + 1);
    }
    if (response.statusCode !== 200) {
        response.resume();
        throw new Error(`FFmpeg download failed: HTTP ${response.statusCode}`);
    }
    let received = 0;
    response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_ARCHIVE_BYTES) {
            response.destroy(new Error("FFmpeg download exceeds size limit"));
        }
    });
    await pipeline(response, fs.createWriteStream(destination, { flags: "wx" }), { signal });
}

/** Extract only the expected executable; never trust archive paths or symlinks. */
export async function extractFfmpegArchive(archive: string, build: FfmpegBuild, destination: string): Promise<void> {
    const executable = ffmpegExecutableName(build);
    const target = path.join(destination, executable);
    if (build.download?.format === "gzip") {
        await pipeline(fs.createReadStream(archive), createGunzip(), fs.createWriteStream(target, { flags: "wx" }));
    } else if (build.download?.format === "tgz") {
        await extractTarEntry(archive, `package/${executable}`, target);
    } else {
        throw new Error(`No supported download format for ${build.id}`);
    }
}

/**
 * Stream exactly one regular file out of a gzipped tarball into `target`.
 *
 * `tar.x` is deliberately avoided. It resolves entry paths against `cwd` itself and
 * refuses anything not prefixed by `cwd + "/"`, and its backslash normalization is keyed
 * off `process.platform`. The webpack test bundle replaces `process` with a browser
 * polyfill that has no `platform`, so on Windows Node's real `path` produced backslashes
 * and a legitimate `package/ffmpeg` entry failed with "path escaped extraction target".
 * Letting tar only parse, and writing the bytes ourselves, behaves the same everywhere.
 */
function extractTarEntry(archive: string, entryPath: string, target: string): Promise<void> {
    let written: Promise<void> | undefined;
    let failure: Error | undefined;
    const fail = (error: Error) => { failure = failure ?? error; };
    const listed = tar.t({
        file: archive, strict: true, noResume: true,
        filter: (name, entry) => name === entryPath && entry.type === "File",
        onentry: (entry) => {
            if (written) {
                fail(new Error(`FFmpeg archive contains ${entryPath} more than once`));
                entry.resume();
                return;
            }
            const output = fs.createWriteStream(target, { flags: "wx" });
            // "close" follows both "finish" and "error", so this always settles.
            written = new Promise<void>((done) => output.once("close", () => done()));
            output.once("error", (error) => {
                fail(error);
                entry.unpipe(output); // stop waiting for a drain that will never come
                entry.resume(); // discard the rest so the parser still reaches its end
            });
            entry.pipe(output);
        },
    });
    return listed.then(async () => {
        if (!written) {
            throw new Error(`FFmpeg archive does not contain ${entryPath}`);
        }
        await written;
        if (failure) {
            throw failure;
        }
    });
}

/** The caller supplies a private staging directory and verifies the binary hash. */
export async function downloadFfmpegBuild(build: FfmpegBuild, stagingDirectory: string): Promise<void> {
    if (!build.download) {
        throw new Error(`No download configured for ${build.id}`);
    }
    const archive = path.join(stagingDirectory, "download.archive");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        await downloadFfmpegArchive(build.download.url, archive, controller.signal);
        await extractFfmpegArchive(archive, build, stagingDirectory);
    } finally {
        clearTimeout(timer);
        await fs.promises.rm(archive, { force: true });
    }
}
