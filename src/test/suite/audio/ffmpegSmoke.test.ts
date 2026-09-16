import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import { resolveFfmpegBuilds, ffmpegExecutableName } from "../../../utils/ffmpegBuilds";
import { ensureFfmpegBuild } from "../../../utils/ffmpegStorage";
import { buildCharacterAudioFilter } from "../../../exportHandler/characterAudioFilter";

const execFile = promisify(execFileCallback);

// Explicit opt-in: this downloads and executes the pinned build for the host OS.
suite("FFmpeg native smoke", () => {
    test("verified 4.4 executes character export with correct timing, gain, and all output formats", async function () {
        if (process.env.CODEX_FFMPEG_SMOKE !== "1") { this.skip(); }
        this.timeout(300_000);
        const builds = resolveFfmpegBuilds();
        assert.ok(builds, "No FFmpeg build for this test host");
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-smoke-"));
        try {
            if (process.env.FFMPEG_TEST_BINARY) {
                // Also exercise migration of a real unversioned binary.
                await fs.copyFile(process.env.FFMPEG_TEST_BINARY, path.join(root, ffmpegExecutableName(builds.current)));
            }
            const binary = await ensureFfmpegBuild(root, builds);
            const run = async (args: string[]) => execFile(binary, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
                timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
            });
            const clip = path.join(root, "clip.wav");
            await run(["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.1", "-c:a", "pcm_s16le", clip]);
            const script = path.join(root, "character-filter.txt");
            await fs.writeFile(script, buildCharacterAudioFilter([100, 400], 48000));
            for (const [format, codec] of [["wav", "pcm_s16le"], ["flac", "flac"], ["opus", "libopus"]]) {
                const output = path.join(root, `character.${format}`);
                await run(["-f", "lavfi", "-t", "0.7", "-i", "anullsrc=r=48000:cl=mono", "-i", clip, "-i", clip,
                    "-filter_complex_script", script, "-map", "[out]", "-c:a", codec, "-ar", "48000", "-ac", "1", output]);
                const decoded = path.join(root, `${format}.pcm`);
                await run(["-i", output, "-f", "s16le", "-c:a", "pcm_s16le", decoded]);
                const pcm = await fs.readFile(decoded);
                assert.strictEqual(pcm.length / 2, 33600, `${format} must preserve the 0.7s timeline`);
                const peak = (start: number, end: number) => {
                    let max = 0;
                    for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++) {
                        max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
                    }
                    return max / 32768;
                };
                assert.ok(peak(0.02, 0.07) < 0.002, `${format}: silence before the first clip`);
                assert.ok(peak(0.25, 0.35) < 0.002, `${format}: silence between clips`);
                assert.ok(peak(0.55, 0.65) < 0.002, `${format}: silence after the last clip`);
                for (const [start, end] of [[0.12, 0.18], [0.42, 0.48]]) {
                    const amplitude = peak(start, end);
                    assert.ok(amplitude > 0.11 && amplitude < 0.15, `${format}: gain must remain near 0.125, got ${amplitude}`);
                }
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
