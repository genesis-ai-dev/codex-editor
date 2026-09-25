/** Shared by character export and the real-binary compatibility smoke test. */
export function buildCharacterAudioFilter(startTimesMs: readonly number[], sampleRate: number): string {
    const lines = startTimesMs.map((delayMs, i) => {
        const input = i + 1; // Input zero is the silent base, which sets duration.
        return `[${input}:a]aresample=${sampleRate},aformat=channel_layouts=mono:sample_fmts=s16,adelay=${delayMs}:all=1[a${input}]`;
    });
    const mixInputs = ["[0:a]", ...startTimesMs.map((_, i) => `[a${i + 1}]`)].join("");
    lines.push(`${mixInputs}amix=inputs=${startTimesMs.length + 1}:duration=first:normalize=0[out]`);
    return lines.join(";\n");
}
