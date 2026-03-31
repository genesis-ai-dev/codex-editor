/**
 * isomorphicGitAdapter.ts — Pure-JS git implementation using isomorphic-git.
 *
 * Implements the same API surface as dugiteGitNative.ts so the routing layer
 * in dugiteGit.ts can delegate transparently. This adapter is used when the
 * native dugite binary is unavailable or the user has selected "builtin" mode.
 */

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "fs";
import * as path from "path";

import type { StatusMatrixEntry, LogEntry } from "./dugiteGitNative";

// ---------------------------------------------------------------------------
// Binary-path stubs (no-ops — only meaningful for native dugite)
// ---------------------------------------------------------------------------

export function setGitBinaryPath(_localGitDir: string, _execPath: string): void {
    // no-op: isomorphic-git does not use an external binary
}

export function useEmbeddedGitBinary(): void {
    // no-op
}

export function resetGitBinaryPath(): void {
    // no-op
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

export async function init(dir: string): Promise<void> {
    await git.init({ fs, dir, defaultBranch: "main" });
}

export async function setConfig(dir: string, key: string, value: string): Promise<void> {
    await git.setConfig({ fs, dir, path: key, value });
}

export async function disableLfsFilters(dir: string): Promise<void> {
    await setConfig(dir, "filter.lfs.process", "");
    await setConfig(dir, "filter.lfs.clean", "cat");
    await setConfig(dir, "filter.lfs.smudge", "cat");
    await setConfig(dir, "filter.lfs.required", "false");
}

export async function add(dir: string, filepath: string): Promise<void> {
    if (filepath === "." || filepath === "--all") {
        const statusRows = await git.statusMatrix({ fs, dir });
        for (const [file, , workdirStatus, stageStatus] of statusRows) {
            if (workdirStatus !== stageStatus) {
                if (workdirStatus === 0) {
                    await git.remove({ fs, dir, filepath: file });
                } else {
                    await git.add({ fs, dir, filepath: file });
                }
            }
        }
        return;
    }
    try {
        await fs.promises.access(path.join(dir, filepath));
        await git.add({ fs, dir, filepath });
    } catch {
        await git.remove({ fs, dir, filepath });
    }
}

export async function commit(
    dir: string,
    message: string,
    author: { name: string; email: string },
): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const timezoneOffset = new Date().getTimezoneOffset();
    try {
        const oid = await git.commit({
            fs,
            dir,
            message,
            author: {
                name: author.name,
                email: author.email,
                timestamp,
                timezoneOffset,
            },
            committer: {
                name: author.name,
                email: author.email,
                timestamp,
                timezoneOffset,
            },
        });
        return oid;
    } catch {
        return git.resolveRef({ fs, dir, ref: "HEAD" });
    }
}

export async function resolveRef(dir: string, ref: string): Promise<string> {
    return git.resolveRef({ fs, dir, ref });
}

export async function listRemotes(
    dir: string,
): Promise<Array<{ remote: string; url: string }>> {
    const remotes = await git.listRemotes({ fs, dir });
    return remotes.map(({ remote, url }) => ({ remote, url }));
}

export async function addRemote(dir: string, name: string, url: string): Promise<void> {
    await git.addRemote({ fs, dir, remote: name, url });
}

export async function deleteRemote(dir: string, name: string): Promise<void> {
    await git.deleteRemote({ fs, dir, remote: name });
}

export async function fetch(dir: string, remote = "origin"): Promise<void> {
    await git.fetch({ fs, http, dir, remote });
}

export async function statusMatrix(dir: string): Promise<StatusMatrixEntry[]> {
    const rows = await git.statusMatrix({ fs, dir });
    return rows as StatusMatrixEntry[];
}

/**
 * Get the status of a single file. Returns undefined when unmodified,
 * or a non-empty string when the file has changes (callers only check
 * truthiness, not the actual string content).
 */
export async function status(dir: string, filepath: string): Promise<string | undefined> {
    const result = await git.status({ fs, dir, filepath });
    if (result === "unmodified" || result === "absent") {
        return undefined;
    }
    return result;
}

export async function listFiles(dir: string): Promise<string[]> {
    return git.listFiles({ fs, dir });
}

export async function hasGitRepository(dir: string): Promise<boolean> {
    try {
        await fs.promises.access(path.join(dir, ".git"), fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export async function updateRef(dir: string, ref: string, value: string): Promise<void> {
    await git.writeRef({ fs, dir, ref, value, force: true });
}

export async function log(
    dir: string,
    options?: { depth?: number; ref?: string },
): Promise<LogEntry[]> {
    const commits = await git.log({
        fs,
        dir,
        depth: options?.depth,
        ref: options?.ref ?? "HEAD",
    });
    return commits.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message.split("\n")[0],
        author: {
            name: entry.commit.author.name,
            email: entry.commit.author.email,
            timestamp: entry.commit.author.timestamp,
        },
    }));
}

export async function readBlobAtRef(
    dir: string,
    ref: string,
    filepath: string,
): Promise<Buffer> {
    const refCandidates = [
        ref,
        `refs/remotes/${ref}`,
        `refs/heads/${ref}`,
        `refs/tags/${ref}`,
    ];
    let oid: string | undefined;
    for (const candidate of refCandidates) {
        try {
            oid = await git.resolveRef({ fs, dir, ref: candidate });
            break;
        } catch {
            /* try next candidate */
        }
    }
    if (!oid) {
        oid = ref;
    }
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    return Buffer.from(blob);
}

export async function mv(dir: string, oldPath: string, newPath: string): Promise<void> {
    const absOld = path.join(dir, oldPath);
    const absNew = path.join(dir, newPath);
    const newDir = path.dirname(absNew);
    await fs.promises.mkdir(newDir, { recursive: true });
    await fs.promises.rename(absOld, absNew);
    await git.remove({ fs, dir, filepath: oldPath });
    await git.add({ fs, dir, filepath: newPath });
}
