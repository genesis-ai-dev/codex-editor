import { ImporterPlugin, CellAligner, AlignedCell, ImportedContent } from "../../types/plugin";
import { Play } from "lucide-react";
import { SubtitlesImporterForm } from "./SubtitlesImporterForm";

/**
 * Custom alignment function for subtitles using volume-overlap technique
 * Matches subtitle translations based on temporal overlap, accounting for timing differences
 */
const subtitlesCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];
    let totalOverlaps = 0;
    const sourceCellOverlapCount: { [key: string]: number } = {};

    // Helper function to convert timestamps to seconds
    const convertToSeconds = (timestamp: string | number | undefined): number => {
        if (!timestamp) return 0;
        if (typeof timestamp === "number") return timestamp;

        // Handle VTT timestamp format (HH:MM:SS.mmm)
        const [time, milliseconds] = timestamp.split(".");
        const [hours, minutes, seconds] = time.split(":").map(Number);
        return hours * 3600 + minutes * 60 + seconds + Number(milliseconds || 0) / 1000;
    };

    // Helper function to calculate temporal overlap
    const calculateOverlap = (
        sourceStart: number,
        sourceEnd: number,
        targetStart: number,
        targetEnd: number
    ): number => {
        const overlapStart = Math.max(sourceStart, targetStart);
        const overlapEnd = Math.min(sourceEnd, targetEnd);
        return Math.max(0, overlapEnd - overlapStart);
    };

    // Normalize timestamps to handle hour offsets
    const normalizeTimestamps = (
        sourceStart: number,
        sourceEnd: number,
        targetStart: number,
        targetEnd: number
    ) => {
        const hourInSeconds = 3600;
        const sourceMidpoint = (sourceStart + sourceEnd) / 2;
        const targetMidpoint = (targetStart + targetEnd) / 2;
        const difference = Math.abs(sourceMidpoint - targetMidpoint);

        if (difference > hourInSeconds / 2) {
            const hourOffset = Math.round(difference / hourInSeconds) * hourInSeconds;
            if (sourceMidpoint > targetMidpoint) {
                return {
                    sourceStart: sourceStart - hourOffset,
                    sourceEnd: sourceEnd - hourOffset,
                    targetStart,
                    targetEnd,
                };
            } else {
                return {
                    sourceStart,
                    sourceEnd,
                    targetStart: targetStart - hourOffset,
                    targetEnd: targetEnd - hourOffset,
                };
            }
        }

        return { sourceStart, sourceEnd, targetStart, targetEnd };
    };

    for (const importedItem of importedContent) {
        if (!importedItem.content.trim()) continue;

        const importStart = convertToSeconds(importedItem.startTime);
        const importEnd = convertToSeconds(importedItem.endTime);
        let foundOverlap = false;

        // Try to find an overlapping cell in the target notebook
        const targetCell = targetCells.find((cell) => {
            const targetStart = convertToSeconds(cell.metadata?.data?.startTime);
            const targetEnd = convertToSeconds(cell.metadata?.data?.endTime);

            if (!targetStart || !targetEnd || isNaN(importStart) || isNaN(importEnd)) {
                return false;
            }

            // Normalize timestamps before checking overlap
            const normalized = normalizeTimestamps(targetStart, targetEnd, importStart, importEnd);

            const overlap = calculateOverlap(
                normalized.sourceStart,
                normalized.sourceEnd,
                normalized.targetStart,
                normalized.targetEnd
            );

            if (overlap > 0) {
                foundOverlap = true;
                return true;
            }
            return false;
        });

        if (targetCell) {
            // Handle overlapping content
            const targetId = targetCell.metadata.id;
            if (!sourceCellOverlapCount[targetId]) {
                sourceCellOverlapCount[targetId] = 1;
                alignedCells.push({
                    notebookCell: targetCell,
                    importedContent: { ...importedItem, id: targetId },
                });
            } else {
                sourceCellOverlapCount[targetId]++;
                // Generate child cell ID for additional overlaps
                const childId = `${targetId}-${sourceCellOverlapCount[targetId]}`;
                alignedCells.push({
                    notebookCell: targetCell,
                    importedContent: { ...importedItem, id: childId },
                    isAdditionalOverlap: true,
                });
            }
            totalOverlaps++;
        } else {
            // Create paratext for non-overlapping content
            alignedCells.push({
                notebookCell: null,
                importedContent: {
                    ...importedItem,
                    id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                },
                isParatext: true,
            });
        }
    }

    // Only throw if we found no overlaps at all
    if (totalOverlaps === 0 && importedContent.length > 0) {
        throw new Error("No overlapping content found. Please check the selected file.");
    }

    return alignedCells;
};

export const subtitlesImporterPlugin: ImporterPlugin = {
    id: "subtitles",
    name: "Subtitle Files",
    description: "Import VTT/SRT subtitle files with timestamp-based cells",
    icon: Play,
    component: SubtitlesImporterForm,
    cellAligner: subtitlesCellAligner, // Add custom alignment function
    supportedExtensions: ["vtt", "srt"],
    enabled: true,
    tags: ["Media", "Timed"],
};
