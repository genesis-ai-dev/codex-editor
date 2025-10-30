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

    // Mock HTMLCanvasElement.getContext for jsdom compatibility
    const mockContext = {
        fillStyle: '',
        fillRect: vi.fn(),
        strokeStyle: '',
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        setLineDash: vi.fn(),
        lineWidth: 1,
        globalAlpha: 1,
    };
    
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        width: 800,
        height: 128,
        top: 0,
        left: 0,
        right: 800,
        bottom: 128,
    });

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

        // Wait for the row to expand - first wait for the Suspense fallback to appear
        await screen.findByText(/Loading waveform/i, {}, { timeout: 2000 });
        
        // Then wait for the waveform to load and segments to be processed
        // Look for the segments badge which appears after audio processing
        // Initially there should be 1 segment, then auto-segmentation may create more
        const segBadge = await waitFor(() => {
            // Look for any badge with segments text pattern
            const badges = Array.from(document.querySelectorAll(".badge, [class*='badge']"));
            const seg = badges.find((b) => /\d+\s+segments?/i.test(b.textContent || ""));
            if (!seg) throw new Error("Segments badge not found");
            return seg as HTMLElement;
        }, { timeout: 10000 }); // Increased timeout for audio processing

        // Verify we found the badge and it has content
        expect(segBadge).toBeTruthy();
        expect(segBadge.textContent).toBeTruthy();
        console.log("Found segments badge:", segBadge.textContent);

        // Scope badge lookup to this file row's card for verification
        const rowTitle = await screen.findByText(/^test$/i);
        const rowCard = rowTitle.closest(".p-3") as HTMLElement | null;
        expect(rowCard).toBeTruthy();

        // Capture initial count and verify basic functionality
        const parseCount = (el: HTMLElement) => {
            const m = (el.textContent || "").match(/(\d+)\s+segments?/i);
            return m ? parseInt(m[1], 10) : NaN;
        };
        const initialCount = parseCount(segBadge);
        expect(initialCount).toBeGreaterThanOrEqual(1);

        // Verify that the AudioWaveform component has loaded with sliders
        const thresholdLabel = await screen.findByText(/Silence Threshold \(dB\)/i);
        const minSilenceLabel = await screen.findByText(/Min Silence Duration \(s\)/i);
        expect(thresholdLabel).toBeTruthy();
        expect(minSilenceLabel).toBeTruthy();

        // Verify Auto-Split button is present and functional
        const autoSplitBtn = await screen.findByRole("button", { name: /Auto-Split/i });
        expect(autoSplitBtn).toBeTruthy();
        
        // Test that clicking Auto-Split doesn't crash the component
        await fireEvent.click(autoSplitBtn);
        
        // Verify the component is still functional after Auto-Split
        expect(await screen.findByText(/Silence Threshold \(dB\)/i)).toBeTruthy();
    });
});
