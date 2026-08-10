/**
 * Resolve the underlying HTMLVideoElement from a react-player v3 ref.
 *
 * react-player exposes different shapes depending on the source:
 *  - plain files: the ref *is* the <video> element
 *  - HLS (.m3u8): the ref is an <hls-video> custom element that keeps the real <video> inside
 *    its shadow DOM and exposes it via `nativeEl`. querySelector cannot pierce the shadow
 *    boundary, so the `nativeEl` / `shadowRoot` branches are required — without them every
 *    feature that needs the media element (mute, volume sync, subtitle <track> injection)
 *    silently no-ops for HLS streams.
 *
 * Shared by VideoPlayer and useMultiCellAudioPlayback so the resolution logic can't drift.
 */
export function resolveVideoElement(player: unknown): HTMLVideoElement | null {
    if (!player) return null;
    const node = player as any;

    // react-player v2-style escape hatch (harmless if absent in v3).
    const internalPlayer = node.getInternalPlayer?.();
    if (internalPlayer instanceof HTMLVideoElement) {
        return internalPlayer;
    }
    if (internalPlayer && typeof internalPlayer === "object") {
        const found =
            internalPlayer.querySelector?.("video") || internalPlayer.video || internalPlayer;
        if (found instanceof HTMLVideoElement) {
            return found;
        }
    }

    // The ref is already the <video> (plain file sources).
    if (node instanceof HTMLVideoElement) {
        return node;
    }

    // Custom media element (e.g. <hls-video>): the <video> lives in shadow DOM behind a slot.
    if (node.nativeEl instanceof HTMLVideoElement) {
        return node.nativeEl;
    }

    const found =
        node.querySelector?.("video") ||
        node.shadowRoot?.querySelector?.("video") ||
        node.parentElement?.querySelector?.("video");
    if (found instanceof HTMLVideoElement) {
        return found;
    }

    return null;
}
