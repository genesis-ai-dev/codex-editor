import { useEffect, useState } from "react";

/**
 * Detects whether the user has at least one audio input device (microphone)
 * available. Listens for `devicechange` events so the result updates live when
 * a microphone is plugged in or unplugged — no need to reopen the audio tab.
 *
 * Behavior notes:
 *   - When `navigator.mediaDevices.enumerateDevices` is unavailable (very old
 *     browsers, restricted contexts), `isSupported` returns `false` and the
 *     caller should treat the result as "unknown" rather than "no device".
 *     We default `hasAudioInput` to `true` in that case so we never
 *     false-positive disable recording on a working machine.
 *   - Devices show up in `enumerateDevices()` even when the user hasn't yet
 *     granted microphone permission (their labels are blank, but the entries
 *     still count). That's exactly what we want: we're checking for hardware
 *     presence, not permission state.
 *
 * Debug-only override:
 *   Set `window.__forceNoAudioInput = true` in the webview devtools to
 *   simulate "no microphone detected" without unplugging hardware. Useful for
 *   QA / styling work on machines that always have a working mic. Safe to
 *   leave in — it does nothing unless explicitly set.
 */
export interface UseAudioInputDevicesResult {
    /** True when at least one `audioinput` device exists. Defaults to `true`
     *  while still checking and when the API is unsupported. */
    hasAudioInput: boolean;
    /** True during the initial enumeration (before we've heard back once). */
    isChecking: boolean;
    /** False when `navigator.mediaDevices.enumerateDevices` isn't available. */
    isSupported: boolean;
}

declare global {
    interface Window {
        /** DEV/QA only: force `useAudioInputDevices` to report no microphone. */
        __forceNoAudioInput?: boolean;
    }
}

export function useAudioInputDevices(): UseAudioInputDevicesResult {
    const isSupported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === "function";

    const [hasAudioInput, setHasAudioInput] = useState<boolean>(true);
    const [isChecking, setIsChecking] = useState<boolean>(isSupported);

    useEffect(() => {
        if (!isSupported) {
            setIsChecking(false);
            return;
        }

        let cancelled = false;

        const checkDevices = async () => {
            try {
                if (window.__forceNoAudioInput) {
                    if (!cancelled) {
                        setHasAudioInput(false);
                        setIsChecking(false);
                    }
                    return;
                }
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter((d) => d.kind === "audioinput");
                if (!cancelled) {
                    setHasAudioInput(audioInputs.length > 0);
                    setIsChecking(false);
                }
            } catch (err) {
                console.warn("useAudioInputDevices: enumerateDevices failed", err);
                if (!cancelled) {
                    // On enumeration failure, fall back to "assume present" so
                    // we don't disable recording on a machine that may well
                    // have a working mic. The actual `getUserMedia` call will
                    // surface a clearer error if recording is then attempted.
                    setHasAudioInput(true);
                    setIsChecking(false);
                }
            }
        };

        checkDevices();

        const handleDeviceChange = () => {
            checkDevices();
        };

        navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
        };
    }, [isSupported]);

    return { hasAudioInput, isChecking, isSupported };
}
