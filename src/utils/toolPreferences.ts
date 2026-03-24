import * as vscode from "vscode";

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
