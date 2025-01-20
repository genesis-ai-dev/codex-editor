import * as vscode from "vscode";
import { FileData } from "./fileReaders";
import { getTargetFilesContent } from "./fileReaders";

interface Edit {
    cellValue: string;
    timestamp: number;
    type: "llm-generation" | "user-edit";
}

interface EditPair {
    llmGeneration: string;
    userEdit: string;
    sequenceNumber: number;
}

interface TimeSnapshot {
    period: string;
    averageDistance: number;
    numberOfEdits: number;
    timeRange: { start: number; end: number };
}

function calculateLevenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
        .fill(null)
        .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
        dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] =
                    1 +
                    Math.min(
                        dp[i - 1][j], // deletion
                        dp[i][j - 1], // insertion
                        dp[i - 1][j - 1] // substitution
                    );
            }
        }
    }

    return dp[m][n];
}

/**
 * Analyzes the edit history to measure LLM adaptation to user preferences over sequential edits.
 *
 * This analysis treats the editing process as an assembly line where:
 * 1. The LLM makes predictions (generates translations)
 * 2. The user post-edits these predictions
 * 3. Each edit pair (LLM prediction + user edit) represents one unit in the assembly line
 *
 * The key insight is that the LLM should learn from user corrections over time:
 * - Early in the sequence: We expect larger edit distances as the LLM hasn't adapted
 * - Later in the sequence: We expect smaller edit distances as the LLM learns from previous corrections
 *
 * The analysis divides all edit pairs into three sequential groups (not time-based):
 * - First third: Initial phase where LLM is learning user preferences
 * - Middle third: Transition phase showing adaptation progress
 * - Final third: Latest phase showing current LLM performance
 *
 * A decreasing trend in edit distances across these phases indicates the LLM is successfully
 * learning from user corrections, leading to predictions that require less post-editing.
 *
 * Note: This is sequence-based, not time-based. The order of edits matters, not when they occurred.
 * This better reflects the LLM's learning curve regardless of gaps in editing sessions.
 *
 * @returns {Promise<{
 *   editDistances: Array<{ sequenceNumber: number; distance: number }>;
 *   averageEditDistance: number;
 *   timeSnapshots: TimeSnapshot[];
 *   rawDistances: Array<{
 *     sequenceNumber: number;
 *     distance: number;
 *     llmText: string;
 *     userText: string;
 *   }>;
 * }>} Analysis results showing edit distances and their progression over the sequence
 */
export async function analyzeEditHistory(): Promise<{
    editDistances: Array<{ sequenceNumber: number; distance: number }>;
    averageEditDistance: number;
    timeSnapshots: TimeSnapshot[];
    rawDistances: Array<{
        sequenceNumber: number;
        distance: number;
        llmText: string;
        userText: string;
    }>;
}> {
    const targetFiles = await getTargetFilesContent();
    const editPairs: (EditPair & { timestamp: number })[] = [];
    let globalSequence = 0;

    // Extract all edit pairs (llm-generation followed by user-edit)
    for (const file of targetFiles) {
        for (const cell of file.cells) {
            if (!cell.metadata?.edits) continue;

            const edits = cell.metadata.edits as Edit[];
            for (let i = 0; i < edits.length - 1; i++) {
                if (edits[i].type === "llm-generation" && edits[i + 1].type === "user-edit") {
                    editPairs.push({
                        llmGeneration: edits[i].cellValue,
                        userEdit: edits[i + 1].cellValue,
                        sequenceNumber: globalSequence++,
                        timestamp: edits[i + 1].timestamp,
                    });
                }
            }
        }
    }

    // Sort by timestamp to get chronological order of edits
    editPairs.sort((a, b) => a.timestamp - b.timestamp);

    // Reassign sequence numbers after sorting by timestamp
    editPairs.forEach((pair, index) => {
        pair.sequenceNumber = index;
    });

    // Calculate edit distances and create raw distances array
    const rawDistances = editPairs.map((pair) => ({
        sequenceNumber: pair.sequenceNumber,
        distance: calculateLevenshteinDistance(pair.llmGeneration, pair.userEdit),
        llmText: pair.llmGeneration,
        userText: pair.userEdit,
        timestamp: pair.timestamp,
    }));

    // Calculate edit distances for each pair (keep this for backward compatibility)
    const editDistances = rawDistances.map(({ sequenceNumber, distance }) => ({
        sequenceNumber,
        distance,
    }));

    // Calculate average edit distance
    const averageEditDistance =
        editDistances.length > 0
            ? editDistances.reduce((sum, curr) => sum + curr.distance, 0) / editDistances.length
            : 0;

    // Create sequence-based snapshots (not time-based)
    if (editPairs.length === 0) {
        return { editDistances, averageEditDistance, timeSnapshots: [], rawDistances: [] };
    }

    const totalEdits = editPairs.length;
    const segmentSize = Math.ceil(totalEdits / 3);

    const segments = [
        editPairs.slice(0, segmentSize),
        editPairs.slice(segmentSize, segmentSize * 2),
        editPairs.slice(segmentSize * 2),
    ];

    const timeSnapshots: TimeSnapshot[] = segments.map((segment, index) => {
        const distances = segment.map((pair) =>
            calculateLevenshteinDistance(pair.llmGeneration, pair.userEdit)
        );

        const averageDistance =
            distances.length > 0
                ? distances.reduce((sum, dist) => sum + dist, 0) / distances.length
                : 0;

        return {
            period: `Sequence ${index + 1}`,
            averageDistance,
            numberOfEdits: distances.length,
            timeRange: {
                start: segment[0]?.sequenceNumber ?? 0,
                end: segment[segment.length - 1]?.sequenceNumber ?? 0,
            },
        };
    });

    return {
        editDistances,
        averageEditDistance,
        timeSnapshots,
        rawDistances,
    };
}
