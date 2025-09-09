import { CellLabelData, FileData, ImportedRow, CellMetadata } from "./types";
import { convertTimestampToSeconds, parseTimestampRange } from "./utils";

/**
 * Match imported labels with existing cell IDs
 */
export async function matchCellLabels(
    importedRows: ImportedRow[],
    sourceFiles: FileData[],
    targetFiles: FileData[],
    labelColumnOrColumns: string | string[]
): Promise<CellLabelData[]> {
    const result: CellLabelData[] = [];
    console.log(
        `[matchCellLabels] Received ${importedRows.length} imported rows, ${sourceFiles.length} source files, ${targetFiles.length} target files. Label selector: ${Array.isArray(labelColumnOrColumns) ? labelColumnOrColumns.join(",") : labelColumnOrColumns}`
    );

    // Create a map of all cells by their start time, and also keep a sorted list for nearest match
    const cellMap = new Map<number, { cellId: string; currentLabel?: string; }>();
    // Also create an exact ID lookup for direct ID-based matching
    const idMap = new Map<string, { cellId: string; currentLabel?: string; }>();
    const cellTimes: number[] = [];

    // Extract all cells from source files and create a time-based lookup
    sourceFiles.forEach((file) => {
        file.cells.forEach((cell) => {
            if (cell.metadata?.id) {
                const cellId = cell.metadata.id;

                // Populate exact ID map (trim to be safe)
                idMap.set(String(cellId).trim(), {
                    cellId,
                    currentLabel: (cell.metadata as CellMetadata).cellLabel,
                });

                // Extract the start time from the cell ID (e.g., "cue-25.192-29.029")
                const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
                if (timeMatch && timeMatch[1]) {
                    const startTimeSeconds = parseFloat(timeMatch[1]);
                    cellMap.set(startTimeSeconds, {
                        cellId,
                        currentLabel: (cell.metadata as CellMetadata).cellLabel,
                    });
                    cellTimes.push(startTimeSeconds);
                }
            }
        });
    });
    console.log(`[matchCellLabels] Populated cellMap with ${cellMap.size} cells.`);
    cellTimes.sort((a, b) => a - b);

    // Process each imported row
    importedRows.forEach((row) => {
        // Check if the row has a type field and it equals "cue"
        // If not, try to determine if this is a subtitle by other means
        const isCue =
            row.type === "cue" ||
            (row.start && row.end) || // Has time fields
            Object.keys(row).some((key) => key.toLowerCase().includes("time")) ||
            (typeof row["ID"] === "string" && /cue-\d+(?:\.\d+)?-\d+(?:\.\d+)?/.test(row["ID"]));

        // New: allow processing when there is an explicit ID, even if not a cue/timed row
        const rowId =
            row["ID"] !== undefined && row["ID"] !== null
                ? String(row["ID"]).trim()
                : "";
        const hasExplicitId = rowId.length > 0;

        if (isCue || hasExplicitId) {
            // Find start time from best available source in this priority:
            // 1) explicit numeric start field ("start")
            // 2) ID like "... cue-<start>-<end>"
            // 3) TIMESTAMP range like "50.634 --> 51.468"
            // 4) any time-like field
            let startTimeSeconds = 0;
            let startTimeDisplay = "";
            const rowKeys = Object.keys(row);

            // 1) STARTTIME or START
            if (row["STARTTIME"]) {
                startTimeDisplay = row["STARTTIME"];
                startTimeSeconds = convertTimestampToSeconds(row["STARTTIME"] || "");
            } else if (row["START"]) {
                startTimeDisplay = row["START"];
                startTimeSeconds = convertTimestampToSeconds(row["START"] || "");
            } else if (typeof row["ID"] === "string") {
                const idMatch = row["ID"].match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
                if (idMatch) {
                    startTimeSeconds = parseFloat(idMatch[1]);
                    startTimeDisplay = idMatch[1];
                }
            }

            if (!startTimeSeconds) {
                // Try TIMESTAMP range
                const tsKey = rowKeys.find((k) => k.toLowerCase() === "timestamp" || k.toLowerCase().replace(/\s+/g, "") === "timestamp");
                if (tsKey && typeof row[tsKey] === "string") {
                    const [s] = parseTimestampRange(row[tsKey]);
                    if (s) {
                        startTimeSeconds = s;
                        // set display to left side of range
                        const left = String(row[tsKey]).split(/\s*-->\s*/)[0] || String(row[tsKey]);
                        startTimeDisplay = left;
                    }
                }
            }

            if (!startTimeSeconds) {
                // Try common alternatives
                const startKey = rowKeys.find((key) =>
                    key.toLowerCase().includes("start") ||
                    key.toLowerCase().includes("begin") ||
                    key.toLowerCase().replace(/\s+/g, "").includes("timein")
                );
                if (startKey) {
                    startTimeDisplay = row[startKey];
                    startTimeSeconds = convertTimestampToSeconds(row[startKey] || "");
                }
            }

            // Attempt exact ID match first (preferred)
            let match = hasExplicitId ? idMap.get(rowId) : undefined;

            // If we don't have an exact match and no start time could be identified,
            // then we cannot do time-based matching; skip this row.
            if (!match && !startTimeSeconds) {
                // Not a cue row and no exact ID match
                return;
            }

            // Find which field(s) to use for the label based on user selection
            let labelValue = "";
            if (Array.isArray(labelColumnOrColumns)) {
                const cols = labelColumnOrColumns;
                labelValue = cols
                    .map((k) => (row[k] ? String(row[k]).trim() : ""))
                    .filter((v) => v)
                    .join(", ");
            } else if (labelColumnOrColumns === "__CHARACTER_LABELS_CONCAT__") {
                const rowKeys = Object.keys(row);
                const characterKeys = rowKeys
                    .filter((k) => k.toUpperCase().startsWith("CHARACTER LABEL"))
                    .sort((a, b) => {
                        const na = parseInt((a.match(/CHARACTER LABEL\s*(\d+)/i) || ["", "0"])[1]);
                        const nb = parseInt((b.match(/CHARACTER LABEL\s*(\d+)/i) || ["", "0"])[1]);
                        return na - nb;
                    });
                labelValue = characterKeys
                    .map((k) => (row[k] ? String(row[k]).trim() : ""))
                    .filter((v) => v)
                    .join(", ");
            } else {
                const col = labelColumnOrColumns as string;
                labelValue = row[col] ? row[col].toString().trim() : "";
            }

            // Skip empty labels
            if (!labelValue) {
                return;
            }

            // If we don't have an exact match yet, try time-based matching (exact or nearest)
            if (!match && startTimeSeconds) {
                match = cellMap.get(startTimeSeconds);
                if (!match) {
                    // Dynamic threshold: allow up to 300ms, but if input has no ms (integer seconds), allow 600ms
                    const hasMs =
                        String(startTimeDisplay).match(/[.,]\d{1,3}$/) || String(startTimeSeconds).includes(".");
                    const threshold = hasMs ? 0.3 : 0.6; // seconds

                    // Binary search nearest in sorted array, then check neighbors within threshold
                    let lo = 0, hi = cellTimes.length - 1;
                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1;
                        if (cellTimes[mid] < startTimeSeconds) lo = mid + 1;
                        else hi = mid - 1;
                    }
                    const candidates: number[] = [];
                    if (lo < cellTimes.length) candidates.push(cellTimes[lo]);
                    if (lo - 1 >= 0) candidates.push(cellTimes[lo - 1]);

                    let bestTime: number | null = null;
                    let bestDiff = Number.POSITIVE_INFINITY;
                    for (const t of candidates) {
                        const diff = Math.abs(t - startTimeSeconds);
                        if (diff < bestDiff && diff <= threshold) {
                            bestDiff = diff;
                            bestTime = t;
                        }
                    }
                    if (bestTime !== null) {
                        match = cellMap.get(bestTime);
                    }
                }
            }

            // Determine end time for display: prefer explicit end, else TIMESTAMP range, else ID end
            let endTimeDisplay = "";
            if (row["ENDTIME"]) {
                endTimeDisplay = row["ENDTIME"];
            } else if (row["END"]) {
                endTimeDisplay = row["END"];
            } else {
                const tsKey = rowKeys.find((k) => k.toLowerCase() === "timestamp" || k.toLowerCase().replace(/\s+/g, "") === "timestamp");
                if (tsKey && typeof row[tsKey] === "string") {
                    const [, e] = parseTimestampRange(row[tsKey]);
                    if (e) {
                        const right = String(row[tsKey]).split(/\s*-->\s*/)[1] || "";
                        endTimeDisplay = right;
                    }
                }
                // If still empty, try to derive from either the row ID (if cue style) or matched cell ID
                if (!endTimeDisplay) {
                    if (typeof row["ID"] === "string") {
                        const idMatch = row["ID"].match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
                        if (idMatch) endTimeDisplay = idMatch[2];
                    }
                    if (!endTimeDisplay && match?.cellId) {
                        const m = match.cellId.match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
                        if (m) {
                            // Also backfill startTimeDisplay if we got here via exact ID match
                            if (!startTimeDisplay) startTimeDisplay = m[1];
                            endTimeDisplay = m[2];
                        }
                    }
                }
            }

            // Build character string from any CHARACTER LABEL columns if present
            let characterDisplay = "";
            const characterKeys = rowKeys.filter((k) => k.toUpperCase().startsWith("CHARACTER LABEL"));
            if (characterKeys.length > 0) {
                characterDisplay = characterKeys
                    .map((k) => (row[k] ? String(row[k]).trim() : ""))
                    .filter((v) => v)
                    .join(", ");
            }

            result.push({
                cellId: match?.cellId || "",
                startTime: startTimeDisplay,
                endTime: endTimeDisplay,
                character: row.character || row.CHARACTER || characterDisplay || "",
                dialogue: row.dialogue || row.DIALOGUE || "",
                newLabel: labelValue,
                currentLabel: match?.currentLabel,
                matched: !!match,
            });
        }
    });

    return result;
}
