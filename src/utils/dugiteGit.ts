/**
 * dugiteGit.ts — Typed wrapper around dugite for codex-editor.
 *
 * This module provides the same git operations as the frontier-authentication
 * dugiteGit wrapper, but resolves the binary path from the frontier-auth API
 * rather than downloading it directly. This ensures a single shared binary.
 *
 * Only includes the subset of operations codex-editor needs (local-only ops).
 */

import { exec, type IGitExecutionOptions, type IGitResult } from "dugite";
import * as fs from "fs";
import * as path from "path";
import { getAuthApi } from "../extension";

// ---------------------------------------------------------------------------
// Binary path resolution (from frontier-auth)
// ---------------------------------------------------------------------------

let gitEnvOverrides: Record<string, string> = {};

/**
 * In-flight resolution promise — prevents concurrent calls from racing.
 * Once resolved, all subsequent calls return immediately via the cached
 * gitEnvOverrides (non-empty after successful resolution, or the special
 * "embedded" sentinel when useEmbeddedGitBinary() was called).
 */
let resolutionPromise: Promise<void> | undefined;

/**
 * Directly set the binary path (for testing or when path is already known).
 */
export function setGitBinaryPath(localGitDir: string, execPath: string): void {
    gitEnvOverrides = {
        LOCAL_GIT_DIRECTORY: localGitDir,
        GIT_EXEC_PATH: execPath,
    };
    resolutionPromise = Promise.resolve();
}

/**
 * Use dugite's own embedded git binary instead of resolving from frontier-auth.
 * Useful in test environments where the auth extension is unavailable.
 */
export function useEmbeddedGitBinary(): void {
    gitEnvOverrides = {};
    resolutionPromise = Promise.resolve();
}

/**
 * Clear cached binary path so the next git operation re-resolves from
 * frontier-auth.  Call this when the auth extension restarts or updates
 * its binary (e.g. after a retry download).
 */
export function resetGitBinaryPath(): void {
    gitEnvOverrides = {};
    resolutionPromise = undefined;
}

/**
 * Ensure the binary path has been resolved from frontier-auth.
 * Uses a promise-based singleton so concurrent callers share one
 * resolution attempt instead of racing.
 */
async function ensureBinaryPath(): Promise<void> {
    if (resolutionPromise) {
        return resolutionPromise;
    }

    resolutionPromise = resolveFromAuth();

    try {
        await resolutionPromise;
    } catch (err) {
        resolutionPromise = undefined;
        throw err;
    }
}

/**
 * Resolve the git binary path from the frontier-auth extension API.
 * Validates that the reported execPath actually exists on disk, and
 * on Linux sets GIT_SSL_CAINFO to the dugite-native CA bundle so
 * HTTPS operations don't fail with certificate errors.
 */
async function resolveFromAuth(): Promise<void> {
    const authApi = getAuthApi();
    const binaryPath = authApi?.getGitBinaryPath?.();
    if (!binaryPath) {
        throw new Error(
            "Sync is not available. Please make sure Frontier Authentication is installed and active.",
        );
    }

    try {
        await fs.promises.access(binaryPath.execPath, fs.constants.F_OK);
    } catch {
        throw new Error(
            `Sync runtime is missing or was not installed correctly. ` +
            `Please try re-downloading it from Sync Settings.`,
        );
    }

    gitEnvOverrides = {
        LOCAL_GIT_DIRECTORY: binaryPath.localGitDir,
        GIT_EXEC_PATH: binaryPath.execPath,
    };

    // When LOCAL_GIT_DIRECTORY is provided, dugite does not set GIT_SSL_CAINFO
    // automatically.  The dugite-native archive ships ssl/cacert.pem for
    // platforms where the bundled git uses OpenSSL.  If present, we point to
    // it explicitly — without it, HTTPS operations fail with certificate
    // errors.  On platforms using a native SSL backend (schannel on Windows,
    // SecureTransport on macOS) the file may be absent, which is fine — the
    // native backend uses the OS certificate store instead.
    const sslCaBundle = path.join(binaryPath.localGitDir, "ssl", "cacert.pem");
    try {
        await fs.promises.access(sslCaBundle, fs.constants.R_OK);
        gitEnvOverrides.GIT_SSL_CAINFO = sslCaBundle;
    } catch {
        // Not present — platform likely uses a native SSL backend
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Baseline env vars applied to every git invocation to ensure fully
 * non-interactive operation — no terminal prompts, no GUI dialogs,
 * and no interference from system-level git configuration.
 */
const NON_INTERACTIVE_ENV: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    SSH_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1",
};

/**
 * Config flags prepended to every git invocation to prevent native git from
 * invoking git-lfs filter processes.  We handle all LFS operations manually
 * (upload, download, pointer creation) via the Frontier Authentication
 * extension, so the built-in filter must stay out of the way — especially
 * because dugite's bundled git binary does not ship with git-lfs.
 *
 * Without these flags, a system-installed git-lfs (from Homebrew, apt, etc.)
 * would intercept `git add` / `git commit` / `git status` through the
 * filter.lfs hooks declared in .gitattributes and either hang (looking for
 * its own binary) or corrupt pointer files.
 */
const LFS_OVERRIDE_FLAGS = [
    "-c", "filter.lfs.process=",
    "-c", "filter.lfs.clean=cat",
    "-c", "filter.lfs.smudge=cat",
    "-c", "filter.lfs.required=false",
];

/**
 * Disable all credential helpers and system askpass programs so that no
 * interactive GUI prompt or background credential manager is invoked.
 *
 * Even for local-only operations (add, commit, status), a misconfigured
 * credential.helper in the user's ~/.gitconfig or system gitconfig can
 * spawn processes that hang or pop up dialogs (e.g. GCM on Windows,
 * osxkeychain on macOS).  Blanking them here ensures codex-editor's
 * local git operations are fully non-interactive.
 */
const CREDENTIAL_OVERRIDE_FLAGS = [
    "-c", "credential.helper=",
    "-c", "core.askPass=",
];

/**
 * Platform-safety and performance flags applied to every git invocation to
 * normalize behavior across Windows, macOS, and Linux.
 *
 * core.longpaths         — Windows: enables paths >260 chars.
 * core.autocrlf          — Prevents LF↔CRLF conversion that corrupts files.
 * core.fsmonitor         — Disables filesystem monitor (prevents hangs).
 * core.pager             — Disables pager (prevents waiting for input).
 * core.quotePath         — Returns raw UTF-8 paths instead of octal-escaped
 *                          non-ASCII characters.  Critical for i18n filenames.
 * core.precomposeUnicode — macOS: normalizes NFD paths to NFC.
 * core.protectNTFS       — Reject paths invalid on NTFS (CON, AUX, NUL…).
 *                          Already default on Windows; set everywhere so
 *                          cross-platform shared repos stay safe.
 * core.looseCompression  — Fastest compression for loose objects; git
 *                          re-compresses during pack, so speed > ratio here.
 * gc.auto                — Disables auto GC that can freeze operations.
 * pack.windowMemory      — Caps memory for pack operations; prevents OOM
 *                          on memory-constrained ARM laptops.
 * protocol.version       — Git protocol v2: more efficient ref advertisement,
 *                          reduces bandwidth on fetch.  Supported since 2.18.
 * safe.directory          — Git 2.35.2+ rejects operations in directories
 *                          owned by a different user ("dubious ownership").
 *                          On shared systems, network drives, or when
 *                          projects live on external storage, this causes
 *                          unexpected failures for non-developer users.
 *                          Setting to "*" disables the ownership check.
 * user.useConfigOnly      — Prevents git from guessing user.name and
 *                          user.email from the hostname/username.  All
 *                          commits must supply author info explicitly
 *                          (via GIT_AUTHOR_NAME env vars or -c flags),
 *                          which we already do.
 */
const PLATFORM_SAFETY_FLAGS = [
    "-c", "core.longpaths=true",
    "-c", "core.autocrlf=false",
    "-c", "core.fsmonitor=false",
    "-c", "core.pager=",
    "-c", "core.quotePath=false",
    "-c", "core.precomposeUnicode=true",
    "-c", "core.protectNTFS=true",
    "-c", "core.looseCompression=1",
    "-c", "gc.auto=0",
    "-c", "pack.windowMemory=256m",
    "-c", "protocol.version=2",
    "-c", "safe.directory=*",
    "-c", "user.useConfigOnly=true",
];

/**
 * Auto-remove stale index.lock files left behind by crashed git operations.
 * Only removes locks older than the threshold to avoid racing with
 * legitimately running git processes.
 */
const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Lock files that can be left behind after a crash and block subsequent
 * git operations. Each is relative to `<repo>/.git/`.
 */
const KNOWN_LOCK_FILES = [
    "index.lock",
    "shallow.lock",
    "config.lock",
    "HEAD.lock",
    "FETCH_HEAD.lock",
    "MERGE_HEAD.lock",
    "packed-refs.lock",
    "refs/heads/main.lock",
    "refs/heads/master.lock",
    "refs/remotes/origin/main.lock",
    "refs/remotes/origin/master.lock",
];

/**
 * Try to remove any stale lock file older than the threshold.
 * Returns true if at least one lock was removed.
 */
async function removeStaleLocks(dir: string): Promise<boolean> {
    let removed = false;
    for (const lockFile of KNOWN_LOCK_FILES) {
        const lockPath = path.join(dir, ".git", lockFile);
        try {
            const stat = await fs.promises.stat(lockPath);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs > STALE_LOCK_THRESHOLD_MS) {
                await fs.promises.unlink(lockPath);
                console.warn(
                    `[dugiteGit] Removed stale ${lockFile} (${Math.round(ageMs / 1000)}s old) at ${lockPath}`,
                );
                removed = true;
            } else {
                console.warn(
                    `[dugiteGit] ${lockFile} exists but is only ${Math.round(ageMs / 1000)}s old — not removing`,
                );
            }
        } catch {
            // Lock file doesn't exist — nothing to do
        }
    }
    return removed;
}

async function gitExec(
    args: string[],
    dir: string,
    options?: IGitExecutionOptions,
): Promise<IGitResult> {
    await ensureBinaryPath();

    const flags = [...LFS_OVERRIDE_FLAGS, ...CREDENTIAL_OVERRIDE_FLAGS, ...PLATFORM_SAFETY_FLAGS];
    const execOptions: IGitExecutionOptions = {
        ...options,
        env: { ...NON_INTERACTIVE_ENV, ...gitEnvOverrides, ...options?.env },
    };

    let result = await exec([...flags, ...args], dir, execOptions);

    if (result.exitCode !== 0) {
        const errStr = typeof result.stderr === "string"
            ? result.stderr
            : result.stderr.toString("utf8");
        // Only retry if stderr indicates an actual lock-file contention error,
        // not merely any mention of ".lock" in an unrelated message.
        const isLockError = /Unable to create '.*\.lock'/.test(errStr)
            || /\.lock.*File exists/.test(errStr)
            || /cannot lock ref/.test(errStr);
        if (isLockError && await removeStaleLocks(dir)) {
            result = await exec([...flags, ...args], dir, execOptions);
        }
    }

    return result;
}

class GitOperationError extends Error {
    public readonly exitCode: number;
    public readonly gitStderr: string;

    constructor(operation: string, result: IGitResult) {
        const stderrStr = stderr(result);
        super(`git ${operation} failed (exit ${result.exitCode}): ${stderrStr.trim()}`);
        this.name = "GitOperationError";
        this.exitCode = result.exitCode;
        this.gitStderr = stderrStr;
    }
}

function assertSuccess(operation: string, result: IGitResult): void {
    if (result.exitCode !== 0) {
        throw new GitOperationError(operation, result);
    }
}

/**
 * Extract stdout as a string with CRLF normalized to LF.
 * MinGW git on Windows typically outputs LF, but system-level git
 * config or locale settings can introduce CRLF in edge cases.
 * Normalizing here keeps all downstream parsers platform-safe.
 */
function stdout(result: IGitResult): string {
    const raw = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
    return raw.replace(/\r\n/g, "\n");
}

function stderr(result: IGitResult): string {
    const raw = typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf8");
    return raw.replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

/** Initialize a new git repository with default branch "main". */
export async function init(dir: string): Promise<void> {
    const result = await gitExec(["init", "-b", "main"], dir);
    assertSuccess("init", result);
}

/** Set a git config value. */
export async function setConfig(dir: string, key: string, value: string): Promise<void> {
    const result = await gitExec(["config", key, value], dir);
    assertSuccess("config", result);
}

/**
 * Disable LFS filters in a git repository. Used in test environments
 * where git-lfs is not installed alongside the system git binary.
 */
export async function disableLfsFilters(dir: string): Promise<void> {
    await setConfig(dir, "filter.lfs.process", "");
    await setConfig(dir, "filter.lfs.clean", "cat");
    await setConfig(dir, "filter.lfs.smudge", "cat");
    await setConfig(dir, "filter.lfs.required", "false");
}

/** Stage a single file. */
export async function add(dir: string, filepath: string): Promise<void> {
    const result = await gitExec(["add", "--", filepath], dir);
    assertSuccess("add", result);
}

/** Create a commit. Returns the new commit OID. */
export async function commit(
    dir: string,
    message: string,
    author: { name: string; email: string; },
): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const tzOffset = new Date().getTimezoneOffset();
    const tzSign = tzOffset <= 0 ? "+" : "-";
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
    const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, "0");
    const dateStr = `${timestamp} ${tzSign}${tzHours}${tzMins}`;

    const result = await gitExec(
        [
            "-c", `user.name=${author.name}`,
            "-c", `user.email=${author.email}`,
            "commit",
            "--allow-empty",
            "-m", message,
            "--date", dateStr,
        ],
        dir,
        {
            env: {
                GIT_AUTHOR_NAME: author.name,
                GIT_AUTHOR_EMAIL: author.email,
                GIT_AUTHOR_DATE: dateStr,
                GIT_COMMITTER_NAME: author.name,
                GIT_COMMITTER_EMAIL: author.email,
                GIT_COMMITTER_DATE: dateStr,
            },
        },
    );
    assertSuccess("commit", result);

    const oidResult = await gitExec(["rev-parse", "HEAD"], dir);
    assertSuccess("rev-parse HEAD", oidResult);
    return stdout(oidResult).trim();
}

/** Resolve a ref to its SHA. */
export async function resolveRef(dir: string, ref: string): Promise<string> {
    const result = await gitExec(["rev-parse", ref], dir);
    assertSuccess("rev-parse", result);
    return stdout(result).trim();
}

/** List all remotes. Returns array of { remote, url }. */
export async function listRemotes(dir: string): Promise<Array<{ remote: string; url: string; }>> {
    const result = await gitExec(["remote", "-v"], dir);
    assertSuccess("remote -v", result);
    const remotes = new Map<string, string>();
    for (const line of stdout(result).split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
        if (match) {
            remotes.set(match[1], match[2]);
        }
    }
    return Array.from(remotes.entries()).map(([remote, url]) => ({ remote, url }));
}

/** Add a remote. */
export async function addRemote(dir: string, name: string, url: string): Promise<void> {
    const result = await gitExec(["remote", "add", name, url], dir);
    assertSuccess("remote add", result);
}

/** Delete a remote. */
export async function deleteRemote(dir: string, name: string): Promise<void> {
    const result = await gitExec(["remote", "remove", name], dir);
    assertSuccess("remote remove", result);
}

/** Fetch from a remote (defaults to "origin"). */
export async function fetch(dir: string, remote = "origin"): Promise<void> {
    const result = await gitExec(["fetch", remote], dir);
    assertSuccess("fetch", result);
}

/** Status matrix entry, matching isomorphic-git's format. */
export type StatusMatrixEntry = [string, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];

/**
 * Get the status matrix for the working directory.
 */
export async function statusMatrix(dir: string): Promise<StatusMatrixEntry[]> {
    const result = await gitExec(
        ["--no-optional-locks", "status", "--porcelain=v2", "--untracked-files=all"],
        dir,
    );
    assertSuccess("status", result);

    const entries = new Map<string, StatusMatrixEntry>();

    for (const line of stdout(result).split("\n")) {
        if (!line) {
            continue;
        }

        if (line.startsWith("?")) {
            const filepath = line.substring(2);
            entries.set(filepath, [filepath, 0, 2, 0]);
            continue;
        }

        if (line.startsWith("!")) {
            continue;
        }

        if (line.startsWith("1") || line.startsWith("2")) {
            // Porcelain v2 format:
            // Type 1: "1 XY sub mH mI mW hH hI <path>" (8 fixed fields, path may have spaces)
            // Type 2: "2 XY sub mH mI mW hH hI X<score> <path>\t<origPath>"
            const parts = line.split("\t");
            const fields = parts[0].split(" ");
            const minFields = line.startsWith("2") ? 10 : 9;
            if (fields.length < minFields || !fields[1] || fields[1].length < 2) {
                console.warn(`[statusMatrix] Skipping malformed porcelain line: ${line}`);
                continue;
            }
            const xy = fields[1];

            let filepath: string;
            if (line.startsWith("2")) {
                filepath = fields.slice(9).join(" ");
            } else {
                filepath = fields.slice(8).join(" ");
            }

            const indexStatus = xy[0];
            const workdirStatus = xy[1];

            const headStatus: 0 | 1 = indexStatus === "A" ? 0 : 1;

            let workdir: 0 | 1 | 2;
            if (workdirStatus === ".") {
                workdir = 1;
            } else if (workdirStatus === "D") {
                workdir = 0;
            } else {
                workdir = 2;
            }

            let stage: 0 | 1 | 2;
            if (indexStatus === ".") {
                stage = 1;
            } else if (indexStatus === "D") {
                stage = 0;
            } else {
                stage = 2;
            }

            // When the file is staged for deletion, it is absent from
            // the index and typically from the working tree as well.
            // Override workdir to 0 for semantic consistency with isomorphic-git.
            if (indexStatus === "D") {
                workdir = 0;
            }

            entries.set(filepath, [filepath, headStatus, workdir, stage]);
            continue;
        }

        if (line.startsWith("u")) {
            // Unmerged entry: u XY sub m1 m2 m3 mW h1 h2 h3 <path>
            // 11 fixed space-separated fields (indices 0-10), path may contain spaces.
            const fields = line.split(" ");
            if (fields.length < 11) {
                console.warn(`[statusMatrix] Skipping malformed unmerged line: ${line}`);
                continue;
            }
            const filepath = fields.slice(10).join(" ");
            if (!filepath) {
                console.warn(`[statusMatrix] Skipping unmerged line with empty path: ${line}`);
                continue;
            }
            entries.set(filepath, [filepath, 1, 2, 2]);
            continue;
        }
    }

    // Include tracked, unmodified files.
    // Use -z for NUL-delimited output so filenames containing newlines
    // (valid on Unix, though unlikely for translation projects) parse correctly.
    const lsResult = await gitExec(["ls-files", "--cached", "-z"], dir);
    if (lsResult.exitCode === 0) {
        for (const filepath of stdout(lsResult).split("\0")) {
            if (filepath && !entries.has(filepath)) {
                entries.set(filepath, [filepath, 1, 1, 1]);
            }
        }
    }

    return Array.from(entries.values());
}

/** Get the status of a single file. */
export async function status(dir: string, filepath: string): Promise<string | undefined> {
    const result = await gitExec(
        ["--no-optional-locks", "status", "--porcelain=v2", "--", filepath],
        dir,
    );
    assertSuccess("status", result);
    const output = stdout(result).trim();
    return output || undefined;
}

/** List all tracked files in the repository. */
export async function listFiles(dir: string): Promise<string[]> {
    const result = await gitExec(["ls-files", "--cached", "-z"], dir);
    assertSuccess("ls-files", result);
    return stdout(result).split("\0").filter(Boolean);
}

/** Check if a directory is a git repository. */
export async function hasGitRepository(dir: string): Promise<boolean> {
    try {
        const result = await gitExec(["rev-parse", "--is-inside-work-tree"], dir);
        return result.exitCode === 0 && stdout(result).trim() === "true";
    } catch {
        return false;
    }
}

export interface LogEntry {
    oid: string;
    message: string;
    author: {
        name: string;
        email: string;
        timestamp: number;
    };
}

/** Write/update a ref (e.g. for setting up remote tracking refs). */
export async function updateRef(dir: string, ref: string, value: string): Promise<void> {
    const result = await gitExec(["update-ref", ref, value], dir);
    assertSuccess("update-ref", result);
}

/** Get commit log. */
export async function log(
    dir: string,
    options?: { depth?: number; ref?: string; },
): Promise<LogEntry[]> {
    // Use NUL (%x00) as the record separator — git commit messages cannot
    // contain NUL bytes, so this delimiter is collision-proof unlike text
    // sentinels like "---END---" which could appear in subject lines.
    const args = [
        "log",
        "--format=%H%n%an%n%ae%n%at%n%s%x00",
    ];
    if (options?.depth) {
        args.push(`-${options.depth}`);
    }
    if (options?.ref) {
        args.push(options.ref);
    }

    const result = await gitExec(args, dir);
    if (result.exitCode !== 0) {
        throw new GitOperationError("log", result);
    }

    const logEntries: LogEntry[] = [];
    const blocks = stdout(result).split("\0");

    for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length < 5) {
            continue;
        }
        const oid = lines[0];
        const timestamp = parseInt(lines[3], 10);
        if (!/^[0-9a-f]{40}$/i.test(oid) || Number.isNaN(timestamp)) {
            console.warn(`[log] Skipping malformed log entry: oid=${oid}, timestamp=${lines[3]}`);
            continue;
        }
        logEntries.push({
            oid,
            author: {
                name: lines[1],
                email: lines[2],
                timestamp,
            },
            message: lines[4],
        });
    }

    return logEntries;
}

/** Read file content at a specific ref. Returns the raw content as a Buffer. */
export async function readBlobAtRef(
    dir: string,
    ref: string,
    filepath: string,
): Promise<Buffer> {
    const result = await gitExec(["show", `${ref}:${filepath}`], dir, {
        encoding: "buffer",
    });
    assertSuccess("show", result);
    return result.stdout as Buffer;
}

/** Move/rename a file in the git index and working tree. */
export async function mv(dir: string, oldPath: string, newPath: string): Promise<void> {
    const result = await gitExec(["mv", "--", oldPath, newPath], dir);
    assertSuccess("mv", result);
}
