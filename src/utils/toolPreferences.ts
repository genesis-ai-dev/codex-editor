import * as vscode from "vscode";
import { isNativeSqliteReady } from "./nativeSqlite";

// ---------------------------------------------------------------------------
// Audio tool preferences
// ---------------------------------------------------------------------------

export type AudioToolMode = "auto" | "builtin" | "force-builtin";

const AUDIO_TOOL_MODE_KEY = "toolPreferences.audioToolMode";

let cachedContext: vscode.ExtensionContext | undefined;

export const initToolPreferences = (context: vscode.ExtensionContext): void => {
    cachedContext = context;
};

export const getAudioToolMode = (): AudioToolMode => {
    if (!cachedContext) {
        return "auto";
    }
    return cachedContext.globalState.get<AudioToolMode>(AUDIO_TOOL_MODE_KEY) ?? "auto";
};

export const setAudioToolMode = async (mode: AudioToolMode): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    await cachedContext.globalState.update(AUDIO_TOOL_MODE_KEY, mode);
};

/**
 * Determines whether to use the native FFmpeg for audio operations.
 * Returns true only when the preference is "auto" AND the caller
 * has confirmed FFmpeg is available. When mode is "builtin", always
 * returns false so the Web Audio API / wavUtils path is taken.
 */
export const shouldUseNativeAudio = (ffmpegAvailable: boolean): boolean => {
    const mode = getAudioToolMode();
    if (mode === "builtin" || mode === "force-builtin") {
        return false;
    }
    return ffmpegAvailable;
};

// ---------------------------------------------------------------------------
// Git tool preferences
// ---------------------------------------------------------------------------

export type GitToolMode = "auto" | "builtin" | "force-builtin";

let _nativeGitAvailable = false;

/**
 * Read the git backend preference from the shared VS Code setting.
 * Both codex-editor and frontier-authentication read this same setting
 * so they always agree on which git backend to use.
 */
export const getGitToolMode = (): GitToolMode => {
    const mode = vscode.workspace
        .getConfiguration("codex-editor")
        .get<GitToolMode>("gitBackendMode");
    return mode ?? "auto";
};

export const setGitToolMode = async (mode: GitToolMode): Promise<void> => {
    await vscode.workspace
        .getConfiguration("codex-editor")
        .update("gitBackendMode", mode, vscode.ConfigurationTarget.Global);
};

export const setNativeGitAvailable = (available: boolean): void => {
    _nativeGitAvailable = available;
};

/**
 * Single decision point for the dugiteGit routing layer.
 * - "builtin" mode -> always isomorphic-git
 * - "auto" mode -> dugite if native binary is available, else isomorphic-git
 *
 * The preference is stored in the VS Code setting `codex-editor.gitBackendMode`,
 * which is also read by frontier-authentication so both extensions use the same
 * backend. If the user has "auto" but the native binary is unavailable,
 * isomorphic-git is used at runtime while the stored preference stays "auto" —
 * so when the binary becomes available (e.g. user downloads it), dugite kicks
 * back in automatically.
 */
export const shouldUseNativeGit = (): boolean => {
    const mode = getGitToolMode();
    if (mode === "builtin" || mode === "force-builtin") {
        return false;
    }
    return _nativeGitAvailable;
};

// ---------------------------------------------------------------------------
// SQLite tool preferences
// ---------------------------------------------------------------------------

export type SqliteToolMode = "auto" | "builtin" | "force-builtin";

const SQLITE_TOOL_MODE_KEY = "toolPreferences.sqliteToolMode";

export const getSqliteToolMode = (): SqliteToolMode => {
    if (!cachedContext) {
        return "auto";
    }
    return cachedContext.globalState.get<SqliteToolMode>(SQLITE_TOOL_MODE_KEY) ?? "auto";
};

export const setSqliteToolMode = async (mode: SqliteToolMode): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    await cachedContext.globalState.update(SQLITE_TOOL_MODE_KEY, mode);
};

/**
 * Determines whether to use the native SQLite (node_sqlite3) backend.
 * Returns true only when the preference is "auto" AND the native binary
 * has been loaded.  When mode is "builtin", always returns false so the
 * fts5-sql-bundle (sql.js WASM) fallback is used.
 *
 * Similar to the git pattern: the stored preference stays "auto" even when
 * native is unavailable, so it kicks back in automatically once the binary
 * is downloaded.
 */
export const shouldUseNativeSqlite = (): boolean => {
    const mode = getSqliteToolMode();
    if (mode === "builtin" || mode === "force-builtin") {
        return false;
    }
    return isNativeSqliteReady();
};
