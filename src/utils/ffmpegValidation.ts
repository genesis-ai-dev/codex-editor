import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import type { FfmpegBuild } from "./ffmpegBuilds";

const execFile = promisify(execFileCallback);

/** Only invoke after verifying the executable against its pinned hash. */
export async function validateFfmpegBuild(binary: string, build: FfmpegBuild): Promise<void> {
    const run = async (...args: string[]): Promise<string> => {
        const { stdout, stderr } = await execFile(binary, args, { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
        return stdout + stderr;
    };
    const version = await run("-version");
    const actual = /^ffmpeg version\s+(\S+)/m.exec(version)?.[1];
    if (actual !== build.ffmpegVersion && !actual?.startsWith(`${build.ffmpegVersion}-`)) {
        throw new Error(`Unexpected FFmpeg version for ${build.id}: ${actual ?? "missing"}`);
    }
    for (const [filter, option] of [["adelay", "all"], ["amix", "normalize"]]) {
        const help = await run("-hide_banner", "-h", `filter=${filter}`);
        if (!new RegExp(`^\\s+${option}\\s+<`, "m").test(help)) {
            throw new Error(`FFmpeg is missing ${filter}:${option}`);
        }
    }
    const encoders = await run("-hide_banner", "-encoders");
    for (const encoder of ["pcm_s16le", "flac", "libopus"]) {
        if (!new RegExp(`^\\s*A\\S*\\s+${encoder}\\s`, "m").test(encoders)) {
            throw new Error(`FFmpeg is missing the ${encoder} encoder`);
        }
    }
}
