import { CellLabelData, FileData, ImportedRow, CellMetadata, MatchOptions } from "./types";
import { convertTimestampToSeconds, parseTimestampRange } from "./utils";

/**
 * Match imported labels with existing cell IDs
 */
export async function matchCellLabels(
    importedRows: ImportedRow[],
    sourceFiles: FileData[],
    targetFiles: FileData[],
    labelColumnOrColumns: string | string[],
    matchOptions?: MatchOptions
): Promise<CellLabelData[]> {
    const result: CellLabelData[] = [];
    console.log(
        `[matchCellLabels] Received ${importedRows.length} imported rows, ${sourceFiles.length} source files, ${targetFiles.length} target files. Label selector: ${Array.isArray(labelColumnOrColumns) ? labelColumnOrColumns.join(",") : labelColumnOrColumns}`
    );

    // Create a map of all cells by their start time, and also keep a sorted list for nearest match
    // CRITICAL: Now tracking fileUri to ensure labels go to the correct file
    const cellMap = new Map<
        number,
        { cellId: string; currentLabel?: string; fileUri: string; startTimeSeconds?: number; endTimeSeconds?: number; }
    >();
    // Also create an exact ID lookup for direct ID-based matching
    const idMap = new Map<string, { cellId: string; currentLabel?: string; fileUri: string; startTimeSeconds?: number; endTimeSeconds?: number; }>();
    // Optional: match using a specific metadata field
    const matchNumberMap = new Map<
        number,
        { cellId: string; currentLabel?: string; fileUri: string; startTimeSeconds?: number; endTimeSeconds?: number; }
    >();
    const matchStringMap = new Map<
        string,
        { cellId: string; currentLabel?: string; fileUri: string; startTimeSeconds?: number; endTimeSeconds?: number; }
    >();
    const matchNumberValues: number[] = [];
    const cellTimes: number[] = [];

    const normalizeTimestampSeconds = (value?: number): number | undefined => {
        if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
        // If timestamps are in ms, convert to seconds (guard for long recordings)
        if (value > 100000) return value / 1000;
        return value;
    };

    const matchColumn = matchOptions?.matchColumn?.toString().trim() || "";
    const matchFieldPath = matchOptions?.matchFieldPath?.toString().trim() || "";
    const hasMatchMapping = !!(matchColumn && matchFieldPath);
    const matchFieldPathLower = matchFieldPath.toLowerCase();
    const shouldUseMatchColumnForTime = hasMatchMapping && matchFieldPathLower.includes("time");

    const getMetadataValueByPath = (
        metadata: CellMetadata | undefined,
        path: string
    ): any => {
        if (!metadata || !path) return undefined;
        const normalizedPath = path.startsWith("metadata.")
            ? path.slice("metadata.".length)
            : path;
        if (!normalizedPath) return undefined;
        const parts = normalizedPath.split(".");
        let current: any = metadata;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            if (typeof current !== "object") return undefined;
            current = current[part];
        }
        return current;
    };

    // Extract all cells from source files and create a time-based lookup
    sourceFiles.forEach((file) => {
        file.cells.forEach((cell) => {
            if (cell.metadata?.id) {
                const cellId = cell.metadata.id;
                const fileUri = file.uri.fsPath;
                const metadata = cell.metadata as CellMetadata;
                const startTimeFromMetadata = normalizeTimestampSeconds(metadata?.data?.startTime);
                const endTimeFromMetadata = normalizeTimestampSeconds(metadata?.data?.endTime);

                const matchEntry = {
                    cellId,
                    currentLabel: metadata.cellLabel,
                    fileUri,
                    startTimeSeconds: startTimeFromMetadata,
                    endTimeSeconds: endTimeFromMetadata,
                };

                // Populate exact ID map (trim to be safe)
                idMap.set(String(cellId).trim(), {
                    cellId,
                    currentLabel: metadata.cellLabel,
                    fileUri,
                    startTimeSeconds: startTimeFromMetadata,
                    endTimeSeconds: endTimeFromMetadata,
                });

                if (hasMatchMapping) {
                    const matchValue = getMetadataValueByPath(metadata, matchFieldPath);
                    if (matchValue !== undefined && matchValue !== null) {
                        if (typeof matchValue === "number") {
                            const normalized = normalizeTimestampSeconds(matchValue);
                            if (normalized !== undefined && !matchNumberMap.has(normalized)) {
                                matchNumberMap.set(normalized, matchEntry);
                                matchNumberValues.push(normalized);
                            }
                        } else {
                            const asString = String(matchValue).trim();
                            if (asString && !matchStringMap.has(asString)) {
                                matchStringMap.set(asString, matchEntry);
                            }
                        }
                    }
                }

                // Prefer metadata timestamps for matching; fall back to parsing legacy cue IDs
                let startTimeSeconds = startTimeFromMetadata;
                let endTimeSeconds = endTimeFromMetadata;
                if (!startTimeSeconds) {
                    const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
                    if (timeMatch && timeMatch[1]) {
                        startTimeSeconds = parseFloat(timeMatch[1]);
                        endTimeSeconds = endTimeSeconds ?? parseFloat(timeMatch[2]);
                    }
                }

                if (startTimeSeconds) {
                    // For time-based matching, we store per timestamp (may conflict across files)
                    // but we'll prefer exact ID matches when available
                    if (!cellMap.has(startTimeSeconds)) {
                        cellMap.set(startTimeSeconds, {
                            cellId,
                            currentLabel: metadata.cellLabel,
                            fileUri,
                            startTimeSeconds,
                            endTimeSeconds,
                        });
                        cellTimes.push(startTimeSeconds);
                    }
                }
            }
        });
    });
    console.log(`[matchCellLabels] Populated cellMap with ${cellMap.size} cells from ${sourceFiles.length} files.`);
    cellTimes.sort((a, b) => a - b);
    matchNumberValues.sort((a, b) => a - b);

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

        const isMatchCandidate =
            hasMatchMapping &&
            row[matchColumn] !== undefined &&
            row[matchColumn] !== null &&
            row[matchColumn] !== "";

        if (isCue || hasExplicitId || isMatchCandidate) {
            // Find start time from best available source in this priority:
            // 1) user-mapped match column (when mapping to a time field)
            // 2) explicit numeric start field ("start")
            // 3) ID like "... cue-<start>-<end>"
            // 4) TIMESTAMP range like "50.634 --> 51.468"
            // 5) any time-like field
            let startTimeSeconds = 0;
            let startTimeDisplay = "";
            const rowKeys = Object.keys(row);

            if (shouldUseMatchColumnForTime) {
                const mappedValue = row[matchColumn];
                if (mappedValue !== undefined && mappedValue !== null && mappedValue !== "") {
                    startTimeDisplay = String(mappedValue);
                    if (typeof mappedValue === "number") {
                        startTimeSeconds = mappedValue;
                    } else {
                        startTimeSeconds = convertTimestampToSeconds(String(mappedValue));
                    }
                }
            }

            // 1) STARTTIME or START
            if (!startTimeSeconds && row["STARTTIME"]) {
                startTimeDisplay = row["STARTTIME"];
                startTimeSeconds = convertTimestampToSeconds(row["STARTTIME"] || "");
            } else if (!startTimeSeconds && row["START"]) {
                startTimeDisplay = row["START"];
                startTimeSeconds = convertTimestampToSeconds(row["START"] || "");
            } else if (!startTimeSeconds && typeof row["ID"] === "string") {
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

            if (!match && hasMatchMapping) {
                const mappedValue = row[matchColumn];
                if (mappedValue !== undefined && mappedValue !== null && mappedValue !== "") {
                    if (matchNumberValues.length > 0) {
                        let numericValue: number | undefined;
                        if (typeof mappedValue === "number") {
                            numericValue = mappedValue;
                        } else {
                            const parsed = convertTimestampToSeconds(String(mappedValue));
                            numericValue = parsed || undefined;
                        }
                        if (numericValue !== undefined) {
                            const normalized = normalizeTimestampSeconds(numericValue) ?? numericValue;
                            match = matchNumberMap.get(normalized);
                            if (!match) {
                                const hasMs =
                                    String(mappedValue).match(/[.,]\d{1,3}$/) ||
                                    String(numericValue).includes(".");
                                const threshold = hasMs ? 0.3 : 0.6; // seconds
                                let lo = 0,
                                    hi = matchNumberValues.length - 1;
                                while (lo <= hi) {
                                    const mid = (lo + hi) >> 1;
                                    if (matchNumberValues[mid] < normalized) lo = mid + 1;
                                    else hi = mid - 1;
                                }
                                const candidates: number[] = [];
                                if (lo < matchNumberValues.length) candidates.push(matchNumberValues[lo]);
                                if (lo - 1 >= 0) candidates.push(matchNumberValues[lo - 1]);

                                let bestTime: number | null = null;
                                let bestDiff = Number.POSITIVE_INFINITY;
                                for (const t of candidates) {
                                    const diff = Math.abs(t - normalized);
                                    if (diff < bestDiff && diff <= threshold) {
                                        bestDiff = diff;
                                        bestTime = t;
                                    }
                                }
                                if (bestTime !== null) {
                                    match = matchNumberMap.get(bestTime);
                                }
                            }
                        }
                    }

                    if (!match && matchStringMap.size > 0) {
                        const asString = String(mappedValue).trim();
                        if (asString) {
                            match = matchStringMap.get(asString);
                        }
                    }
                }
            }

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

            // Final fallback if we matched a UUID-based cell with metadata timestamps
            if (!startTimeDisplay && match?.startTimeSeconds) {
                startTimeDisplay = String(match.startTimeSeconds);
            }
            if (!endTimeDisplay && match?.endTimeSeconds) {
                endTimeDisplay = String(match.endTimeSeconds);
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
                sourceFileUri: match?.fileUri, // Track which file this cell belongs to
            });
        }
    });

    return result;
}
