import * as fs from "fs";
import * as path from "path";
import https from "https";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import type { FfmpegBuild } from "./ffmpegBuilds";
import { ffmpegExecutableName } from "./ffmpegBuilds";

// tar 6 is already bundled by the extension, but does not ship TypeScript types.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tar: { x(options: { file: string; cwd: string; strip: number; strict: boolean; filter: (name: string, entry: { type: string }) => boolean }): Promise<void> } = require("tar");

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
    if (build.download?.format === "gzip") {
        await pipeline(fs.createReadStream(archive), createGunzip(), fs.createWriteStream(path.join(destination, executable), { flags: "wx" }));
    } else if (build.download?.format === "tgz") {
        await tar.x({
            file: archive, cwd: destination, strip: 1, strict: true,
            filter: (name, entry) => name === `package/${executable}` && entry.type === "File",
        });
    } else {
        throw new Error(`No supported download format for ${build.id}`);
    }
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
