export type AudioControllerEvent = { type: "stopped"; audio: HTMLAudioElement; };

export class GlobalAudioController {
    private currentAudio: HTMLAudioElement | null = null;
    private listeners: Set<(e: AudioControllerEvent) => void> = new Set();

    addListener(listener: (e: AudioControllerEvent) => void): void {
        this.listeners.add(listener);
    }

    removeListener(listener: (e: AudioControllerEvent) => void): void {
        this.listeners.delete(listener);
    }

    private notifyStopped(audio: HTMLAudioElement) {
        this.listeners.forEach((l) => {
            try {
                l({ type: "stopped", audio });
            } catch { }
        });
    }

    async playExclusive(audio: HTMLAudioElement): Promise<void> {
        if (this.currentAudio && this.currentAudio !== audio) {
            const toStop = this.currentAudio;
            try {
                toStop.pause();
                toStop.currentTime = 0;
            } catch { }
            this.notifyStopped(toStop);
        }
        this.currentAudio = audio;
        const onEnded = () => {
            if (this.currentAudio === audio) {
                this.currentAudio = null;
            }
            audio.removeEventListener("ended", onEnded);
            this.notifyStopped(audio);
        };
        audio.addEventListener("ended", onEnded);
        await audio.play();
    }

    stopAll(): void {
        if (this.currentAudio) {
            const toStop = this.currentAudio;
            try {
                toStop.pause();
                toStop.currentTime = 0;
            } catch { }
            this.currentAudio = null;
            this.notifyStopped(toStop);
        }
    }

    getCurrent(): HTMLAudioElement | null {
        return this.currentAudio;
    }

    /**
     * Release an audio element from being considered "current" when it was stopped
     * programmatically (e.g. via pause() in a timeupdate handler). Call this so
     * that subsequent playback (e.g. VideoPlayer play) is not blocked by stale state.
     */
    release(audio: HTMLAudioElement | null): void {
        if (audio && this.currentAudio === audio) {
            this.currentAudio = null;
            this.notifyStopped(audio);
        }
    }
}

export const globalAudioController = new GlobalAudioController();


