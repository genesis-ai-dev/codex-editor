// Tracks which cells currently have an in-flight audio download so any view can
// reflect it — not just the one that started it.
//
// The cell-list `AudioPlayButton` mounts only after the cell editor collapses,
// which is *after* a download may have been kicked off from the editor. A
// transient event would be missed, so this registry persists the in-flight set
// and lets a freshly-mounted button read the current state on mount and
// subscribe to subsequent changes.

type Listener = (cellId: string, downloading: boolean) => void;

const inFlight = new Set<string>();
const listeners = new Set<Listener>();

export const isAudioDownloading = (cellId: string): boolean => inFlight.has(cellId);

export const setAudioDownloading = (cellId: string, downloading: boolean): void => {
    const had = inFlight.has(cellId);
    if (downloading) {
        if (had) return;
        inFlight.add(cellId);
    } else {
        if (!had) return;
        inFlight.delete(cellId);
    }
    listeners.forEach((listener) => listener(cellId, downloading));
};

export const subscribeAudioDownloading = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
