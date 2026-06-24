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
 * Reacts live to four signals so the UI stays in sync without a reload:
 *   - `devicechange` on `navigator.mediaDevices` (mic plugged / unplugged)
 *   - `change` on the `microphone` PermissionStatus (user grants/revokes
 *     access via the address bar or browser-level settings)
 *   - `probeMicAccess()` — caller-initiated probe via a silent
 *     `getUserMedia({ audio: true })` + immediate `track.stop()`. The
 *     ONLY way to detect OS-level mic blocks (macOS System Settings /
 *     Windows Privacy settings) because Chromium's Permissions API
 *     reflects browser-level state, not the OS's. Result is cached at
 *     module scope so we don't re-probe (and re-flash the OS recording
 *     indicator) on every cell switch.
 *   - Runtime reports from the recorder via `reportRecorderError(err)` —
 *     a complementary path: the user clicked record and `getUserMedia`
 *     threw. Updates the cache so the rest of the session reflects the
 *     newly-discovered state.
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
    /**
     * Silently probe whether mic access actually works by calling
     * `getUserMedia({ audio: true })` and immediately stopping the
     * resulting tracks. Updates `availability` based on the outcome. The
     * result is cached at module scope so repeated calls within the same
     * webview session are no-ops (returns the cached state). This is the
     * recommended fix for the macOS / Windows OS-level permission gap:
     * call it when the user opens the audio recording UI so the button
     * disables before they click.
     *
     * Side effect to be aware of: triggers the OS permission prompt on
     * first ever call for a user who has never been asked, and briefly
     * flashes the OS recording indicator. Cache prevents repetition.
     *
     * Pass `{ force: true }` to bypass the cache for an authoritative
     * re-check (e.g. right before starting a recording, in case the
     * permission was toggled mid-session). Resolves to the resulting
     * `MicAvailability` so callers can branch without reading state.
     */
    probeMicAccess: (opts?: { force?: boolean }) => Promise<MicAvailability>;
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

// ─────────────────────────────────────────────────────────────────────────
// Module-level probe cache.
//
// Shared across all hook instances in the webview so opening multiple cells
// during a session doesn't trigger a probe (and the recording-indicator
// flash) on every cell switch. Lifetime = webview lifetime, which is
// typically one work session.
//
// Invalidated by:
//   - `devicechange` events (hardware presence may have changed)
//   - window focus regain (the user may have changed OS permissions while away)
//   - permission `change` events that transition to granted/prompt
//   - `reportRecorderError` calls (recorder learned real state from
//     a record-button click)
// ─────────────────────────────────────────────────────────────────────────
let probeCache: MicAvailability | null = null;
let inflightProbe: Promise<MicAvailability> | null = null;

/** Test-only: reset module state between cases. Not part of public API. */
export function __resetProbeCacheForTesting(): void {
    probeCache = null;
    inflightProbe = null;
}

async function performProbe(): Promise<MicAvailability> {
    if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
    ) {
        // No API to probe with — fall back to optimistic so we never disable
        // recording on a working machine just because we couldn't check.
        return "available";
    }
    try {
        // Minimal constraints: this is a permission probe, not a recording.
        // Less to negotiate = less time the mic indicator flashes.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop tracks in the same microtask as the resolution to release
        // the mic immediately. OS recording indicator turns off as soon as
        // the last track on a stream transitions to "ended".
        stream.getTracks().forEach((t) => t.stop());
        return "available";
    } catch (err) {
        return classifyRecorderError(err) ?? "available";
    }
}

async function getOrRunProbe(force = false): Promise<MicAvailability> {
    // `force` bypasses the cached verdict for an authoritative re-check (e.g.
    // the user clicked record and a permission may have been toggled mid-
    // session). An in-flight probe is still shared — it hasn't resolved yet,
    // so its result is already fresh.
    if (!force && probeCache !== null) return probeCache;
    if (inflightProbe) return inflightProbe;
    inflightProbe = performProbe();
    try {
        const result = await inflightProbe;
        probeCache = result;
        return result;
    } finally {
        inflightProbe = null;
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
    // Pinned state set by either the explicit probe or by a real
    // `getUserMedia` failure reported by the recorder. Passive signals
    // (`devicechange`, permission `change`) won't override it, because on
    // macOS / Windows those signals are unreliable for OS-level mic blocks.
    // Initial value reads from the module cache so a freshly-mounted hook
    // instance (e.g. opening a new cell) inherits whatever the last cell
    // discovered, with no re-probe required.
    const [runtimeOverride, setRuntimeOverride] = useState<MicAvailability | null>(
        () => (probeCache !== null && probeCache !== "available" ? probeCache : null)
    );

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

        const handleDeviceChange = () => {
            // Hardware changed — the cached probe is no longer trustworthy.
            // The next time the user opens the audio tab, we'll re-probe.
            probeCache = null;
            evaluate();
        };
        mediaDevices.addEventListener("devicechange", handleDeviceChange);

        // ─── Flash-free refresh on window focus ───────────────────────────
        // A mic permission can only change while the user is *away* from the
        // editor (OS settings / a portal dialog), so regaining focus is the
        // cheapest moment to refresh and "prepare the message" before the
        // record tab is opened. We run ONLY the passive check here (no
        // getUserMedia), so there is never an OS recording-indicator flash.
        // We also invalidate the probe cache so the next audio-tab open does
        // a fresh authoritative probe (which catches macOS OS-level denial).
        let lastFocusRefreshAt = 0;
        const FOCUS_REFRESH_COOLDOWN_MS = 1500;
        const onRegainFocus = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                return;
            }
            const now = Date.now();
            if (now - lastFocusRefreshAt < FOCUS_REFRESH_COOLDOWN_MS) return;
            lastFocusRefreshAt = now;
            probeCache = null;
            evaluate();
        };
        if (typeof window !== "undefined") {
            window.addEventListener("focus", onRegainFocus);
        }
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onRegainFocus);
        }

        let unsubscribePermission: (() => void) | null = null;
        subscribeToMicPermission((state) => {
            // A real permission transition to granted/prompt is a reliable
            // signal that an earlier denial no longer holds, so clear a stale
            // runtime pin and re-probe fresh. On macOS OS-level changes this
            // `change` event typically does NOT fire, so the pin correctly
            // persists until the app is restarted (TCC pins the verdict to
            // the process). We deliberately do NOT clear the pin from the
            // passive `evaluate()` "available" path, because Chromium can
            // misreport macOS OS-level denial as granted.
            if (state === "granted" || state === "prompt") {
                probeCache = null;
                setRuntimeOverride((prev) =>
                    prev === "permission-denied" ? null : prev
                );
            }
            evaluate();
        }).then((unsub) => {
            if (cancelled) {
                unsub?.();
                return;
            }
            unsubscribePermission = unsub;
        });

        return () => {
            cancelled = true;
            mediaDevices.removeEventListener("devicechange", handleDeviceChange);
            if (typeof window !== "undefined") {
                window.removeEventListener("focus", onRegainFocus);
            }
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", onRegainFocus);
            }
            unsubscribePermission?.();
        };
    }, [isSupported]);

    const reportRecorderError = useCallback((err: unknown | null) => {
        if (err === null) {
            // Successful getUserMedia is ground truth that the mic works.
            // Update the cache so other hook instances learn the good news
            // on next render, clear the local pin, AND force the passive
            // layer to "available". Without the last step a stale passive
            // `permission-denied` (e.g. Chromium's Permissions API still
            // reporting denied after the user re-enabled) would keep the UI
            // blocked even though we just recorded successfully.
            probeCache = "available";
            setRuntimeOverride(null);
            setAvailability("available");
            return;
        }
        const classified = classifyRecorderError(err);
        if (classified) {
            probeCache = classified;
            setRuntimeOverride(classified);
        }
    }, []);

    const probeMicAccess = useCallback(
        async (opts?: { force?: boolean }): Promise<MicAvailability> => {
            const result = await getOrRunProbe(opts?.force ?? false);
            if (result === "available") {
                // A successful `getUserMedia` is authoritative: mic access works
                // right now. Clear the runtime pin AND force the passive layer to
                // "available" so a stale `permission-denied`/`no-device` from an
                // earlier `enumerateDevices`/permission read can't keep the UI
                // blocked after a focus-regain recovery (see focus effect below).
                setRuntimeOverride(null);
                setAvailability("available");
                return result;
            }
            // Any non-available result pins so the UI accurately reflects the block.
            setRuntimeOverride(result);
            return result;
        },
        []
    );

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
        probeMicAccess,
    };
}
