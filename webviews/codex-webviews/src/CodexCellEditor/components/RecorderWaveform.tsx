import React, { useEffect, useRef } from "react";

/**
 * Live audio waveform — Voice Memos / ChatGPT-voice style scrolling display.
 *
 * Architecture:
 *   - One <canvas>, one AnalyserNode tapped from the active MediaRecorder
 *     stream, one requestAnimationFrame loop.
 *   - The canvas updates imperatively via a ref; React re-renders zero times
 *     during recording.
 *   - A ring buffer of recent peak amplitudes (~64 entries) is kept in a
 *     plain Float32Array — single allocation, <1 KB.  Total memory footprint
 *     is roughly a small canvas backing store + ~2 KB of typed arrays.
 *
 * Responsiveness model:
 *   The analyser is polled every animation frame (~60 Hz) so the *live* bar
 *   on the right edge tracks the current signal in real-time.  But the ring
 *   buffer (history) is only advanced every PUSH_INTERVAL_MS — which slows
 *   the visual scroll without sacrificing input fidelity.  Each committed
 *   bar captures the *peak* of its push window, so transient spikes are
 *   never averaged away.  An attack/release envelope on the live level
 *   gives the bars the snap-then-decay feel of a real VU meter.
 *
 * Visual:
 *   - Centerline-anchored bars with rounded caps.
 *   - Older bars at the leftmost ~18% fade to lower alpha (flowing out).
 *   - The rightmost (live) bar renders at full opacity for visual focus.
 *
 * Lifecycle:
 *   - When `stream` is null OR the canvas is unmounted, the AudioContext is
 *     closed and the RAF is cancelled.  No leaked resources.
 *   - The AnalyserNode is fully passive: it taps the stream but does not
 *     modify it, so recorded audio is unaffected.
 */

export interface RecorderWaveformProps {
    /** Live MediaRecorder.stream.  Pass `null` to clear and stop drawing. */
    stream: MediaStream | null;
    /** Optional override for the bar count (default: 64). */
    barCount?: number;
    /** Optional className for the wrapping div. */
    className?: string;
}

const DEFAULT_BAR_COUNT = 64;
const BAR_GAP = 3; // px between bars — wider gap reads as cleaner rhythm
const MIN_BAR_HEIGHT = 3; // px — visible centerline during silence
const FADE_TAIL_PCT = 0.18; // leftmost 18% of bars fade out

// Visualization tuning.
const PUSH_INTERVAL_MS = 50;     // 20 history pushes/sec; ~3.2s of visible history at 64 bars
const ATTACK_COEF = 0.55;        // smoothing per frame when level is rising — fast attack
const RELEASE_COEF = 0.10;       // smoothing per frame when level is falling — slow release
const COMPRESSION_EXP = 0.6;     // <1 amplifies quiet sounds, dampens loud ones for visibility

export const RecorderWaveform: React.FC<RecorderWaveformProps> = ({
    stream,
    barCount = DEFAULT_BAR_COUNT,
    className,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Snapshot canvas size so we don't pay getBoundingClientRect per frame.
        // Set the backing store size to match physical pixels for crispness on
        // high-DPI displays, then scale the 2D context back to CSS pixels so
        // our drawing math stays in CSS pixel space.
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const cssWidth = rect.width;
        const cssHeight = rect.height;
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        ctx.scale(dpr, dpr);

        // Pre-compute layout — no allocations per frame.
        const barWidth = Math.max(1, (cssWidth - barCount * BAR_GAP) / barCount);
        const slotWidth = barWidth + BAR_GAP;
        const fadeTailBars = Math.max(1, Math.floor(barCount * FADE_TAIL_PCT));

        // Ring buffer of recent peak amplitudes in [0, 1].  Index `head`
        // points at the slot to write next.
        const buffer = new Float32Array(barCount);
        let head = 0;

        // Read theme color from CSS once per mount.  Falls back to a sensible
        // red if --destructive isn't resolvable (test/headless env).
        const root = getComputedStyle(document.documentElement);
        const barColor = root.getPropertyValue("--destructive").trim() || "#dc2626";

        const drawIdle = () => {
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            const cy = cssHeight / 2;
            ctx.fillStyle = barColor;
            ctx.globalAlpha = 0.25;
            for (let i = 0; i < barCount; i += 1) {
                const x = i * slotWidth;
                ctx.fillRect(x, cy - MIN_BAR_HEIGHT / 2, barWidth, MIN_BAR_HEIGHT);
            }
            ctx.globalAlpha = 1;
        };

        // Bail early when there's nothing live to read from.  The check on
        // `getAudioTracks().length` matters because a MediaStream with no
        // audio track produces silent samples and the bars would just sit at
        // MIN_BAR_HEIGHT — visually identical to the "broken" state.
        if (!stream || stream.getAudioTracks().length === 0) {
            drawIdle();
            return;
        }

        // Lazily resolve AudioContext (Safari uses webkitAudioContext).
        const AudioCtx: typeof AudioContext | undefined =
            (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) {
            drawIdle();
            return;
        }

        let audioCtx: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let rafId: number | null = null;
        let cancelled = false;
        // Backed by a plain ArrayBuffer (not SharedArrayBuffer) so the type
        // matches the AnalyserNode signature on TS lib >=5.7.
        let timeBuf: Uint8Array<ArrayBuffer>;

        try {
            audioCtx = new AudioCtx();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024; // 512 time-domain samples per frame
            analyser.smoothingTimeConstant = 0;
            source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);
            timeBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));

            // Modern browsers create AudioContexts in the "suspended" state
            // and require an explicit resume(), even when the user gesture
            // (the record click) has already happened.  Without this, the
            // analyser silently returns 128 for every sample and the bars
            // appear frozen at min height — which is exactly the bug we hit.
            if (audioCtx.state === "suspended") {
                audioCtx.resume().catch(() => {
                    /* If resume is rejected we still draw, just at idle. */
                });
            }
        } catch (err) {
            console.warn("[RecorderWaveform] AudioContext setup failed:", err);
            drawIdle();
            return;
        }

        // Feature-detect roundRect (Chrome 99+, Safari 16+, Firefox 113+).
        // VS Code's Electron is recent enough that this is always true in
        // practice, but the fallback keeps us safe in tests/jsdom.
        const hasRoundRect = typeof (ctx as CanvasRenderingContext2D).roundRect === "function";
        const cornerRadius = Math.min(barWidth / 2, 4);

        // Per-frame state for the responsiveness model.  These live in
        // closure scope so RAF callbacks see them without re-allocating.
        let smoothedLevel = 0;     // attack/release envelope
        let windowPeak = 0;        // running max within current push window
        let lastPushAt: number | null = null;
        const cy = cssHeight / 2;
        const maxBarHeight = cssHeight * 0.85;

        const tick = (now: number) => {
            if (cancelled || !analyser) return;
            if (lastPushAt === null) lastPushAt = now;

            analyser.getByteTimeDomainData(timeBuf);

            // Peak deviation from the silence midpoint (128).  We use peak
            // rather than RMS because peak responds faster to transients
            // and looks more "alive" for a recording UI.
            let peak = 0;
            for (let i = 0; i < timeBuf.length; i += 1) {
                const v = Math.abs(timeBuf[i] - 128);
                if (v > peak) peak = v;
            }
            const rawLevel = Math.min(1, Math.pow(peak / 128, COMPRESSION_EXP));

            // Attack/release envelope.  Fast attack so peaks register in 1–2
            // frames; slow release so decay tails feel natural rather than
            // popping back to zero.
            const coef = rawLevel > smoothedLevel ? ATTACK_COEF : RELEASE_COEF;
            smoothedLevel += (rawLevel - smoothedLevel) * coef;

            // Track the running peak inside the current push window so the
            // committed history bar can capture transients shorter than the
            // push interval.
            if (smoothedLevel > windowPeak) windowPeak = smoothedLevel;

            // Commit a window's peak into the ring buffer when the push
            // interval elapses.  The new window starts at the current
            // smoothed level so there's no visual gap.
            if (now - lastPushAt >= PUSH_INTERVAL_MS) {
                buffer[head] = windowPeak;
                head = (head + 1) % barCount;
                windowPeak = smoothedLevel;
                lastPushAt = now;
            }

            // Draw.  Bars [0, barCount-2] come from the ring buffer (history,
            // oldest at left).  The rightmost bar (barCount-1) is the live
            // bar, drawn from the running window peak so it grows with the
            // signal between commits.
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            ctx.fillStyle = barColor;
            for (let i = 0; i < barCount; i += 1) {
                const isLive = i === barCount - 1;
                const amp = isLive ? windowPeak : buffer[(head + i) % barCount];
                const h = Math.max(MIN_BAR_HEIGHT, amp * maxBarHeight);
                const x = i * slotWidth;
                const y = cy - h / 2;

                // Alpha policy:
                //   - leftmost ~18% fades from quiet to medium (flowing out)
                //   - body sits at 0.85 (calm history)
                //   - live bar at 1.0 (visual focus on what's happening now)
                let alpha: number;
                if (i < fadeTailBars) {
                    alpha = 0.25 + (i / fadeTailBars) * 0.6;
                } else if (isLive) {
                    alpha = 1;
                } else {
                    alpha = 0.85;
                }
                ctx.globalAlpha = alpha;

                if (hasRoundRect) {
                    ctx.beginPath();
                    ctx.roundRect(x, y, barWidth, h, Math.min(cornerRadius, h / 2));
                    ctx.fill();
                } else {
                    ctx.fillRect(x, y, barWidth, h);
                }
            }
            ctx.globalAlpha = 1;

            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);

        return () => {
            cancelled = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            try { source?.disconnect(); } catch { /* already disposed */ }
            try { analyser?.disconnect(); } catch { /* already disposed */ }
            audioCtx?.close().catch(() => { /* already closed */ });
        };
    }, [stream, barCount]);

    return (
        <div
            className={`w-full rounded-md bg-secondary/40 ${className ?? ""}`}
            style={{ height: 60 }}
        >
            <canvas
                ref={canvasRef}
                className="block w-full h-full rounded-md"
                aria-hidden="true"
            />
        </div>
    );
};
