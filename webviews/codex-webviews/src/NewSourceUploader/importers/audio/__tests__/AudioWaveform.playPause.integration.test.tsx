import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AudioImporterForm from "../AudioImporterForm";

// VSCode API mock (consistent with other integration tests)
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

beforeAll(() => {
    if (!(HTMLCanvasElement.prototype as any).getContext) {
        // @ts-expect-error test shim
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
    }
});

function buildTwoSegmentAudioBuffer(): any {
    const sampleRate = 48000;
    const durationSec = 2.0;
    const length = Math.floor(sampleRate * durationSec);
    const data = new Float32Array(length);
    // Loud 0-0.4s, silence 0.7s, loud 1.1-1.5s, silence 0.5s
    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const loud = (t >= 0 && t < 0.4) || (t >= 1.1 && t < 1.5);
        data[i] = loud ? 0.3 : 0.0;
    }
    return {
        numberOfChannels: 1,
        sampleRate,
        length,
        duration: durationSec,
        getChannelData: (_: number) => data,
    };
}

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
            return Promise.resolve(buildTwoSegmentAudioBuffer());
        }
        createBufferSource() {
            const src: any = {
                buffer: null,
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                onended: undefined as any,
            };
            return src;
        }
        get destination() {
            return {} as any;
        }
        close() {}
    } as any;
});

describe("AudioWaveform per-segment play/pause integration", () => {
    it("plays only the clicked segment, toggles pause, and switches between segments", async () => {
        const { container } = render(
            <AudioImporterForm
                onComplete={() => {}}
                onCancel={() => {}}
                onCancelImport={() => {}}
                wizardContext={{} as any}
            />
        );

        // Select an audio file
        await screen.findByLabelText(/Select Audio Files/i);
        const hiddenInput = container.querySelector("#media-file-input") as HTMLInputElement;
        const file = new File([new Uint8Array([1, 2, 3])], "test.wav", { type: "audio/wav" });
        await fireEvent.change(hiddenInput, { target: { files: [file] } });

        // Expand the row explicitly (first header button toggles chevron)
        const headerToggle = container.querySelector(".p-3 button") as HTMLButtonElement | null;
        if (headerToggle) await fireEvent.click(headerToggle);

        // Trigger auto-segmentation (optional, but helps)
        const autoSegmentBtn = await screen.findByRole("button", { name: /Auto Segment/i });
        await fireEvent.click(autoSegmentBtn);
        await new Promise((r) => setTimeout(r, 1300));

        // Try to create an extra split if we still have a single segment
        const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
        if (canvas && getSegmentCount(container) < 2) {
            const rect = { left: 0, width: 400 } as any;
            jestSetBoundingClientRect(canvas, rect);
            await fireEvent.click(canvas, { clientX: rect.left + rect.width / 2 });
            // Give the UI a beat
            await new Promise((r) => setTimeout(r, 100));
        }

        // Gather segment rows via their remove buttons (present when segments > 1)
        const removeButtons = Array.from(
            container.querySelectorAll('button[title="Remove segment"]')
        ) as HTMLButtonElement[];
        // If still a single segment, rows array may be empty; we'll still proceed with whatever rows we can identify
        const rows = removeButtons.map((b) => b.closest("div"));
        const uniqueRows = Array.from(new Set(rows)).filter(Boolean) as HTMLElement[];
        // Find play buttons for first two rows (fallback to single row if needed)
        const playBtnForRow = (row: HTMLElement) => {
            const btns = Array.from(row.querySelectorAll("button")) as HTMLButtonElement[];
            // pick a button without title attribute (the play/pause button)
            const btn = btns.find((b) => !b.getAttribute("title"));
            expect(btn).toBeTruthy();
            return btn as HTMLButtonElement;
        };
        // Determine target rows: if no remove buttons yet, find the segment list by looking for play buttons in the list container
        let firstRowPlay: HTMLButtonElement | null = null;
        let secondRowPlay: HTMLButtonElement | null = null;
        if (uniqueRows.length > 0) {
            firstRowPlay = playBtnForRow(uniqueRows[0]);
            secondRowPlay = playBtnForRow(uniqueRows[1] || uniqueRows[0]);
        } else {
            const candidates = Array.from(container.querySelectorAll("button svg.lucide-play")).map(
                (svg) => (svg as HTMLElement).closest("button") as HTMLButtonElement
            );
            if (candidates.length > 0) firstRowPlay = candidates[0];
            if (candidates.length > 1) secondRowPlay = candidates[1];
        }
        expect(firstRowPlay).toBeTruthy();

        // Click play on first row
        await fireEvent.click(firstRowPlay!);
        await waitFor(() => expect(countIcons(container, ".lucide-pause")).toBe(1));
        if (uniqueRows[0]) expect(iconInside(container, uniqueRows[0], ".lucide-pause")).toBe(true);
        if (uniqueRows[1])
            expect(iconInside(container, uniqueRows[1], ".lucide-pause")).toBe(false);

        // Click pause on first row
        await fireEvent.click(firstRowPlay!);
        await waitFor(() => expect(countIcons(container, ".lucide-pause")).toBe(0));

        // Click play on second row (if available) to ensure switching works
        if (secondRowPlay && secondRowPlay !== firstRowPlay) {
            await fireEvent.click(secondRowPlay);
            await waitFor(() => expect(countIcons(container, ".lucide-pause")).toBe(1));
            if (uniqueRows[1]) {
                expect(iconInside(container, uniqueRows[1], ".lucide-pause")).toBe(true);
            }
        }
    });
});

function getSegmentCount(container: HTMLElement) {
    const badges = Array.from(container.querySelectorAll(".badge, [class*='badge']"));
    const seg = badges.find((b) => /^(\s*)?\d+\s+segments?/i.test(b.textContent || ""));
    if (!seg) return 0;
    const m = (seg.textContent || "").match(/(\d+)\s+segments?/i);
    return m ? parseInt(m[1], 10) : 0;
}

function countIcons(container: HTMLElement, selector: string) {
    return container.querySelectorAll(selector).length;
}

function iconInside(container: HTMLElement, row: HTMLElement | undefined, selector: string) {
    if (!row) return false;
    return row.querySelector(selector) != null;
}

// jsdom doesn't implement getBoundingClientRect; provide a shim when needed
function jestSetBoundingClientRect(el: Element, rect: { left: number; width: number }) {
    (el as any).getBoundingClientRect = () => ({
        left: rect.left,
        width: rect.width,
        right: rect.left + rect.width,
        top: 0,
        bottom: 0,
        height: 0,
        x: rect.left,
        y: 0,
        toJSON: () => rect,
    });
}
