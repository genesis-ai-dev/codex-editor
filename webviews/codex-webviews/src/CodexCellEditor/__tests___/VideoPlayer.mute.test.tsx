import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Capture the props ReactPlayer receives so we can assert the controlled `muted` prop.
// The mock forwards its ref to a real <video> so VideoPlayer's getVideoElement resolves it
// and attaches the volumechange listener that mirrors muted into state.
let lastPlayerProps: Record<string, any> = {};
vi.mock("react-player", () => ({
    default: React.forwardRef((props: any, ref: any) => {
        lastPlayerProps = props;
        return (
            <video
                data-testid="native-video"
                ref={(node: HTMLVideoElement | null) => {
                    if (typeof ref === "function") ref(node);
                    else if (ref) ref.current = node;
                }}
            />
        );
    }),
}));

// Avoid URL.createObjectURL (not in jsdom); subtitles are irrelevant to muting.
vi.mock("../utils/vttUtils", () => ({
    useSubtitleData: () => ({ subtitleUrl: "", subtitleData: "" }),
}));

import VideoPlayer from "../VideoPlayer";
import type { ReactPlayerRef } from "../types/reactPlayerTypes";

const renderPlayer = () => {
    const playerRef = React.createRef<ReactPlayerRef>();
    return render(
        <VideoPlayer
            playerRef={playerRef as React.RefObject<ReactPlayerRef>}
            videoUrl="https://example.com/video.mp4"
            translationUnitsForSection={[]}
            autoPlay={false}
            playerHeight={360}
        />
    );
};

describe("VideoPlayer keeps mute as a controlled prop", () => {
    beforeEach(() => {
        lastPlayerProps = {};
    });

    it("starts unmuted", async () => {
        renderPlayer();
        await screen.findByTestId("native-video");
        expect(lastPlayerProps.muted).toBe(false);
    });

    it("reflects an imperative mute into the controlled muted prop (so it can't be reset on re-render)", async () => {
        renderPlayer();
        const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;

        // Simulate what "Play Video" / the multi-cell overlay do: mute the element directly.
        // Setting .muted fires volumechange, which VideoPlayer listens to.
        act(() => {
            video.muted = true;
            video.dispatchEvent(new Event("volumechange"));
        });

        await waitFor(() => expect(lastPlayerProps.muted).toBe(true));
    });

    it("reflects unmuting back into the prop", async () => {
        renderPlayer();
        const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;

        act(() => {
            video.muted = true;
            video.dispatchEvent(new Event("volumechange"));
        });
        await waitFor(() => expect(lastPlayerProps.muted).toBe(true));

        act(() => {
            video.muted = false;
            video.dispatchEvent(new Event("volumechange"));
        });
        await waitFor(() => expect(lastPlayerProps.muted).toBe(false));
    });
});
