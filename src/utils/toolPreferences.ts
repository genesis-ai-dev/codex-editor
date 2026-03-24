import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Audio tool preferences
// ---------------------------------------------------------------------------

export type AudioToolMode = "auto" | "builtin";

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
    if (mode === "builtin") {
        return false;
    }
    return ffmpegAvailable;
};

// ---------------------------------------------------------------------------
// Git tool preferences
// ---------------------------------------------------------------------------

export type GitToolMode = "auto" | "builtin";

const GIT_TOOL_MODE_KEY = "toolPreferences.gitToolMode";

let _nativeGitAvailable = false;

export const getGitToolMode = (): GitToolMode => {
    if (!cachedContext) {
        return "auto";
    }
    return cachedContext.globalState.get<GitToolMode>(GIT_TOOL_MODE_KEY) ?? "auto";
};

export const setGitToolMode = async (mode: GitToolMode): Promise<void> => {
    if (!cachedContext) {
        return;
    }
    await cachedContext.globalState.update(GIT_TOOL_MODE_KEY, mode);
};

export const setNativeGitAvailable = (available: boolean): void => {
    _nativeGitAvailable = available;
};

/**
 * Single decision point for the dugiteGit routing layer.
 * - "builtin" mode -> always isomorphic-git
 * - "auto" mode -> dugite if native binary is available, else isomorphic-git
 *
 * The preference is persisted in globalState. If the user has "auto" but the
 * native binary is unavailable, isomorphic-git is used at runtime while the
 * stored preference stays "auto" -- so when the binary becomes available
 * (e.g. user downloads it), dugite kicks back in automatically.
 */
export const shouldUseNativeGit = (): boolean => {
    if (getGitToolMode() === "builtin") {
        return false;
    }
    return _nativeGitAvailable;
};
