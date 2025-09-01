function parseTimeToSeconds(t: string): number {
    const s = t.trim();
    // hh:mm:ss.mmm or mm:ss.mmm or ss(.mmm)
    const parts = s.split(":");
    if (parts.length === 3) {
        const [hh, mm, rest] = parts;
        const ss = parseFloat(rest.replace(",", "."));
        return parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + ss;
    } else if (parts.length === 2) {
        const [mm, rest] = parts;
        const ss = parseFloat(rest.replace(",", "."));
        return parseInt(mm, 10) * 60 + ss;
    } else {
        return parseFloat(s.replace(",", "."));
    }
}

export function processVttOrTsv(text: string): Array<{ startSec: number; endSec: number; }> {
    const trimmed = text.trim();
    // WebVTT detection
    if (/^WEBVTT/m.test(trimmed) || /-->/.test(trimmed)) {
        const lines = trimmed.split(/\r?\n/);
        const segments: Array<{ startSec: number; endSec: number; }> = [];
        for (const line of lines) {
            const m = line.match(/(\d{1,2}:)?\d{1,2}:\d{1,2}[\.,]\d{1,3}\s+-->\s+(\d{1,2}:)?\d{1,2}:\d{1,2}[\.,]\d{1,3}/);
            if (m) {
                const [lhs, rhs] = line.split(/\s+-->\s+/);
                segments.push({ startSec: parseTimeToSeconds(lhs), endSec: parseTimeToSeconds(rhs) });
            }
        }
        return segments;
    }

    // TSV/CSV blocks: either start\tend or boundaries per line
    const segments: Array<{ startSec: number; endSec: number; }> = [];
    const times: number[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l) continue;
        // start,end or start\tend
        if (/[\t,]/.test(l)) {
            const [a, b] = l.split(/[\t,]/).map(s => s.trim());
            if (a && b) {
                segments.push({ startSec: parseTimeToSeconds(a), endSec: parseTimeToSeconds(b) });
            }
        } else {
            // boundary
            times.push(parseTimeToSeconds(l));
        }
    }
    if (segments.length > 0) {
        return segments;
    }
    times.sort((a, b) => a - b);
    for (let i = 0; i < times.length - 1; i++) {
        segments.push({ startSec: times[i], endSec: times[i + 1] });
    }
    return segments;
}


