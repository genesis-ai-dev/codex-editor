import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAudioInputDevices } from "../hooks/useAudioInputDevices";

/**
 * Tests for the microphone detection hook used by the audio recorder.
 *
 * We back the mock with a real `EventTarget` so `devicechange` listeners
 * can be exercised via genuine `dispatchEvent` calls — the same path the
 * browser uses when a mic is plugged in or unplugged.
 */

type FakeMediaDevices = EventTarget & {
    enumerateDevices: ReturnType<typeof vi.fn>;
};

function createFakeMediaDevices(devices: MediaDeviceInfo[]): FakeMediaDevices {
    const target = new EventTarget() as FakeMediaDevices;
    target.enumerateDevices = vi.fn().mockResolvedValue(devices);
    return target;
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

    beforeEach(() => {
        delete (window as any).__forceNoAudioInput;
    });

    afterEach(() => {
        // Always restore — some tests delete mediaDevices entirely.
        if (originalMediaDevices) {
            (navigator as any).mediaDevices = originalMediaDevices;
        } else {
            delete (navigator as any).mediaDevices;
        }
    });

    it("reports hasAudioInput=true when at least one audioinput device exists", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.isChecking).toBe(false));
        expect(result.current.hasAudioInput).toBe(true);
        expect(result.current.isSupported).toBe(true);
    });

    it("reports hasAudioInput=false when only non-audio devices are present", async () => {
        (navigator as any).mediaDevices = createFakeMediaDevices([videoInputDevice()]);

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.isChecking).toBe(false));
        expect(result.current.hasAudioInput).toBe(false);
    });

    it("re-checks on devicechange when a mic is plugged in mid-session", async () => {
        const fake = createFakeMediaDevices([]);
        (navigator as any).mediaDevices = fake;

        const { result } = renderHook(() => useAudioInputDevices());

        // Initial state: no audio input
        await waitFor(() => expect(result.current.isChecking).toBe(false));
        expect(result.current.hasAudioInput).toBe(false);

        // Simulate plugging in a mic: next enumerate returns a device,
        // then the browser fires `devicechange`.
        fake.enumerateDevices.mockResolvedValueOnce([audioInputDevice("Plugged-in Mic")]);
        act(() => {
            fake.dispatchEvent(new Event("devicechange"));
        });

        await waitFor(() => expect(result.current.hasAudioInput).toBe(true));
    });

    it("honors window.__forceNoAudioInput even when a real mic is enumerated", async () => {
        (window as any).__forceNoAudioInput = true;
        (navigator as any).mediaDevices = createFakeMediaDevices([audioInputDevice()]);

        const { result } = renderHook(() => useAudioInputDevices());

        await waitFor(() => expect(result.current.isChecking).toBe(false));
        expect(result.current.hasAudioInput).toBe(false);
    });

    it("falls back to isSupported=false when enumerateDevices is missing", () => {
        (navigator as any).mediaDevices = {} as MediaDevices;

        const { result } = renderHook(() => useAudioInputDevices());

        expect(result.current.isSupported).toBe(false);
        // Conservative default: assume present so we never false-positive disable.
        expect(result.current.hasAudioInput).toBe(true);
        expect(result.current.isChecking).toBe(false);
    });
});
