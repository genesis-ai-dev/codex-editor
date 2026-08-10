import React from "react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { generateVttData } from "../utils/vttUtils";
import type { QuillCellContent } from "../../../../types";

// react-player is heavy; render a real <video> and forward the ref to it so the component's
// getVideoElement() resolves a genuine HTMLVideoElement and appends subtitle <track>s to it.
vi.mock("react-player", () => ({
    default: React.forwardRef((_props: any, ref: any) => (
        <video
            data-testid="native-video"
            ref={(node: HTMLVideoElement | null) => {
                if (typeof ref === "function") ref(node);
                else if (ref) ref.current = node;
            }}
        />
    )),
}));

import VideoPlayer from "../VideoPlayer";
import type { ReactPlayerRef } from "../types/reactPlayerTypes";

const makeUnit = (content: string, marker = "MRK 1:1"): QuillCellContent =>
    ({
        cellMarkers: [marker],
        cellContent: content,
        editHistory: [],
        timestamps: { startTime: 0, endTime: 2 },
    } as unknown as QuillCellContent);

describe("generateVttData reflects edited cell content", () => {
    it("includes the cell text in the generated cue", () => {
        const vtt = generateVttData([makeUnit("Hello world")], true);
        expect(vtt).toContain("WEBVTT");
        expect(vtt).toContain("Hello world");
    });

    it("produces different output when the text changes (e.g. an appended suffix)", () => {
        const before = generateVttData(
            [makeUnit("Յոթ օրը մեկ: Ինչո՞ւ այդքան հաճախ, Սավթա:")],
            true
        );
        const after = generateVttData(
            [makeUnit("Յոթ օրը մեկ: Ինչո՞ւ այդքան հաճախ, Սավթա:ddd")],
            true
        );

        expect(after).not.toEqual(before);
        expect(after).toContain("Սավթա:ddd");
        expect(before).not.toContain("Սավթա:ddd");
    });
});

describe("VideoPlayer subtitle track refresh", () => {
    let urlCounter = 0;

    beforeAll(() => {
        // jsdom implements neither of these; the component mints/uses blob URLs per edit.
        (URL as any).createObjectURL = vi.fn(() => `blob:mock/${++urlCounter}`);
        (URL as any).revokeObjectURL = vi.fn();
    });

    beforeEach(() => {
        urlCounter = 0;
    });

    const renderPlayer = (units: QuillCellContent[]) => {
        const playerRef = React.createRef<ReactPlayerRef>();
        return render(
            <VideoPlayer
                playerRef={playerRef as React.RefObject<ReactPlayerRef>}
                videoUrl="https://example.com/video.mp4"
                translationUnitsForSection={units}
                autoPlay={false}
                playerHeight={360}
            />
        );
    };

    it("re-applies the subtitle track with a fresh URL when the cell text changes", async () => {
        const { rerender } = renderPlayer([makeUnit("original text")]);

        const video = screen.getByTestId("native-video");
        // The effect appends the track after a short mount delay.
        await waitFor(() => expect(video.querySelector("track")).not.toBeNull());

        const firstSrc = video.querySelector("track")!.getAttribute("src");
        expect(firstSrc).toBeTruthy();

        // Simulate the user editing the cell: the merged units feed a new VTT blob URL.
        const playerRef = React.createRef<ReactPlayerRef>();
        rerender(
            <VideoPlayer
                playerRef={playerRef as React.RefObject<ReactPlayerRef>}
                videoUrl="https://example.com/video.mp4"
                translationUnitsForSection={[makeUnit("original text edited")]}
                autoPlay={false}
                playerHeight={360}
            />
        );

        // A single, refreshed track should now point at a different blob URL.
        await waitFor(() => {
            const tracks = video.querySelectorAll("track");
            expect(tracks).toHaveLength(1);
            expect(tracks[0].getAttribute("src")).not.toEqual(firstSrc);
        });
    });
});
