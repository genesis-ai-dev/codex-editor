import { ImporterPlugin, CellAligner, AlignedCell, ImportedContent } from "../../types/plugin";
import { Play } from "lucide-react";
import { SubtitlesImporterForm } from "./SubtitlesImporterForm";

/**
 * Generate a random ID for child cells
 */
const generateRandomId = (): string => {
    return Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
};

/**
 * Create empty imported content for unmatched target cells
 */
const createEmptyImportedContent = (targetId: string): ImportedContent => ({
    id: targetId,
    content: "",
    startTime: undefined,
    endTime: undefined,
});

/**
 * Helper function to convert timestamps to seconds
 */
const convertToSeconds = (timestamp: string | number | undefined): number => {
    if (!timestamp) return 0;
    if (typeof timestamp === "number") return timestamp;

    // Handle VTT timestamp format (HH:MM:SS.mmm)
    const [time, milliseconds] = timestamp.split(".");
    const [hours, minutes, seconds] = time.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(milliseconds || 0) / 1000;
};

/**
 * Helper function to calculate temporal overlap
 */
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

/**
 * Calculate alignment confidence between target cell and imported content
 */
const calculateAlignmentConfidence = (
    targetCell: any,
    imported: ImportedContent,
    targetIndex: number,
    importedIndex: number
): number => {
    let confidence = 0;

    // Temporal overlap confidence (primary factor)
    const targetStart = convertToSeconds(targetCell.metadata?.data?.startTime);
    const targetEnd = convertToSeconds(targetCell.metadata?.data?.endTime);
    const importStart = convertToSeconds(imported.startTime);
    const importEnd = convertToSeconds(imported.endTime);

    if (targetStart && targetEnd && importStart && importEnd) {
        const overlap = calculateOverlap(targetStart, targetEnd, importStart, importEnd);
        const targetDuration = targetEnd - targetStart;
        const importDuration = importEnd - importStart;
        const avgDuration = (targetDuration + importDuration) / 2;

        if (overlap > 0 && avgDuration > 0) {
            confidence += Math.min(0.7, (overlap / avgDuration) * 0.7); // Up to 70% from temporal overlap
        }
    }

    // Positional proximity confidence (secondary factor)
    const positionDiff = Math.abs(targetIndex - importedIndex);
    confidence += Math.max(0, 0.2 - positionDiff * 0.02); // Up to 20% from position proximity

    // Content length similarity (tertiary factor)
    if (targetCell.content && imported.content) {
        const targetLen = targetCell.content.length;
        const importLen = imported.content.length;
        const lengthSimilarity =
            1 - Math.abs(targetLen - importLen) / Math.max(targetLen, importLen, 1);
        confidence += lengthSimilarity * 0.1; // Up to 10% from length similarity
    }

    return Math.min(1.0, confidence);
};

/**
 * Simplified alignment function for subtitles that preserves temporal order
 * by processing imported content sequentially (like the old implementation)
 */
const subtitlesCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];
    let totalOverlaps = 0;

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

    const usedImportedIndices = new Set<number>();

    // Debug logging: Show first 20 target cells with timestamps
    console.log("=== TARGET CELLS (first 20) ===");
    targetCells.slice(0, 20).forEach((cell, i) => {
        const startTime = convertToSeconds(cell.metadata?.data?.startTime);
        const endTime = convertToSeconds(cell.metadata?.data?.endTime);
        console.log(
            `Target ${i}: ${
                cell.metadata?.id
            } | ${startTime}s-${endTime}s | "${cell.value?.substring(0, 50)}..."`
        );
    });

    // Debug logging: Show first 20 imported content with timestamps
    console.log("=== IMPORTED CONTENT (first 20) ===");
    importedContent.slice(0, 20).forEach((item, i) => {
        const startTime = convertToSeconds(item.startTime);
        const endTime = convertToSeconds(item.endTime);
        console.log(
            `Import ${i}: ${item.id} | ${startTime}s-${endTime}s | "${item.content?.substring(
                0,
                50
            )}..."`
        );
    });

    // Process each target cell in order to maintain temporal sequence
    for (const targetCell of targetCells) {
        const targetStart =
            typeof targetCell.metadata?.data?.startTime === "string"
                ? parseFloat(targetCell.metadata.data.startTime)
                : targetCell.metadata?.data?.startTime;
        const targetEnd =
            typeof targetCell.metadata?.data?.endTime === "string"
                ? parseFloat(targetCell.metadata.data.endTime)
                : targetCell.metadata?.data?.endTime;

        if (!targetStart || !targetEnd) continue;

        // Find all imported items that overlap with this target cell
        const overlappingImports = importedContent
            .map((item, index) => ({ item, index }))
            .filter(({ item, index }) => {
                if (usedImportedIndices.has(index) || !item.content.trim()) return false;

                const importStart = convertToSeconds(item.startTime);
                const importEnd = convertToSeconds(item.endTime);

                if (isNaN(importStart) || isNaN(importEnd)) return false;

                // Normalize timestamps before checking overlap
                const normalized = normalizeTimestamps(
                    targetStart,
                    targetEnd,
                    importStart,
                    importEnd
                );

                const overlap = calculateOverlap(
                    normalized.sourceStart,
                    normalized.sourceEnd,
                    normalized.targetStart,
                    normalized.targetEnd
                );

                return overlap > 0;
            });

        // Add the first as primary match, others as children
        overlappingImports.forEach(({ item, index }, i) => {
            usedImportedIndices.add(index);
            const targetId = targetCell.metadata.id;

            if (i === 0) {
                // First match - use target ID
                alignedCells.push({
                    notebookCell: targetCell,
                    importedContent: { ...item, id: targetId },
                    alignmentMethod: "timestamp",
                    confidence: calculateAlignmentConfidence(targetCell, item, 0, 0),
                });
            } else {
                // Additional matches - create child cells
                alignedCells.push({
                    notebookCell: targetCell,
                    importedContent: {
                        ...item,
                        id: `${targetId}:${generateRandomId()}`,
                    },
                    isAdditionalOverlap: true,
                    alignmentMethod: "timestamp",
                    confidence: calculateAlignmentConfidence(targetCell, item, 0, i),
                });
            }
            totalOverlaps++;
        });
    }

    // Now add any unmatched imported items as paratext in their correct temporal positions
    const remainingImports = importedContent
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) => !usedImportedIndices.has(index) && item.content.trim());

    // Insert paratext items in their correct temporal positions
    for (const { item } of remainingImports) {
        const importStart = convertToSeconds(item.startTime);

        // Find the correct position to insert based on temporal order
        let insertIndex = alignedCells.findIndex((cell) => {
            const cellStart = convertToSeconds(cell.importedContent.startTime);
            return cellStart > importStart;
        });

        if (insertIndex === -1) insertIndex = alignedCells.length;

        // Determine the document name and section ID from nearby cells
        let documentName = "";
        let sectionId = "1"; // Default to section 1

        // Look for the nearest aligned cell (before or after) to get document/section info
        const nearestCellBefore = alignedCells[insertIndex - 1];
        const nearestCellAfter = alignedCells[insertIndex];

        const nearestCell = nearestCellBefore || nearestCellAfter;
        if (nearestCell && nearestCell.notebookCell) {
            const nearestCellId = nearestCell.notebookCell.metadata?.id || "";
            const idParts = nearestCellId.split(" ");
            if (idParts.length >= 2) {
                documentName = idParts[0];
                const sectionParts = idParts[1].split(":");
                if (sectionParts.length >= 1) {
                    sectionId = sectionParts[0];
                }
            }
        }

        // If we couldn't find document info from nearby cells, extract from first target cell
        if (!documentName && targetCells.length > 0) {
            const firstTargetId = targetCells[0].metadata?.id || "";
            const idParts = firstTargetId.split(" ");
            if (idParts.length >= 2) {
                documentName = idParts[0];
            }
        }

        const paratextId = documentName
            ? `${documentName} ${sectionId}:paratext-${generateRandomId()}`
            : `paratext-${generateRandomId()}`; // Fallback if no document info found

        alignedCells.splice(insertIndex, 0, {
            notebookCell: null,
            importedContent: {
                ...item,
                id: paratextId,
            },
            isParatext: true,
            alignmentMethod: "timestamp",
            confidence: 0.0,
        });
    }

    // Only throw if we found no overlaps at all
    if (totalOverlaps === 0 && importedContent.length > 0) {
        throw new Error("No overlapping content found. Please check the selected file.");
    }

    // Debug logging: Show final aligned cells order
    console.log("=== FINAL ALIGNED CELLS ORDER ===");
    alignedCells.forEach((cell, i) => {
        const startTime = convertToSeconds(cell.importedContent.startTime);
        const isParatext = cell.isParatext ? " [PARATEXT]" : "";
        const isChild = cell.isAdditionalOverlap ? " [CHILD]" : "";
        console.log(
            `Aligned ${i}: ${
                cell.importedContent.id
            } | ${startTime}s | "${cell.importedContent.content?.substring(
                0,
                50
            )}..."${isParatext}${isChild}`
        );
    });

    console.log(
        `Simplified subtitle aligner: ${totalOverlaps} overlaps found, ${
            alignedCells.filter((c) => c.isParatext).length
        } paratext items`
    );

    return alignedCells;
};

export const subtitlesImporterPlugin: ImporterPlugin = {
    id: "subtitles",
    name: "Subtitle Files",
    description: "Import VTT/SRT subtitle files with timestamp-based cells",
    icon: Play,
    component: SubtitlesImporterForm,
    cellAligner: subtitlesCellAligner,
    supportedExtensions: ["vtt", "srt"],
    enabled: true,
    tags: ["Media", "Timed"],
};
