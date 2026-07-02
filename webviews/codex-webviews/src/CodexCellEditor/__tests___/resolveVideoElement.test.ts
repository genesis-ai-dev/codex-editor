import { describe, it, expect } from "vitest";
import { resolveVideoElement } from "../utils/videoElement";

describe("resolveVideoElement", () => {
    it("returns null for a missing player", () => {
        expect(resolveVideoElement(null)).toBeNull();
        expect(resolveVideoElement(undefined)).toBeNull();
    });

    it("returns the element directly when the ref is a <video> (plain file sources)", () => {
        const video = document.createElement("video");
        expect(resolveVideoElement(video)).toBe(video);
    });

    it("resolves the shadow-DOM <video> via nativeEl for a custom element (HLS streams)", () => {
        // Simulates <hls-video>, whose real <video> lives in shadow DOM and is exposed as nativeEl.
        const hlsVideo = document.createElement("div");
        const nativeEl = document.createElement("video");
        (hlsVideo as any).nativeEl = nativeEl;

        expect(resolveVideoElement(hlsVideo)).toBe(nativeEl);
    });

    it("falls back to shadowRoot.querySelector when nativeEl is absent", () => {
        const host = document.createElement("div");
        const shadow = host.attachShadow({ mode: "open" });
        const nativeEl = document.createElement("video");
        shadow.appendChild(nativeEl);

        expect(resolveVideoElement(host)).toBe(nativeEl);
    });

    it("finds a light-DOM child <video> via querySelector", () => {
        const wrapper = document.createElement("div");
        const video = document.createElement("video");
        wrapper.appendChild(video);

        expect(resolveVideoElement(wrapper)).toBe(video);
    });

    it("uses getInternalPlayer when it returns a video element", () => {
        const video = document.createElement("video");
        const player = { getInternalPlayer: () => video };

        expect(resolveVideoElement(player)).toBe(video);
    });

    it("returns null when no video can be found anywhere", () => {
        expect(resolveVideoElement(document.createElement("div"))).toBeNull();
    });
});
