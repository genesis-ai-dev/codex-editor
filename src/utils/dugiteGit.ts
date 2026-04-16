/**
 * dugiteGit.ts — Routing layer for git operations.
 *
 * Delegates every call to either the native dugite wrapper
 * (dugiteGitNative.ts) or the pure-JS isomorphic-git adapter
 * (isomorphicGitAdapter.ts) based on a single boolean flag
 * returned by shouldUseNativeGit().
 *
 * Consumer files import from this module — their imports remain
 * unchanged regardless of which backend is active.
 */

import { shouldUseNativeGit } from "./toolPreferences";
import * as native from "./dugiteGitNative";
import * as fallback from "./isomorphicGitAdapter";

// ---------------------------------------------------------------------------
// Re-export types (identical in both implementations)
// ---------------------------------------------------------------------------

export type { StatusMatrixEntry, LogEntry } from "./dugiteGitNative";

// ---------------------------------------------------------------------------
// Binary-path helpers — always forward to the native module since they
// manage the dugite binary and are irrelevant for isomorphic-git.
// ---------------------------------------------------------------------------

export const setGitBinaryPath = native.setGitBinaryPath;
export const useEmbeddedGitBinary = native.useEmbeddedGitBinary;
export const resetGitBinaryPath = native.resetGitBinaryPath;

// ---------------------------------------------------------------------------
// Git operations — one-liner routing via shouldUseNativeGit()
// ---------------------------------------------------------------------------

export async function init(dir: string): Promise<void> {
    return shouldUseNativeGit() ? native.init(dir) : fallback.init(dir);
}

export async function setConfig(dir: string, key: string, value: string): Promise<void> {
    return shouldUseNativeGit() ? native.setConfig(dir, key, value) : fallback.setConfig(dir, key, value);
}

export async function disableLfsFilters(dir: string): Promise<void> {
    return shouldUseNativeGit() ? native.disableLfsFilters(dir) : fallback.disableLfsFilters(dir);
}

export async function add(dir: string, filepath: string): Promise<void> {
    return shouldUseNativeGit() ? native.add(dir, filepath) : fallback.add(dir, filepath);
}

export async function commit(
    dir: string,
    message: string,
    author: { name: string; email: string },
): Promise<string> {
    return shouldUseNativeGit()
        ? native.commit(dir, message, author)
        : fallback.commit(dir, message, author);
}

export async function resolveRef(dir: string, ref: string): Promise<string> {
    return shouldUseNativeGit() ? native.resolveRef(dir, ref) : fallback.resolveRef(dir, ref);
}

export async function listRemotes(
    dir: string,
): Promise<Array<{ remote: string; url: string }>> {
    return shouldUseNativeGit() ? native.listRemotes(dir) : fallback.listRemotes(dir);
}

export async function addRemote(dir: string, name: string, url: string): Promise<void> {
    return shouldUseNativeGit()
        ? native.addRemote(dir, name, url)
        : fallback.addRemote(dir, name, url);
}

export async function deleteRemote(dir: string, name: string): Promise<void> {
    return shouldUseNativeGit() ? native.deleteRemote(dir, name) : fallback.deleteRemote(dir, name);
}

export async function fetch(dir: string, remote = "origin"): Promise<void> {
    return shouldUseNativeGit() ? native.fetch(dir, remote) : fallback.fetch(dir, remote);
}

export async function statusMatrix(
    dir: string,
): Promise<Array<[string, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]>> {
    return shouldUseNativeGit() ? native.statusMatrix(dir) : fallback.statusMatrix(dir);
}

export async function status(dir: string, filepath: string): Promise<string | undefined> {
    return shouldUseNativeGit() ? native.status(dir, filepath) : fallback.status(dir, filepath);
}

export async function listFiles(dir: string): Promise<string[]> {
    return shouldUseNativeGit() ? native.listFiles(dir) : fallback.listFiles(dir);
}

export async function hasGitRepository(dir: string): Promise<boolean> {
    return shouldUseNativeGit()
        ? native.hasGitRepository(dir)
        : fallback.hasGitRepository(dir);
}

export async function updateRef(dir: string, ref: string, value: string): Promise<void> {
    return shouldUseNativeGit()
        ? native.updateRef(dir, ref, value)
        : fallback.updateRef(dir, ref, value);
}

export async function log(
    dir: string,
    options?: { depth?: number; ref?: string },
): Promise<Array<{ oid: string; message: string; author: { name: string; email: string; timestamp: number } }>> {
    return shouldUseNativeGit() ? native.log(dir, options) : fallback.log(dir, options);
}

export async function readBlobAtRef(
    dir: string,
    ref: string,
    filepath: string,
): Promise<Buffer> {
    return shouldUseNativeGit()
        ? native.readBlobAtRef(dir, ref, filepath)
        : fallback.readBlobAtRef(dir, ref, filepath);
}

export async function mv(dir: string, oldPath: string, newPath: string): Promise<void> {
    return shouldUseNativeGit() ? native.mv(dir, oldPath, newPath) : fallback.mv(dir, oldPath, newPath);
}
