import * as fs from "fs";
import * as path from "path";
import type { FfmpegBuild, FfmpegPlatformBuilds } from "./ffmpegBuilds";
import { ffmpegExecutableName, identifyFfmpegBuild } from "./ffmpegBuilds";
import { computeFileHash, writeHashMarker } from "./binaryIntegrityUtils";
import { downloadFfmpegBuild } from "./ffmpegDownload";
import { validateFfmpegBuild } from "./ffmpegValidation";

export function ffmpegBuildPath(root: string, build: FfmpegBuild): string {
    return path.join(root, build.storageVersion, ffmpegExecutableName(build));
}

async function exists(file: string): Promise<boolean> {
    try { await fs.promises.lstat(file); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { return false; }
        throw error;
    }
}

async function directory(dir: string): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true });
    if (!(await fs.promises.lstat(dir)).isDirectory()) {
        throw new Error(`FFmpeg storage must be a real directory: ${dir}`);
    }
}

/** Ignore sha256.txt: it is a diagnostic marker, not a trust anchor. */
export async function matchesFfmpegBuild(file: string, build: FfmpegBuild): Promise<boolean> {
    if (!await exists(file)) { return false; }
    if (!(await fs.promises.lstat(file)).isFile()) { return false; }
    return await computeFileHash(file) === build.sha256;
}

function writeIdentity(dir: string, build: FfmpegBuild): void {
    writeHashMarker(dir, build.sha256);
    fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({
        id: build.id, platform: build.platform, ffmpegVersion: build.ffmpegVersion,
        packageVersion: build.packageVersion, sha256: build.sha256,
        source: build.download?.url, license: build.license,
    }, null, 2) + "\n");
}

/** Preserve unrecognized/misplaced bytes without marking them as any version. */
async function quarantine(root: string, file: string): Promise<string> {
    const quarantineRoot = path.join(root, "quarantine");
    await directory(quarantineRoot);
    const dest = await fs.promises.mkdtemp(path.join(quarantineRoot, "binary-"));
    const preserved = path.join(dest, path.basename(file));
    await fs.promises.rename(file, preserved);
    await fs.promises.writeFile(path.join(dest, "origin.json"), JSON.stringify({ originalPath: path.relative(root, file) }));
    return preserved;
}

/**
 * Classify flat installs, package-version folders and mislabeled version folders
 * using only executable hashes for the effective architecture. Never run legacy
 * code, trust its marker, or move unrelated files/directories into a build folder.
 */
const migrations = new Map<string, Promise<void>>();

export function migrateFfmpegStorage(root: string, builds: FfmpegPlatformBuilds): Promise<void> {
    const key = ffmpegBuildPath(root, builds.current);
    const running = migrations.get(key);
    if (running) { return running; }
    const migration = migrateStorage(root, builds).finally(() => {
        if (migrations.get(key) === migration) { migrations.delete(key); }
    });
    migrations.set(key, migration);
    return migration;
}

async function migrateStorage(root: string, builds: FfmpegPlatformBuilds): Promise<void> {
    await directory(root);
    const known = [builds.current, ...builds.previous];
    const versionNames = new Set(known.flatMap(build => [build.storageVersion, ...(build.legacyStorageVersions ?? [])]));
    const executable = ffmpegExecutableName(builds.current);
    const candidates = [path.join(root, executable)];
    for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && (versionNames.has(entry.name) || /^\d+\.\d+(?:[.\w-]*)$/.test(entry.name))) {
            candidates.push(path.join(root, entry.name, executable));
        }
    }
    // Delete every recognized obsolete executable before reusing or downloading
    // the current build. A failed removal aborts installation rather than keeping
    // an old executable available as an accidental fallback.
    for (const file of candidates) {
        if (!await exists(file)) { continue; }
        const stat = await fs.promises.lstat(file);
        const build = stat.isFile() ? identifyFfmpegBuild(builds, await computeFileHash(file)) : undefined;
        if (build && build.id !== builds.current.id) {
            await fs.promises.unlink(file);
        }
    }
    for (const file of candidates) {
        if (!await exists(file)) { continue; }
        if (!await matchesFfmpegBuild(file, builds.current)) {
            await quarantine(root, file);
            continue;
        }
        const target = ffmpegBuildPath(root, builds.current);
        await directory(path.dirname(target));
        if (file !== target) {
            if (await matchesFfmpegBuild(target, builds.current)) {
                await fs.promises.unlink(file);
            } else {
                if (await exists(target)) { await quarantine(root, target); }
                await fs.promises.rename(file, target);
            }
        }
        writeIdentity(path.dirname(target), builds.current);
    }
    // Remove stale identity/package metadata and empty legacy folders, preserving other
    // contents rather than recursively deleting a directory based on its name.
    const activeDir = path.dirname(ffmpegBuildPath(root, builds.current));
    for (const dir of new Set(candidates.map(file => path.dirname(file)))) {
        if (dir === activeDir || await exists(path.join(dir, executable))) { continue; }
        const metadata = ["sha256.txt", "build.json"];
        // Older installers extracted the entire npm package. Recognize its
        // identity before removing its ancillary files, not just its binary.
        const packageFile = path.join(dir, "package.json");
        if (dir !== root && await exists(packageFile) && (await fs.promises.lstat(packageFile)).isFile()) {
            try {
                const pkg = JSON.parse(await fs.promises.readFile(packageFile, "utf8")) as { name?: string; version?: string };
                if (known.some(build => build.packageVersion && pkg.name === `@ffmpeg-installer/${build.platform}`
                    && pkg.version === build.packageVersion
                    && [build.storageVersion, ...(build.legacyStorageVersions ?? [])].includes(path.basename(dir)))) {
                    metadata.push("package.json", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt", ".DS_Store");
                }
            } catch (error) {
                if (!(error instanceof SyntaxError)) { throw error; }
            }
        }
        for (const marker of metadata) {
            const file = path.join(dir, marker);
            if (await exists(file) && (await fs.promises.lstat(file)).isFile()) {
                await fs.promises.unlink(file);
            }
        }
        if (dir !== root && (await fs.promises.readdir(dir)).length === 0) {
            await fs.promises.rmdir(dir);
        }
    }
}

export interface FfmpegInstallOptions {
    download?: (build: FfmpegBuild, staging: string) => Promise<void>;
    validate?: (binary: string, build: FfmpegBuild) => Promise<void>;
    report?: (message: string) => void;
    attempts?: number;
    retryDelayMs?: number;
}

const installations = new Map<string, Promise<string>>();

/** All callers for a build share one migration/download, including progress UI. */
export function ensureFfmpegBuild(root: string, builds: FfmpegPlatformBuilds, options: FfmpegInstallOptions = {}): Promise<string> {
    const key = ffmpegBuildPath(root, builds.current);
    const running = installations.get(key);
    if (running) { return running; }
    const installation = install(root, builds, options).finally(() => {
        if (installations.get(key) === installation) { installations.delete(key); }
    });
    installations.set(key, installation);
    return installation;
}

async function install(root: string, builds: FfmpegPlatformBuilds, options: FfmpegInstallOptions): Promise<string> {
    const build = builds.current;
    const binary = ffmpegBuildPath(root, build);
    const validate = options.validate ?? validateFfmpegBuild;
    await migrateFfmpegStorage(root, builds);
    await directory(path.dirname(binary));
    if (await matchesFfmpegBuild(binary, build)) {
        if (!build.platform.startsWith("win32-")) { await fs.promises.chmod(binary, 0o755); }
        // A known but incompatible executable (e.g. an unsupported OS) is not
        // repaired by downloading exactly the same bytes again.
        await validate(binary, build);
        writeIdentity(path.dirname(binary), build);
        return binary;
    }

    const attempts = options.attempts ?? 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        options.report?.(`${attempt > 1 ? `Retry ${attempt}/${attempts} — ` : ""}Downloading FFmpeg ${build.ffmpegVersion}...`);
        const staging = await fs.promises.mkdtemp(path.join(root, ".install-"));
        try {
            await (options.download ?? downloadFfmpegBuild)(build, staging);
            const stagedBinary = path.join(staging, ffmpegExecutableName(build));
            if (!await matchesFfmpegBuild(stagedBinary, build)) {
                throw new Error(`FFmpeg SHA-256 mismatch for ${build.id}`);
            }
            if (!build.platform.startsWith("win32-")) { await fs.promises.chmod(stagedBinary, 0o755); }
            options.report?.("Verifying audio tools...");
            await validate(stagedBinary, build);
            // Never expose a partial or unverified executable at the final path.
            // Another extension host may have completed this same install.
            if (await matchesFfmpegBuild(binary, build)) {
                writeIdentity(path.dirname(binary), build);
                return binary;
            }
            if (await exists(binary)) { await quarantine(root, binary); }
            await fs.promises.rename(stagedBinary, binary);
            writeIdentity(path.dirname(binary), build);
            return binary;
        } catch (error) {
            if (attempt === attempts) { throw error; }
            options.report?.(`Download failed; retrying (${attempt}/${attempts})...`);
        } finally {
            await fs.promises.rm(staging, { recursive: true, force: true });
        }
        await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 2000));
    }
    throw new Error("FFmpeg installation did not complete");
}
