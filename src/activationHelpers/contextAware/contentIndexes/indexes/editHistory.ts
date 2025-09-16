import * as vscode from "vscode";
import { FileData } from "./fileReaders";
import { getTargetFilesContent } from "./fileReaders";
import { EditType } from "../../../../../types/enums";
import { EditMapUtils } from "../../../../utils/editMapUtils";
interface Edit {
    cellValue: string;
    timestamp: number;
    type: EditType;
    author?: string;
    editMap?: readonly string[];
}

interface EditPair {
    llmGeneration: string;
    userEdit: string;
    sequenceNumber: number;
    llmTimestamp: number;
}

interface TimeSnapshot {
    period: string;
    averageDistance: number;
    numberOfEdits: number;
    timeRange: { start: number; end: number; };
}

/**
 * Strips HTML tags and their entity-encoded equivalents from a string.
 * This includes all standard HTML tags like <div>, <p>, <h1>, etc.
 * and their entity-encoded versions like &lt;div&gt;, &lt;p&gt;, &lt;h1&gt;, etc.
 * @param str The string to strip HTML tags from
 * @returns The string with all HTML tags and their entity-encoded versions removed
 */
function stripHtmlTags(str: string): string {
    // First, decode HTML entities to actual characters
    const decodedStr = str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

    // Then remove all HTML tags using a comprehensive regex
    // This regex matches any HTML tag (opening or closing) including attributes
    return decodedStr.replace(/<[^>]*>/g, '').trim();
}

function calculateLevenshteinDistance(str1: string, str2: string): number {
    // Strip HTML tags before calculating distance
    const cleanStr1 = stripHtmlTags(str1);
    const cleanStr2 = stripHtmlTags(str2);

    const m = cleanStr1.length;
    const n = cleanStr2.length;
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
            if (cleanStr1[i - 1] === cleanStr2[j - 1]) {
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

function calculateMeteorScore(llmText: string, userText: string): number {
    // Strip HTML tags before calculating METEOR score
    const cleanLlmText = stripHtmlTags(llmText);
    const cleanUserText = stripHtmlTags(userText);

    // Simple METEOR implementation focusing on exact matches and word order
    const llmWords = cleanLlmText.toLowerCase().split(/\s+/);
    const userWords = cleanUserText.toLowerCase().split(/\s+/);

    // Calculate exact matches
    const matches = llmWords.filter((word, i) => word === userWords[i]);

    // Calculate precision and recall
    const precision = matches.length / llmWords.length;
    const recall = matches.length / userWords.length;

    // Calculate F-mean with recall weighted 9 times more than precision
    const fMean = precision && recall ?
        (10 * precision * recall) / (recall + 9 * precision) : 0;

    // Penalty for differences in word order (simplified)
    const orderPenalty = 1 - (Math.abs(llmWords.length - userWords.length) / Math.max(llmWords.length, userWords.length));

    // Final METEOR score
    return fMean * orderPenalty;
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
 *   meteorScore: number;
 * }>} Analysis results showing edit distances and their progression over the sequence
 */
export async function analyzeEditHistory(): Promise<{
    editDistances: Array<{ sequenceNumber: number; distance: number; }>;
    averageEditDistance: number;
    timeSnapshots: TimeSnapshot[];
    rawDistances: Array<{
        sequenceNumber: number;
        distance: number;
        llmText: string;
        userText: string;
    }>;
    meteorScore: number;
}> {
    const targetFiles = await getTargetFilesContent();
    const editPairs: EditPair[] = [];
    let globalSequence = 0;

    // First, collect all user edits with their cell IDs and timestamps
    const allEdits: Array<{
        cellId: string;
        edit: Edit;
        llmGeneration: string | null;
        llmTimestamp: number | null;
    }> = [];

    // Collect all user edits and their context
    for (const file of targetFiles) {
        for (const cell of file.cells) {
            if (!cell.metadata?.edits || !cell.metadata?.id) continue;

            let currentLLM: string | null = null;
            let currentLLMTimestamp: number | null = null;

            for (const edit of cell.metadata.edits as Edit[]) {
                // Only process edits that affect the cell value (editMap: ["value"])
                if (edit.editMap && !EditMapUtils.isValue(edit.editMap)) {
                    continue;
                }

                if (edit.type === "llm-generation") {
                    currentLLM = edit.cellValue;
                    currentLLMTimestamp = edit.timestamp;
                    continue;
                }
                if (edit.type === "user-edit") {
                    allEdits.push({
                        cellId: cell.metadata.id,
                        edit: edit as Edit,
                        llmGeneration: currentLLM,
                        llmTimestamp: currentLLMTimestamp,
                    });
                }
            }
        }
    }

    // Sort all user edits chronologically by LLM generation time
    allEdits.sort((a, b) => (a.llmTimestamp ?? 0) - (b.llmTimestamp ?? 0));

    // Track the last edit for each cell ID
    let currentCellId: string | null = null;
    let currentEdits: Array<{
        userEdit: string;
        llmText: string;
        llmTimestamp: number;
    }> = [];

    // Process edits in chronological order
    for (let i = 0; i < allEdits.length; i++) {
        const current = allEdits[i];
        if (!current.llmGeneration || !current.llmTimestamp) continue;

        // Strip HTML tags from both LLM generation and user edit
        const strippedLlmGeneration = stripHtmlTags(current.llmGeneration);
        const strippedUserEdit = stripHtmlTags(current.edit.cellValue);

        // If the stripped texts are identical, skip this edit pair
        if (strippedLlmGeneration === strippedUserEdit) continue;

        // If we're switching to a new cell
        if (currentCellId !== null && currentCellId !== current.cellId) {
            // Add the last edit from the previous cell if it exists and has differences
            if (currentEdits.length > 0) {
                const lastEdit = currentEdits[currentEdits.length - 1];
                const strippedLastLlm = stripHtmlTags(lastEdit.llmText);
                const strippedLastUser = stripHtmlTags(lastEdit.userEdit);

                if (strippedLastLlm !== strippedLastUser) {
                    editPairs.push({
                        llmGeneration: lastEdit.llmText,
                        userEdit: lastEdit.userEdit,
                        sequenceNumber: globalSequence++,
                        llmTimestamp: lastEdit.llmTimestamp,
                    });
                }
            }
            // Reset current edits since we're moving to a new cell
            currentEdits = [];
        }

        // Update current cell tracking
        currentCellId = current.cellId;
        currentEdits.push({
            userEdit: current.edit.cellValue,
            llmText: current.llmGeneration,
            llmTimestamp: current.llmTimestamp,
        });

        // If this is the last edit overall, add it if it has differences
        if (i === allEdits.length - 1 && currentEdits.length > 0) {
            const lastEdit = currentEdits[currentEdits.length - 1];
            const strippedLastLlm = stripHtmlTags(lastEdit.llmText);
            const strippedLastUser = stripHtmlTags(lastEdit.userEdit);

            if (strippedLastLlm !== strippedLastUser) {
                editPairs.push({
                    llmGeneration: lastEdit.llmText,
                    userEdit: lastEdit.userEdit,
                    sequenceNumber: globalSequence++,
                    llmTimestamp: lastEdit.llmTimestamp,
                });
            }
        }
    }

    // Sort by LLM generation timestamp to get chronological order of generations
    editPairs.sort((a, b) => a.llmTimestamp - b.llmTimestamp);

    // Reassign sequence numbers after sorting by LLM timestamp
    editPairs.forEach((pair, index) => {
        pair.sequenceNumber = index;
    });

    // Calculate edit distances and create raw distances array
    const rawDistances = editPairs.map((pair) => ({
        sequenceNumber: pair.sequenceNumber,
        distance: calculateLevenshteinDistance(pair.llmGeneration, pair.userEdit),
        llmText: stripHtmlTags(pair.llmGeneration),
        userText: stripHtmlTags(pair.userEdit),
        timestamp: pair.llmTimestamp,
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
        return { editDistances, averageEditDistance, timeSnapshots: [], rawDistances: [], meteorScore: 0 };
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

    // Calculate METEOR score
    const meteorScores = editPairs.map(pair =>
        calculateMeteorScore(pair.llmGeneration, pair.userEdit)
    );
    const meteorScore = meteorScores.length > 0 ?
        meteorScores.reduce((sum, score) => sum + score, 0) / meteorScores.length : 0;

    return {
        editDistances,
        averageEditDistance,
        timeSnapshots,
        rawDistances,
        meteorScore,
    };
}
