import React from "react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// --- Fakes mirroring the AudioTrackList contract that <hls-video> exposes ---
// Real tracks carry id/label/language/enabled and live on an EventTarget that fires
// addtrack/removetrack/change; the player reads and toggles exactly that surface.
interface FakeTrackInit {
    id: string;
    label: string;
    language: string;
    enabled?: boolean;
}

class FakeAudioTrack {
    id: string;
    label: string;
    language: string;
    kind = "alternative";
    list: FakeAudioTrackList | null = null;
    private _enabled: boolean;

    constructor(init: FakeTrackInit) {
        this.id = init.id;
        this.label = init.label;
        this.language = init.language;
        this._enabled = init.enabled ?? false;
    }

    get enabled() {
        return this._enabled;
    }

    // Toggling enabled is how a language switch is applied; the real list emits "change".
    set enabled(value: boolean) {
        if (this._enabled === value) return;
        this._enabled = value;
        this.list?.dispatchEvent(new Event("change"));
    }
}

class FakeAudioTrackList extends EventTarget {
    private tracks: FakeAudioTrack[] = [];

    get length() {
        return this.tracks.length;
    }

    [Symbol.iterator]() {
        return this.tracks[Symbol.iterator]();
    }

    addTrack(init: FakeTrackInit) {
        const track = new FakeAudioTrack(init);
        track.list = this;
        this.tracks.push(track);
        this.dispatchEvent(new Event("addtrack"));
        return track;
    }
}

// The element react-player hands back via its ref for an HLS source: a DOM node that
// carries the AudioTrackList. Recreated per test so state never leaks between cases.
let mockAudioTracks: FakeAudioTrackList;
let mockHost: HTMLElement & { audioTracks: FakeAudioTrackList };

// react-player is heavy (it lazy-loads the hls custom element); stub it and forward the
// ref to our fake host, mirroring how the real player assigns its media element to the ref.
vi.mock("react-player", () => ({
    default: React.forwardRef((_props: any, ref: any) => {
        React.useEffect(() => {
            if (typeof ref === "function") ref(mockHost);
            else if (ref) ref.current = mockHost;
        });
        return <div data-testid="react-player" />;
    }),
}));

// Subtitle generation calls URL.createObjectURL, which jsdom lacks; it is irrelevant here.
vi.mock("../utils/vttUtils", () => ({
    useSubtitleData: () => ({ subtitleUrl: "", subtitleData: "" }),
}));

import VideoPlayer from "../VideoPlayer";
import type { ReactPlayerRef } from "../types/reactPlayerTypes";

const HLS_URL = "https://cdn.example.com/videos/abc/master.m3u8";
const MP4_URL = "https://cdn.example.com/videos/abc/video.mp4";

const renderPlayer = (videoUrl: string) => {
    const playerRef = React.createRef<ReactPlayerRef>();
    return render(
        <VideoPlayer
            playerRef={playerRef as React.RefObject<ReactPlayerRef>}
            videoUrl={videoUrl}
            translationUnitsForSection={[]}
            autoPlay={false}
            playerHeight={360}
        />
    );
};

describe("VideoPlayer audio language selector", () => {
    beforeAll(() => {
        // Radix DropdownMenu touches pointer/scroll APIs that jsdom does not implement.
        const proto = Element.prototype as any;
        proto.hasPointerCapture ??= () => false;
        proto.setPointerCapture ??= () => {};
        proto.releasePointerCapture ??= () => {};
        proto.scrollIntoView ??= () => {};
        // jsdom has no PointerEvent; Radix opens its menu on pointerdown, so provide one.
        if (typeof (globalThis as any).PointerEvent === "undefined") {
            class PointerEventPolyfill extends MouseEvent {
                pointerType: string;
                constructor(type: string, params: any = {}) {
                    super(type, params);
                    this.pointerType = params.pointerType ?? "mouse";
                }
            }
            (globalThis as any).PointerEvent = PointerEventPolyfill;
        }
    });

    beforeEach(() => {
        mockAudioTracks = new FakeAudioTrackList();
        mockHost = Object.assign(document.createElement("div"), {
            audioTracks: mockAudioTracks,
        });
    });

    it("hides the selector when the HLS stream has only one audio track", async () => {
        mockAudioTracks.addTrack({ id: "0", label: "English", language: "en", enabled: true });
        renderPlayer(HLS_URL);

        await screen.findByTestId("react-player");
        expect(screen.queryByTestId("audio-language-selector")).not.toBeInTheDocument();
    });

    it("hides the selector for a non-HLS source even when multiple tracks exist", async () => {
        mockAudioTracks.addTrack({ id: "0", label: "English", language: "en", enabled: true });
        mockAudioTracks.addTrack({ id: "1", label: "Spanish", language: "es" });
        renderPlayer(MP4_URL);

        await screen.findByTestId("react-player");
        expect(screen.queryByTestId("audio-language-selector")).not.toBeInTheDocument();
    });

    it("shows the selector labeled with the active language for a multi-track HLS stream", async () => {
        mockAudioTracks.addTrack({ id: "0", label: "English", language: "en", enabled: true });
        mockAudioTracks.addTrack({ id: "1", label: "Spanish", language: "es" });
        mockAudioTracks.addTrack({ id: "2", label: "French", language: "fr" });
        renderPlayer(HLS_URL);

        const trigger = await screen.findByTestId("audio-language-selector");
        expect(trigger).toHaveTextContent("English");
    });

    it("reveals the selector once tracks load asynchronously via addtrack events", async () => {
        renderPlayer(HLS_URL);

        await screen.findByTestId("react-player");
        expect(screen.queryByTestId("audio-language-selector")).not.toBeInTheDocument();

        // The manifest parses after mount, populating the track list.
        act(() => {
            mockAudioTracks.addTrack({ id: "0", label: "English", language: "en", enabled: true });
            mockAudioTracks.addTrack({ id: "1", label: "Hindi", language: "hi" });
        });

        expect(await screen.findByTestId("audio-language-selector")).toBeInTheDocument();
    });

    it("switches the enabled audio track when a different language is selected", async () => {
        const en = mockAudioTracks.addTrack({
            id: "0",
            label: "English",
            language: "en",
            enabled: true,
        });
        const es = mockAudioTracks.addTrack({ id: "1", label: "Spanish", language: "es" });
        renderPlayer(HLS_URL);

        const trigger = await screen.findByTestId("audio-language-selector");
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

        const spanishItem = await screen.findByRole("menuitemradio", { name: "Spanish" });
        fireEvent.click(spanishItem);

        await waitFor(() => {
            expect(es.enabled).toBe(true);
            expect(en.enabled).toBe(false);
        });
        expect(screen.getByTestId("audio-language-selector")).toHaveTextContent("Spanish");
    });
});
