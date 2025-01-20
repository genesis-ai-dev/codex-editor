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

export async function analyzeEditHistory(): Promise<{
    editDistances: Array<{ sequenceNumber: number; distance: number }>;
    averageEditDistance: number;
}> {
    const targetFiles = await getTargetFilesContent();
    const editPairs: EditPair[] = [];
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
                    });
                }
            }
        }
    }

    // Calculate edit distances for each pair
    const editDistances = editPairs.map((pair) => ({
        sequenceNumber: pair.sequenceNumber,
        distance: calculateLevenshteinDistance(pair.llmGeneration, pair.userEdit),
    }));

    // Calculate average edit distance
    const averageEditDistance =
        editDistances.length > 0
            ? editDistances.reduce((sum, curr) => sum + curr.distance, 0) / editDistances.length
            : 0;

    return {
        editDistances,
        averageEditDistance,
    };
}
