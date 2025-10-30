import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import AudioImporterForm from "../AudioImporterForm";

// Mock the VSCode API similar to other integration tests
const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};

Object.defineProperty(window as any, "vscodeApi", {
    value: mockVscode,
    writable: true,
});
(globalThis as any).acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// Shim canvas and DOM APIs used by components
beforeAll(() => {
    if (!(HTMLCanvasElement.prototype as any).getContext) {
        // @ts-expect-error test shim
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
    }
    (Element.prototype as any).scrollIntoView =
        (Element.prototype as any).scrollIntoView || vi.fn();
});

// Helper to build a synthetic AudioBuffer-like object with controllable channel data
function buildFakeAudioBuffer(): any {
    const sampleRate = 48000; // 48 kHz
    const durationSec = 2.0; // 2 seconds
    const length = Math.floor(sampleRate * durationSec);
    const data = new Float32Array(length);

    // Pattern: 0.0-0.4s loud, 0.4-1.1s silence (0.7s), 1.1-1.5s loud, 1.5-2.0s silence (0.5s)
    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const loud = (t >= 0 && t < 0.4) || (t >= 1.1 && t < 1.5);
        data[i] = loud ? 0.3 : 0.0; // RMS ~0.3 in loud, ~0 in silence
    }

    return {
        numberOfChannels: 1,
        sampleRate,
        length,
        duration: durationSec,
        getChannelData: (_channel: number) => data,
    };
}

// Mock Web Audio API used by waveform/segmenter
beforeEach(() => {
    vi.clearAllMocks();

    // Ensure File#arrayBuffer exists in jsdom
    if (!(File.prototype as any).arrayBuffer) {
        (File.prototype as any).arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    } else {
        (File.prototype as any).arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    }

    (window as any).AudioContext = class {
        decodeAudioData(_buf: ArrayBuffer) {
            return Promise.resolve(buildFakeAudioBuffer());
        }
        close() {}
    } as any;
});

describe("AudioImporterForm sliders integration", () => {
    it("segments audio and responds to slider changes + Auto-Split", async () => {
        const onComplete = vi.fn();

        const { container } = render(
            <AudioImporterForm
                onComplete={onComplete}
                onCancel={() => {}}
                onCancelImport={() => {}}
                wizardContext={{}}
                as
                any
            />
        );

        // Select an audio file via hidden input
        const fileInput = await screen.findByLabelText(/Select Audio Files/i);
        // The label wraps a button; find the associated hidden input by id
        const hiddenInput = container.querySelector("#media-file-input") as HTMLInputElement;
        expect(hiddenInput).toBeTruthy();

        const file = new File([new Uint8Array([1, 2, 3])], "test.wav", { type: "audio/wav" });
        await fireEvent.change(hiddenInput!, { target: { files: [file] } });

        // Ensure row is present and click global Auto Segment to expand & trigger detection
        const autoSegmentBtn = await screen.findByRole("button", { name: /Auto Segment/i });
        await fireEvent.click(autoSegmentBtn);

        // Wait for initial segmentation badge to show more than 1 segment
        // Allow Auto Segment flow to expand and process (uses setTimeout ~1000ms)
        await new Promise((r) => setTimeout(r, 1700));

        // Scope badge lookup to this file row's card
        const rowTitle = await screen.findByText(/^test$/i);
        const rowCard = rowTitle.closest(".p-3") as HTMLElement | null;
        expect(rowCard).toBeTruthy();

        const segBadge = await waitFor(async () => {
            const badges = Array.from(
                (rowCard as HTMLElement).querySelectorAll(".badge, [class*='badge']")
            );
            // Choose a badge that looks like "NN segments"
            const seg = badges.find((b) => /^(\s*)?\d+\s+segments?/i.test(b.textContent || ""));
            expect(seg).toBeTruthy();
            return seg as HTMLElement;
        });

        // Capture initial count
        const parseCount = (el: HTMLElement) => {
            const m = (el.textContent || "").match(/(\d+)\s+segments?/i);
            return m ? parseInt(m[1], 10) : NaN;
        };
        const initialCount = parseCount(segBadge as HTMLElement);
        expect(initialCount).toBeGreaterThanOrEqual(1);

        // Find the sliders by their labels inside the expanded waveform card
        const thresholdLabel = await screen.findByText(/Silence Threshold \(dB\)/i);
        const minSilenceLabel = await screen.findByText(/Min Silence Duration \(s\)/i);

        // Try to find slider handles via role=slider near labels
        const thresholdSlider = thresholdLabel.parentElement?.querySelector(
            '[role="slider"]'
        ) as HTMLElement | null;
        const minSilenceSlider = minSilenceLabel.parentElement?.querySelector(
            '[role="slider"]'
        ) as HTMLElement | null;

        // If role=slider is not present (implementation detail), fall back to clicking Auto-Split after stateful events
        // Increase Min Silence Duration substantially (simulate ArrowRight presses)
        if (minSilenceSlider) {
            minSilenceSlider.focus();
            // Raise from 0.5s towards 1.0s to suppress shorter silence segments
            for (let i = 0; i < 6; i++) fireEvent.keyDown(minSilenceSlider, { key: "ArrowRight" });
        }

        // Click the Auto-Split button inside the waveform controls
        const autoSplitBtn = await screen.findByRole("button", { name: /Auto-Split/i });
        await fireEvent.click(autoSplitBtn);

        // Expect segment count to decrease or remain valid
        const afterMinBadge = Array.from(
            (rowCard as HTMLElement).querySelectorAll(".badge, [class*='badge']")
        ).find((b) => /^(\s*)?\d+\s+segments?/i.test(b.textContent || "")) as HTMLElement;
        const afterMinCount = parseCount(afterMinBadge);
        expect(afterMinCount).toBeLessThanOrEqual(initialCount);

        // Increase sensitivity by raising threshold towards -20 dB (more likely to detect silence windows)
        if (thresholdSlider) {
            thresholdSlider.focus();
            for (let i = 0; i < 20; i++) fireEvent.keyDown(thresholdSlider, { key: "ArrowRight" });
        }
        await fireEvent.click(autoSplitBtn);

        // Expect segment count to be >= previous count (more splits possible)
        const afterThreshBadge = Array.from(
            (rowCard as HTMLElement).querySelectorAll(".badge, [class*='badge']")
        ).find((b) => /^(\s*)?\d+\s+segments?/i.test(b.textContent || "")) as HTMLElement;
        const afterThreshCount = parseCount(afterThreshBadge);
        expect(afterThreshCount).toBeGreaterThanOrEqual(afterMinCount);
    });
});
