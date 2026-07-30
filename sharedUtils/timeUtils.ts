/**
 * Formats a time in seconds as a VTT-style timecode: HH:MM:SS.mmm
 *
 * Computes from integer milliseconds so float artifacts don't truncate the
 * final digit (e.g. 64.94 formats as "00:01:04.940", not "00:01:04.939").
 */
export const formatTimecode = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "00:00:00.000";
    const totalMs = Math.round(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(ms).padStart(3, "0")}`;
};
