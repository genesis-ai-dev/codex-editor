/**
 * React Player v3 returns HTMLVideoElement but may expose additional methods
 * This interface extends HTMLVideoElement to include ReactPlayer-specific methods
 */
export interface ReactPlayerRef extends HTMLVideoElement {
    seekTo?: (amount: number, type?: "seconds" | "fraction") => void;
    getCurrentTime?: () => number;
    getSecondsLoaded?: () => number;
    getDuration?: () => number;
    getInternalPlayer?: (key?: string) => any;
}

