import { CellLabelData, FileData, ImportedRow, CellMetadata } from "./types";
import { convertTimestampToSeconds } from "./utils";

/**
 * Match imported labels with existing cell IDs
 */
export async function matchCellLabels(
    importedRows: ImportedRow[],
    sourceFiles: FileData[],
    targetFiles: FileData[],
    labelColumn: string
): Promise<CellLabelData[]> {
    const result: CellLabelData[] = [];

    // Create a map of all cells by their start time
    const cellMap = new Map<number, { cellId: string; currentLabel?: string }>();

    // Extract all cells from source files and create a time-based lookup
    sourceFiles.forEach((file) => {
        file.cells.forEach((cell) => {
            if (cell.metadata?.id) {
                const cellId = cell.metadata.id;

                // Extract the start time from the cell ID (e.g., "cue-25.192-29.029")
                const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
                if (timeMatch && timeMatch[1]) {
                    const startTimeSeconds = parseFloat(timeMatch[1]);
                    cellMap.set(startTimeSeconds, {
                        cellId,
                        currentLabel: (cell.metadata as CellMetadata).cellLabel,
                    });
                }
            }
        });
    });

    // Process each imported row
    importedRows.forEach((row) => {
        // Check if the row has a type field and it equals "cue"
        // If not, try to determine if this is a subtitle by other means
        const isCue =
            row.type === "cue" ||
            (row.start && row.end) || // Has time fields
            Object.keys(row).some((key) => key.toLowerCase().includes("time")); // Has time-related fields

        if (isCue) {
            // Find start time field - could be named differently
            let startField = "start";
            if (!row.start) {
                const possibleStarts = Object.keys(row).filter(
                    (key) =>
                        key.toLowerCase().includes("start") ||
                        key.toLowerCase().includes("begin") ||
                        key.toLowerCase().includes("from")
                );

                if (possibleStarts.length > 0) {
                    startField = possibleStarts[0];
                }
            }

            // Convert the imported row's start time to seconds
            const startTimeSeconds = convertTimestampToSeconds(row[startField] || "");

            // Find which field to use for the label based on user selection
            const labelValue = row[labelColumn] ? row[labelColumn].toString().trim() : "";

            // Skip empty labels
            if (!labelValue) {
                return;
            }

            // Try to find a matching cell
            // First, look for an exact time match
            let match = cellMap.get(startTimeSeconds);

            // If no exact match, look for the closest cell within a small threshold (e.g., 0.5 seconds)
            if (!match) {
                const threshold = 0.5; // 0.5 second threshold
                let closestDiff = threshold;
                let closestCell: { cellId: string; currentLabel?: string } | undefined;

                cellMap.forEach((cell, time) => {
                    const diff = Math.abs(time - startTimeSeconds);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        closestCell = cell;
                    }
                });

                match = closestCell;
            }

            // Determine end time field
            let endField = "end";
            if (!row.end) {
                const possibleEnds = Object.keys(row).filter(
                    (key) =>
                        key.toLowerCase().includes("end") ||
                        key.toLowerCase().includes("stop") ||
                        key.toLowerCase().includes("to")
                );

                if (possibleEnds.length > 0) {
                    endField = possibleEnds[0];
                }
            }

            result.push({
                cellId: match?.cellId || "",
                startTime: row[startField] || "",
                endTime: row[endField] || "",
                character: row.character || row.CHARACTER || "",
                dialogue: row.dialogue || row.DIALOGUE || "",
                newLabel: labelValue,
                currentLabel: match?.currentLabel,
                matched: !!match,
            });
        }
    });

    return result;
}
