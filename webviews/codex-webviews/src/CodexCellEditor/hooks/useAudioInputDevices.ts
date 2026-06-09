import { useCallback, useEffect, useState } from "react";

/**
 * Detects whether the user can record audio right now. Reports separately
 * for two different failure modes:
 *   - "no-device" — there is no audioinput hardware enumerated. The user
 *     needs to plug in / connect a microphone.
 *   - "permission-denied" — a device exists but the OS / browser blocks
 *     access. The user needs to grant microphone access in system settings.
 *   - "available" — at least one device exists and permission is not blocked.
 *   - "checking" — initial detection still in flight.
 *   - "unsupported" — the necessary APIs aren't available. Treated as
 *     "assume available" by callers so we never false-positive disable on a
 *     working machine.
 *
 * Reacts live to three signals so the UI stays in sync without a reload:
 *   - `devicechange` on `navigator.mediaDevices` (mic plugged / unplugged)
 *   - `change` on the `microphone` PermissionStatus (user grants/revokes
 *     access via the address bar or browser-level settings)
 *   - Runtime reports from the recorder via `reportRecorderError(err)` — the
 *     only reliable way to observe an OS-level block on macOS / Linux (the
 *     Permissions API only reflects browser-level state, not OS settings,
 *     so a user who denies in System Settings will still see `"granted"`
 *     from `navigator.permissions.query`; we only learn the real state
 *     when `getUserMedia()` throws `NotAllowedError`).
 *
 * Devices typically show up in `enumerateDevices()` even before the user has
 * granted permission (their labels are blank, but the entries still count).
 * That means device count alone can't tell us if access is *blocked* — only
 * the permissions API or a real `getUserMedia()` attempt can.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REVIEWER NOTE — testing without unplugging your microphone:
 *
 *   Edit the `FORCE_STATE_FOR_REVIEW` constant below to force a specific
 *   state regardless of real hardware. Rebuild the webview
 *   (`pnpm run build:CodexCellEditor`) and reload the extension host to
 *   see the corresponding UI. **Set back to `null` before committing.**
 *
 *     FORCE_STATE_FOR_REVIEW = "no-device"         // grey slashed-mic + "no microphone detected" alert
 *     FORCE_STATE_FOR_REVIEW = "permission-denied" // grey slashed-mic + "access denied" alert
 *     FORCE_STATE_FOR_REVIEW = null                // real detection (default)
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Override real detection for visual review. MUST be `null` in committed code. */
const FORCE_STATE_FOR_REVIEW: MicAvailability | null = null;

export type MicAvailability =
    | "available"
    | "checking"
    | "no-device"
    | "permission-denied"
    | "unsupported";

export interface UseAudioInputDevicesResult {
    /** High-level state for branching UI. */
    availability: MicAvailability;
    /** True when the user can't record (no device or permission denied). */
    micUnavailable: boolean;
    /** True specifically when no audioinput hardware exists. */
    noMicDetected: boolean;
    /** True specifically when permission is denied for an existing mic. */
    micPermissionDenied: boolean;
    /**
     * Call from the recorder's `getUserMedia` catch block with the thrown
     * error. The hook classifies the error name (`NotAllowedError`,
     * `NotFoundError`, etc.) and updates `availability` accordingly. This
     * is the only reliable path for catching OS-level mic blocks where the
     * Permissions API misreports. Pass `null` to clear a runtime-set state
     * (e.g. after a successful `getUserMedia` call).
     */
    reportRecorderError: (err: unknown | null) => void;
}

type PermissionState = "granted" | "denied" | "prompt" | "unknown";

async function queryMicPermission(): Promise<PermissionState> {
    try {
        if (typeof navigator === "undefined" || !navigator.permissions?.query) {
            return "unknown";
        }
        // `microphone` isn't in TS's PermissionName union in all lib versions.
        const status = (await navigator.permissions.query({
            name: "microphone" as PermissionName,
        })) as PermissionStatus;
        return status.state as PermissionState;
    } catch {
        // Some environments (Safari, restricted contexts) throw for
        // unsupported permission names. Treat as "we don't know".
        return "unknown";
    }
}

async function subscribeToMicPermission(
    onChange: (state: PermissionState) => void
): Promise<(() => void) | null> {
    try {
        if (typeof navigator === "undefined" || !navigator.permissions?.query) {
            return null;
        }
        const status = (await navigator.permissions.query({
            name: "microphone" as PermissionName,
        })) as PermissionStatus;
        const handler = () => onChange(status.state as PermissionState);
        status.addEventListener("change", handler);
        return () => status.removeEventListener("change", handler);
    } catch {
        return null;
    }
}

/**
 * Map a `getUserMedia` rejection to a `MicAvailability` value. Returns `null`
 * for transient or unknown errors so the caller leaves the state untouched.
 *
 * The `name` property is set by the browser per the WebRTC spec and is the
 * supported way to distinguish these cases. Older browsers used different
 * names (e.g. `DevicesNotFoundError`), so we accept the most common aliases.
 */
function classifyRecorderError(err: unknown): MicAvailability | null {
    if (!err || typeof err !== "object") return null;
    const name = (err as { name?: string }).name;
    switch (name) {
        case "NotAllowedError":
        case "PermissionDeniedError": // Legacy Chromium alias.
        case "SecurityError":
            return "permission-denied";
        case "NotFoundError":
        case "DevicesNotFoundError": // Legacy alias.
        case "OverconstrainedError":
            return "no-device";
        default:
            return null;
    }
}

export function useAudioInputDevices(): UseAudioInputDevicesResult {
    const isSupported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === "function";

    const [availability, setAvailability] = useState<MicAvailability>(
        isSupported ? "checking" : "unsupported"
    );
    // When the recorder reports an error, we pin the state until cleared.
    // Passive signals (`devicechange`, permission `change`) won't override it,
    // because on macOS those signals are unreliable for OS-level mic blocks.
    // The recorder calls `reportRecorderError(null)` after a successful
    // `getUserMedia` to release the pin.
    const [runtimeOverride, setRuntimeOverride] = useState<MicAvailability | null>(null);

    useEffect(() => {
        if (FORCE_STATE_FOR_REVIEW !== null) {
            setAvailability(FORCE_STATE_FOR_REVIEW);
            return;
        }

        if (!isSupported) {
            setAvailability("unsupported");
            return;
        }

        // Capture `mediaDevices` at mount so the cleanup path can remove its
        // listener even if the global is later swapped (tests, hot-reload).
        const mediaDevices = navigator.mediaDevices;
        let cancelled = false;

        const evaluate = async () => {
            try {
                const [devices, permission] = await Promise.all([
                    mediaDevices.enumerateDevices(),
                    queryMicPermission(),
                ]);
                if (cancelled) return;

                if (permission === "denied") {
                    setAvailability("permission-denied");
                    return;
                }
                const audioInputs = devices.filter((d) => d.kind === "audioinput");
                setAvailability(audioInputs.length > 0 ? "available" : "no-device");
            } catch (err) {
                console.warn("useAudioInputDevices: detection failed", err);
                if (!cancelled) {
                    // On detection failure, fall back to "assume present" so
                    // we don't disable recording on a machine that may well
                    // have a working mic. The actual `getUserMedia` call will
                    // surface a clearer error if recording is then attempted.
                    setAvailability("available");
                }
            }
        };

        evaluate();

        const handleDeviceChange = () => evaluate();
        mediaDevices.addEventListener("devicechange", handleDeviceChange);

        let unsubscribePermission: (() => void) | null = null;
        subscribeToMicPermission(() => evaluate()).then((unsub) => {
            if (cancelled) {
                unsub?.();
                return;
            }
            unsubscribePermission = unsub;
        });

        return () => {
            cancelled = true;
            mediaDevices.removeEventListener("devicechange", handleDeviceChange);
            unsubscribePermission?.();
        };
    }, [isSupported]);

    const reportRecorderError = useCallback((err: unknown | null) => {
        if (err === null) {
            setRuntimeOverride(null);
            return;
        }
        const classified = classifyRecorderError(err);
        if (classified) setRuntimeOverride(classified);
    }, []);

    // Runtime override (from a real `getUserMedia` failure) takes precedence
    // because it reflects ground truth, not Chromium's stale view of OS
    // permissions. The dev-only `FORCE_STATE_FOR_REVIEW` still wins above
    // everything for visual testing.
    const effectiveAvailability: MicAvailability =
        FORCE_STATE_FOR_REVIEW ?? runtimeOverride ?? availability;

    const noMicDetected = effectiveAvailability === "no-device";
    const micPermissionDenied = effectiveAvailability === "permission-denied";
    const micUnavailable = noMicDetected || micPermissionDenied;

    return {
        availability: effectiveAvailability,
        micUnavailable,
        noMicDetected,
        micPermissionDenied,
        reportRecorderError,
    };
}
