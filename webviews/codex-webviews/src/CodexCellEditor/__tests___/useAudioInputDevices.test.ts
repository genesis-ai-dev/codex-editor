import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
    useAudioInputDevices,
    __resetProbeCacheForTesting,
} from "../hooks/useAudioInputDevices";

/**
 * Tests for the microphone availability hook used by the audio recorder.
 *
 * Backed by real EventTargets so `devicechange` and PermissionStatus
 * `change` events can be exercised via genuine `dispatchEvent` calls —
 * the same path the browser uses on hot-plug or permission change.
 */

type FakeMediaDevices = EventTarget & {
    enumerateDevices: ReturnType<typeof vi.fn>;
    getUserMedia?: ReturnType<typeof vi.fn>;
};

/** Make a fake MediaStream whose tracks can be stopped. */
function fakeStream(): MediaStream {
    const trackStops: Array<() => void> = [];
    const tracks: MediaStreamTrack[] = [
        { stop: () => trackStops.forEach((s) => s()) } as MediaStreamTrack,
    ];
    return { getTracks: () => tracks } as MediaStream;
}

type FakePermissionStatus = EventTarget & { state: "granted" | "denied" | "prompt" };
type FakePermissions = {
    query: ReturnType<typeof vi.fn>;
};

function createFakeMediaDevices(devices: MediaDeviceInfo[]): FakeMediaDevices {
    const target = new EventTarget() as FakeMediaDevices;
    target.enumerateDevices = vi.fn().mockResolvedValue(devices);
    return target;
}

function createFakePermissionStatus(
    state: "granted" | "denied" | "prompt"
): FakePermissionStatus {
    const status = new EventTarget() as FakePermissionStatus;
    status.state = state;
    return status;
}

function createFakePermissions(status: FakePermissionStatus | null): FakePermissions {
    return {
        query: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
            if (name !== "microphone") {
                throw new Error(`unsupported permission name: ${name}`);
            }
            if (!status) {
                throw new Error("permission query not supported");
            }
            return status;
        }),
    };
}

function audioInputDevice(label = "Mock Mic"): MediaDeviceInfo {
    return {
        deviceId: `mock-${label}`,
        groupId: "group-1",
        kind: "audioinput",
        label,
        toJSON: () => ({}),
    } as MediaDeviceInfo;
}

function videoInputDevice(): MediaDeviceInfo {
    return {
        deviceId: "mock-cam",
        groupId: "group-2",
        kind: "videoinput",
        label: "Mock Cam",
        toJSON: () => ({}),
    } as MediaDeviceInfo;
}

describe("useAudioInputDevices", () => {
    const originalMediaDevices = (navigator as any).mediaDevices;
    const originalPermissions = (navigator as any).permissions;

    beforeEach(() => {
        // The probe cache is module-scoped and persists across renders. Tests
        // must start clean or earlier tests' cached values leak in and create
        // confusing failures.
        __resetProbeCacheForTesting();
    });

    afterEach(() => {
        if (originalMediaDevices) {
            (navigator as any).mediaDevices = originalMediaDevices;
        } else {
            delete (navigator as any).mediaDevices;
        }
        if (originalPermissions) {
            (navigator as any).permissions = originalPermissions;
        } else {
            delete (navigator as any).permissions;
        }
    });

    it("reports availability=available when a mic exists and permission is granted", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
        (navigator as any).permissions = createFakePermissions(
            createFakePermissionStatus("granted")
        );

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.availability).toBe("available"));
        expect(result.current.micUnavailable).toBe(false);
        expect(result.current.noMicDetected).toBe(false);
        expect(result.current.micPermissionDenied).toBe(false);
    });

    it("reports no-device when only non-audio devices are present", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([videoInputDevice()]);
        (navigator as any).permissions = createFakePermissions(
            createFakePermissionStatus("granted")
        );

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.availability).toBe("no-device"));
        expect(result.current.noMicDetected).toBe(true);
        expect(result.current.micPermissionDenied).toBe(false);
        expect(result.current.micUnavailable).toBe(true);
    });

    it("reports permission-denied even when a mic IS enumerated", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
        (navigator as any).permissions = createFakePermissions(
            createFakePermissionStatus("denied")
        );

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() =>
            expect(result.current.availability).toBe("permission-denied")
        );
        expect(result.current.micPermissionDenied).toBe(true);
        expect(result.current.noMicDetected).toBe(false);
        expect(result.current.micUnavailable).toBe(true);
    });

    it("re-evaluates on devicechange when a mic is plugged in mid-session", async () => {
        const fake = createFakeMediaDevices([]);
        (navigator as any).mediaDevices = fake;
        (navigator as any).permissions = createFakePermissions(
            createFakePermissionStatus("granted")
        );

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.availability).toBe("no-device"));

        fake.enumerateDevices.mockResolvedValueOnce([audioInputDevice("Plugged-in Mic")]);
        act(() => {
            fake.dispatchEvent(new Event("devicechange"));
        });

        await waitFor(() => expect(result.current.availability).toBe("available"));
    });

    it("re-evaluates when microphone permission changes mid-session", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
        const status = createFakePermissionStatus("granted");
        (navigator as any).permissions = createFakePermissions(status);

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.availability).toBe("available"));

        // User revokes mic access via system settings.
        status.state = "denied";
        act(() => {
            status.dispatchEvent(new Event("change"));
        });

        await waitFor(() =>
            expect(result.current.availability).toBe("permission-denied")
        );
    });

    it("falls back to unsupported when enumerateDevices is missing", () => {
        (navigator as any).mediaDevices = {} as MediaDevices;

        const { result } = renderHook(() => useAudioInputDevices());

        expect(result.current.availability).toBe("unsupported");
        // Treated as "assume available" so we never false-positive disable.
        expect(result.current.micUnavailable).toBe(false);
    });

    it("treats missing permissions API as 'assume granted' (no false denial)", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
        // No `navigator.permissions` at all.
        delete (navigator as any).permissions;

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.availability).toBe("available"));
        expect(result.current.micPermissionDenied).toBe(false);
    });

    describe("reportRecorderError (runtime override)", () => {
        it("flips to permission-denied on NotAllowedError even when Permissions API reports granted", async () => {
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            // This is the macOS "denied at OS level" case: passive APIs
            // report granted, but getUserMedia throws.
            const err = Object.assign(new Error("denied"), {
                name: "NotAllowedError",
            });
            act(() => {
                result.current.reportRecorderError(err);
            });

            expect(result.current.availability).toBe("permission-denied");
            expect(result.current.micPermissionDenied).toBe(true);
        });

        it("flips to no-device on NotFoundError even when enumeration reported a device", async () => {
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            const err = Object.assign(new Error("missing"), { name: "NotFoundError" });
            act(() => {
                result.current.reportRecorderError(err);
            });

            expect(result.current.availability).toBe("no-device");
        });

        it("clears the runtime override when called with null (e.g. after a successful retry)", async () => {
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            act(() => {
                result.current.reportRecorderError(
                    Object.assign(new Error(), { name: "NotAllowedError" })
                );
            });
            expect(result.current.availability).toBe("permission-denied");

            act(() => {
                result.current.reportRecorderError(null);
            });
            expect(result.current.availability).toBe("available");
        });

        it("ignores unrecognized error names so transient failures don't disable recording", async () => {
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            act(() => {
                result.current.reportRecorderError(
                    Object.assign(new Error("weird"), { name: "AbortError" })
                );
            });

            expect(result.current.availability).toBe("available");
        });

        it("runtime override outranks the passive Permissions API state", async () => {
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            // Passive layer says granted...
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            // ...but runtime got denied. Runtime wins.
            act(() => {
                result.current.reportRecorderError(
                    Object.assign(new Error(), { name: "NotAllowedError" })
                );
            });
            expect(result.current.availability).toBe("permission-denied");
        });
    });

    describe("probeMicAccess (silent getUserMedia probe)", () => {
        it("flips to permission-denied when probe getUserMedia throws NotAllowedError, even though Permissions API says granted", async () => {
            // This is the central reviewer-reported case: macOS OS-level mic
            // denial is invisible to enumerateDevices and Permissions API.
            // The probe catches it by attempting a real getUserMedia call.
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi
                .fn()
                .mockRejectedValue(
                    Object.assign(new Error("denied"), { name: "NotAllowedError" })
                );
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });

            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
            expect(result.current.availability).toBe("permission-denied");
            expect(result.current.micPermissionDenied).toBe(true);
        });

        it("flips to no-device when probe throws NotFoundError", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            fake.getUserMedia = vi.fn().mockRejectedValue(
                Object.assign(new Error("gone"), { name: "NotFoundError" })
            );
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });

            expect(result.current.availability).toBe("no-device");
        });

        it("stops the returned stream's tracks immediately after a successful probe", async () => {
            const stopSpy = vi.fn();
            const fake = createFakeMediaDevices([audioInputDevice()]);
            fake.getUserMedia = vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: stopSpy } as MediaStreamTrack],
            } as MediaStream);
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });

            expect(stopSpy).toHaveBeenCalled();
        });

        it("caches the probe result so repeated calls don't re-trigger getUserMedia", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
                await result.current.probeMicAccess();
                await result.current.probeMicAccess();
            });

            // Only the FIRST call actually probed; rest were cache hits.
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
        });

        it("dedupes concurrent probe calls into a single getUserMedia invocation", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            // Resolve on a microtask delay so concurrent probes race.
            const getUserMediaSpy = vi.fn().mockImplementation(
                () =>
                    new Promise<MediaStream>((resolve) =>
                        setTimeout(() => resolve(fakeStream()), 10)
                    )
            );
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await Promise.all([
                    result.current.probeMicAccess(),
                    result.current.probeMicAccess(),
                    result.current.probeMicAccess(),
                ]);
            });

            // All three calls awaited the single in-flight probe.
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
        });

        it("re-probes after a devicechange event invalidates the cache", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

            // Simulate a device hot-plug — cache should be invalidated.
            act(() => {
                fake.dispatchEvent(new Event("devicechange"));
            });

            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(2);
        });

        it("preserves availability when probe getUserMedia is unavailable", async () => {
            // No getUserMedia attached at all — probe should no-op silently.
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });

            expect(result.current.availability).toBe("available");
        });

        it("freshly-mounted hook inherits cached probe state from a prior mount", async () => {
            // First mount: probe gets NotAllowedError, caches "permission-denied".
            const fake = createFakeMediaDevices([audioInputDevice()]);
            fake.getUserMedia = vi.fn().mockRejectedValue(
                Object.assign(new Error(), { name: "NotAllowedError" })
            );
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const first = renderHook(() => useAudioInputDevices());
            await waitFor(() =>
                expect(first.result.current.availability).toBe("available")
            );
            await act(async () => {
                await first.result.current.probeMicAccess();
            });
            expect(first.result.current.availability).toBe("permission-denied");
            first.unmount();

            // Second mount (simulating opening a different cell): no extra
            // probe should be needed; cached state pins immediately.
            const second = renderHook(() => useAudioInputDevices());
            expect(second.result.current.availability).toBe("permission-denied");
            expect(second.result.current.micPermissionDenied).toBe(true);
        });

        it("force re-runs getUserMedia even when a verdict is already cached", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

            // A normal call is a cache hit (no extra probe)...
            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

            // ...but `force` bypasses the cache and returns the fresh verdict.
            let forced: string | undefined;
            await act(async () => {
                forced = await result.current.probeMicAccess({ force: true });
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(2);
            expect(forced).toBe("available");
        });

        it("force re-probe flips to permission-denied when access was revoked since the cached verdict", async () => {
            // The pre-record-countdown case: passive/cached state still says
            // available (no event fired), but the user revoked access in OS
            // settings. A forced probe must catch it before the countdown.
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(result.current.availability).toBe("available");

            getUserMediaSpy.mockRejectedValue(
                Object.assign(new Error("revoked"), { name: "NotAllowedError" })
            );

            let forced: string | undefined;
            await act(async () => {
                forced = await result.current.probeMicAccess({ force: true });
            });
            expect(forced).toBe("permission-denied");
            expect(result.current.availability).toBe("permission-denied");
        });
    });

    describe("refresh on window focus", () => {
        // A mic permission can only change while the user is away from the
        // window, so regaining focus is the moment to refresh. When the recorder
        // UI is on screen (`active`) we run an authoritative probe that updates
        // state in BOTH directions (allowed↔denied). When inactive we only
        // invalidate the cache (no probe, no OS indicator flash).
        it("re-probes on focus while active and recovers when permission is re-granted (denied→allowed)", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            const status = createFakePermissionStatus("denied");
            (navigator as any).permissions = createFakePermissions(status);
            // Mount detects denial passively (Permissions API). getUserMedia is
            // only hit by the focus probe, which now succeeds (re-enabled).
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;

            const { result } = renderHook(() => useAudioInputDevices({ active: true }));
            await waitFor(() =>
                expect(result.current.availability).toBe("permission-denied")
            );

            status.state = "granted";
            await act(async () => {
                window.dispatchEvent(new Event("focus"));
            });

            await waitFor(() => expect(result.current.availability).toBe("available"));
            expect(getUserMediaSpy).toHaveBeenCalled();
            expect(result.current.micUnavailable).toBe(false);
        });

        it("re-probes on focus while active and detects a revocation (allowed→denied)", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );
            // Mount sees granted (passive). The OS-level access was revoked while
            // away, so the authoritative focus probe rejects.
            const getUserMediaSpy = vi.fn().mockRejectedValue(
                Object.assign(new Error("revoked"), { name: "NotAllowedError" })
            );
            fake.getUserMedia = getUserMediaSpy;

            const { result } = renderHook(() => useAudioInputDevices({ active: true }));
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                window.dispatchEvent(new Event("focus"));
            });

            await waitFor(() =>
                expect(result.current.availability).toBe("permission-denied")
            );
            expect(getUserMediaSpy).toHaveBeenCalled();
        });

        it("does NOT probe on focus when inactive — just invalidates the cache (no flash)", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );

            // No `active` flag → the recorder UI isn't on screen.
            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            // First probe caches "available".
            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

            // Inactive focus must not probe (no flash) — only invalidate cache.
            await act(async () => {
                window.dispatchEvent(new Event("focus"));
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

            // Because focus nulled the cache, the next probe re-runs fresh.
            await act(async () => {
                await result.current.probeMicAccess();
            });
            expect(getUserMediaSpy).toHaveBeenCalledTimes(2);
        });

        it("recovers on a host-relayed windowFocusChanged message (VS Code webview path)", async () => {
            // Webview iframes don't get native focus events on OS app-switch, so
            // the extension host relays `vscode.window.onDidChangeWindowState` as
            // a `windowFocusChanged` message. It must drive the same authoritative
            // re-probe as a native focus event.
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            const status = createFakePermissionStatus("denied");
            (navigator as any).permissions = createFakePermissions(status);
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;

            const { result } = renderHook(() => useAudioInputDevices({ active: true }));
            await waitFor(() =>
                expect(result.current.availability).toBe("permission-denied")
            );

            status.state = "granted";
            await act(async () => {
                window.dispatchEvent(
                    new MessageEvent("message", {
                        data: { type: "windowFocusChanged", focused: true },
                    })
                );
            });

            await waitFor(() => expect(result.current.availability).toBe("available"));
            expect(getUserMediaSpy).toHaveBeenCalled();
        });

        it("ignores a windowFocusChanged message with focused=false", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("granted")
            );
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;

            const { result } = renderHook(() => useAudioInputDevices({ active: true }));
            await waitFor(() => expect(result.current.availability).toBe("available"));

            await act(async () => {
                window.dispatchEvent(
                    new MessageEvent("message", {
                        data: { type: "windowFocusChanged", focused: false },
                    })
                );
            });

            // A blur (focused=false) must not trigger a re-probe.
            expect(getUserMediaSpy).not.toHaveBeenCalled();
        });

        it("debounces rapid focus events into a single authoritative probe", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("denied")
            );
            const getUserMediaSpy = vi.fn().mockResolvedValue(fakeStream());
            fake.getUserMedia = getUserMediaSpy;

            const { result } = renderHook(() => useAudioInputDevices({ active: true }));
            await waitFor(() =>
                expect(result.current.availability).toBe("permission-denied")
            );

            // Two focus events inside the cooldown window collapse to one probe.
            await act(async () => {
                window.dispatchEvent(new Event("focus"));
                window.dispatchEvent(new Event("focus"));
            });

            await waitFor(() => expect(result.current.availability).toBe("available"));
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("recovery from a lingering denied state", () => {
        it("reportRecorderError(null) recovers availability to available from a passively-denied state", async () => {
            // The passive layer is stuck reporting denied (e.g. Chromium's
            // Permissions API still says denied right after the user re-enabled
            // the mic). A successful record is ground truth and must clear it.
            (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).permissions = createFakePermissions(
                createFakePermissionStatus("denied")
            );

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() =>
                expect(result.current.availability).toBe("permission-denied")
            );

            act(() => {
                result.current.reportRecorderError(null);
            });

            expect(result.current.availability).toBe("available");
            expect(result.current.micUnavailable).toBe(false);
        });

        it("clears a denied runtime-override pin when permission transitions to granted", async () => {
            const fake = createFakeMediaDevices([audioInputDevice()]);
            (navigator as any).mediaDevices = fake;
            const status = createFakePermissionStatus("granted");
            (navigator as any).permissions = createFakePermissions(status);

            const { result } = renderHook(() => useAudioInputDevices());
            await waitFor(() => expect(result.current.availability).toBe("available"));

            // A real getUserMedia failure pins denied (outranks passive granted).
            act(() => {
                result.current.reportRecorderError(
                    Object.assign(new Error(), { name: "NotAllowedError" })
                );
            });
            expect(result.current.availability).toBe("permission-denied");

            // A genuine permission `change` to granted is a reliable signal the
            // earlier denial no longer holds, so the pin must clear.
            status.state = "granted";
            act(() => {
                status.dispatchEvent(new Event("change"));
            });

            await waitFor(() => expect(result.current.availability).toBe("available"));
            expect(result.current.micPermissionDenied).toBe(false);
        });
    });
});
