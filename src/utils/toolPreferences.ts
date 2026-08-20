import * as vscode from "vscode";
import { isNativeSqliteReady } from "./nativeSqlite";

// ---------------------------------------------------------------------------
// Audio tool preferences
// ---------------------------------------------------------------------------

export type AudioToolMode = "auto" | "builtin" | "force-builtin";

const AUDIO_TOOL_MODE_KEY = "toolPreferences.audioToolMode";
const SQLITE_TOOL_MODE_KEY = "toolPreferences.sqliteToolMode";
const SESSION_OVERRIDES_KEY = "toolPreferences.sessionOverrides";
const PROJECT_HANDOFF_KEY = "toolPreferences.projectHandoff";

let cachedContext: vscode.ExtensionContext | undefined;
type SessionToolOverrides = Partial<{
    audio: "builtin";
    git: "builtin";
    sqlite: "builtin";
}>;
interface StoredSessionOverrides {
    sessionId: string;
    overrides: SessionToolOverrides;
}
interface ProjectToolHandoff {
    sourceSessionId: string;
    targetPath: string;
    createdAt: number;
    overrides: SessionToolOverrides;
}
let sessionOverrides: SessionToolOverrides = {};

const persistSessionOverrides = async (): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    if (Object.keys(sessionOverrides).length === 0) {
        await cachedContext.globalState.update(SESSION_OVERRIDES_KEY, undefined);
        return;
    }
    const state: StoredSessionOverrides = {
        sessionId: vscode.env.sessionId,
        overrides: sessionOverrides,
    };
    await cachedContext.globalState.update(SESSION_OVERRIDES_KEY, state);
};

export const initToolPreferences = (context: vscode.ExtensionContext): void => {
    cachedContext = context;
    sessionOverrides = {};

    const stored = context.globalState.get<StoredSessionOverrides>(SESSION_OVERRIDES_KEY);
    const handoff = context.globalState.get<ProjectToolHandoff>(PROJECT_HANDOFF_KEY);
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (
        handoff &&
        Date.now() - handoff.createdAt < 120_000 &&
        handoff.targetPath === workspacePath &&
        handoff.sourceSessionId !== vscode.env.sessionId
    ) {
        sessionOverrides = { ...handoff.overrides };
        void context.globalState.update(PROJECT_HANDOFF_KEY, undefined);
        void persistSessionOverrides();
    } else if (stored?.sessionId === vscode.env.sessionId) {
        sessionOverrides = { ...stored.overrides };
    } else {
        void context.globalState.update(SESSION_OVERRIDES_KEY, undefined);
        void context.globalState.update(PROJECT_HANDOFF_KEY, undefined);
    }

    // Migrate the old persistent "builtin" preference into this session only.
    const persistedAudioMode = context.globalState.get<AudioToolMode>(AUDIO_TOOL_MODE_KEY);
    if (!sessionOverrides.audio && persistedAudioMode === "builtin") {
        sessionOverrides.audio = "builtin";
        void context.globalState.update(AUDIO_TOOL_MODE_KEY, "auto");
    }
    const persistedSqliteMode = context.globalState.get<SqliteToolMode>(SQLITE_TOOL_MODE_KEY);
    if (!sessionOverrides.sqlite && persistedSqliteMode === "builtin") {
        sessionOverrides.sqlite = "builtin";
        void context.globalState.update(SQLITE_TOOL_MODE_KEY, "auto");
    }
    const persistedGitMode = vscode.workspace
        .getConfiguration("codex-editor")
        .get<GitToolMode>("gitBackendMode");
    if (!sessionOverrides.git && persistedGitMode === "builtin") {
        sessionOverrides.git = "builtin";
        void vscode.workspace
            .getConfiguration("codex-editor")
            .update("gitBackendMode", "auto", vscode.ConfigurationTarget.Global);
    }
    void persistSessionOverrides();
};

export const getAudioToolMode = (): AudioToolMode => {
    if (!cachedContext) {
        return "auto";
    }
    const persisted = cachedContext.globalState.get<AudioToolMode>(AUDIO_TOOL_MODE_KEY) ?? "auto";
    if (persisted === "force-builtin") {
        return persisted;
    }
    return sessionOverrides.audio ?? "auto";
};

export const setAudioToolMode = async (mode: AudioToolMode): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    if (mode === "builtin") {
        sessionOverrides.audio = mode;
        await cachedContext.globalState.update(AUDIO_TOOL_MODE_KEY, "auto");
    } else {
        delete sessionOverrides.audio;
        await cachedContext.globalState.update(AUDIO_TOOL_MODE_KEY, mode);
    }
    await persistSessionOverrides();
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
    const persisted = vscode.workspace
        .getConfiguration("codex-editor")
        .get<GitToolMode>("gitBackendMode");
    if (persisted === "force-builtin") {
        return persisted;
    }
    return sessionOverrides.git ?? "auto";
};

export const setGitToolMode = async (mode: GitToolMode): Promise<void> => {
    if (mode === "builtin") {
        sessionOverrides.git = mode;
        await vscode.workspace
            .getConfiguration("codex-editor")
            .update("gitBackendMode", "auto", vscode.ConfigurationTarget.Global);
    } else {
        delete sessionOverrides.git;
        await vscode.workspace
            .getConfiguration("codex-editor")
            .update("gitBackendMode", mode, vscode.ConfigurationTarget.Global);
    }
    await persistSessionOverrides();
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

export const getSqliteToolMode = (): SqliteToolMode => {
    if (!cachedContext) {
        return "auto";
    }
    const persisted = cachedContext.globalState.get<SqliteToolMode>(SQLITE_TOOL_MODE_KEY) ?? "auto";
    if (persisted === "force-builtin") {
        return persisted;
    }
    return sessionOverrides.sqlite ?? "auto";
};

export const setSqliteToolMode = async (mode: SqliteToolMode): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    if (mode === "builtin") {
        sessionOverrides.sqlite = mode;
        await cachedContext.globalState.update(SQLITE_TOOL_MODE_KEY, "auto");
    } else {
        delete sessionOverrides.sqlite;
        await cachedContext.globalState.update(SQLITE_TOOL_MODE_KEY, mode);
    }
    await persistSessionOverrides();
};

/**
 * Preserve a temporary compatibility choice when Codex intentionally opens
 * another project window. A normal application restart has no handoff marker,
 * so the choice expires with the previous editor session.
 */
export const markProjectToolModeHandoff = async (targetUri: vscode.Uri): Promise<void> => {
    if (!cachedContext || Object.keys(sessionOverrides).length === 0) {
        return;
    }
    const handoff: ProjectToolHandoff = {
        sourceSessionId: vscode.env.sessionId,
        targetPath: targetUri.fsPath,
        createdAt: Date.now(),
        overrides: { ...sessionOverrides },
    };
    await cachedContext.globalState.update(PROJECT_HANDOFF_KEY, handoff);
};

export const openFolderWithToolModeHandoff = async (
    targetUri: vscode.Uri,
    newWindow?: boolean,
): Promise<void> => {
    await markProjectToolModeHandoff(targetUri);
    await vscode.commands.executeCommand("vscode.openFolder", targetUri, newWindow);
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
