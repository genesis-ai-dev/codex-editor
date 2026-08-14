/**
 * Audio attachment size limits shared by the extension host and webviews.
 * The provider enforces the cap when saving; webview editors use the same
 * value to warn before rendering instead of failing after.
 */

/** Hard cap the provider enforces on a decoded audio attachment. */
export const MAX_AUDIO_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const WAV_HEADER_BYTES = 44;
const PCM16_BYTES_PER_SAMPLE = 2;

/** Exact size of a PCM16 WAV file with the given render parameters. */
export const estimateWavBytes = (
    durationSec: number,
    sampleRate: number,
    channels: number
): number =>
    WAV_HEADER_BYTES +
    Math.ceil(Math.max(0, durationSec) * sampleRate) * channels * PCM16_BYTES_PER_SAMPLE;

/** Longest PCM16 WAV duration (whole seconds) that stays within the cap. */
export const maxWavDurationSec = (sampleRate: number, channels: number): number =>
    Math.floor(
        (MAX_AUDIO_ATTACHMENT_BYTES - WAV_HEADER_BYTES) /
        (sampleRate * channels * PCM16_BYTES_PER_SAMPLE)
    );
