import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAudioInputDevices } from "../hooks/useAudioInputDevices";

/**
 * Tests for the microphone availability hook used by the audio recorder.
 *
 * Backed by real EventTargets so `devicechange` and PermissionStatus
 * `change` events can be exercised via genuine `dispatchEvent` calls —
 * the same path the browser uses on hot-plug or permission change.
 */

type FakeMediaDevices = EventTarget & {
    enumerateDevices: ReturnType<typeof vi.fn>;
};

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
});
