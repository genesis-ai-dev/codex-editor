import * as vscode from "vscode";
import { ChatMessage } from "../../types";
import type { CompletionConfig } from "./llmUtils";
import { callLLM } from "./llmUtils";

export interface ABTestResult {
    testId: string;
    cellId: string;
    timestamp: number;
    variants: string[];
    names?: string[]; // optional names/labels for each variant
    selectedIndex?: number;
    selectionTimeMs?: number;
}

// Simple variant generation: call LLM N times with identical config/messages
export async function generateABTestVariants(
    messages: ChatMessage[],
    config: CompletionConfig,
    variantCount: number = 2,
    cancellationToken?: vscode.CancellationToken
): Promise<string[]> {
    const variants: string[] = [];
    for (let i = 0; i < Math.max(2, variantCount); i++) {
        try {
            const result = await callLLM(messages, config, cancellationToken);
            variants.push(result);
        } catch (error) {
            console.error(`A/B testing variant ${i + 1} failed:`, error);
        }
    }
    // De-duplicate while preserving order, ensure at least 2 if possible
    const seen = new Set<string>();
    const unique = variants.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
    return unique.length >= 2 ? unique.slice(0, variantCount) : variants.slice(0, variantCount);
}

/**
 * Store A/B test result for analysis
 */
export async function storeABTestResult(result: ABTestResult): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.warn("No workspace folder found for storing A/B test results");
            return;
        }

        const abTestPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "files", "ab-test-results.jsonl");
        
        // Append new result as JSONL (no read-modify-write to keep simple/fast)
        const newLine = new TextEncoder().encode(JSON.stringify(result) + "\n");
        try {
            const existing = await vscode.workspace.fs.readFile(abTestPath);
            const combined = new Uint8Array(existing.length + newLine.length);
            combined.set(existing, 0);
            combined.set(newLine, existing.length);
            await vscode.workspace.fs.writeFile(abTestPath, combined);
        } catch {
            await vscode.workspace.fs.writeFile(abTestPath, newLine);
        }
        
        console.log(`A/B test result stored for cell ${result.cellId}`);
    } catch (error) {
        console.error("Failed to store A/B test result:", error);
    }
}

/**
 * Record user's variant selection
 */
export async function recordVariantSelection(
    testId: string,
    cellId: string,
    selectedIndex: number,
    selectionTimeMs: number,
    names?: string[],
    testName?: string
): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const abTestPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "files", "ab-test-results.jsonl");
        // Append a compact selection line separate from creation
        const selectionRecord = {
            testId,
            cellId,
            timestamp: Date.now(),
            selectedIndex,
            selectionTimeMs,
            names
        };
        const newLine = new TextEncoder().encode(JSON.stringify(selectionRecord) + "\n");
        try {
            const existing = await vscode.workspace.fs.readFile(abTestPath);
            const combined = new Uint8Array(existing.length + newLine.length);
            combined.set(existing, 0);
            combined.set(newLine, existing.length);
            await vscode.workspace.fs.writeFile(abTestPath, combined);
        } catch {
            await vscode.workspace.fs.writeFile(abTestPath, newLine);
        }
        console.log(`Recorded variant selection for test ${testId} cell ${cellId}: variant ${selectedIndex}`);

        // Post selection to external analytics if we have variant names
        try {
            if (Array.isArray(names) && typeof selectedIndex === "number" && names[selectedIndex]) {
                const { recordAbEvent, recordAbResult } = await import("./abTestingAnalytics");
                const variantName = names[selectedIndex];

                // Use the test name directly - no pattern matching needed
                if (!testName) {
                    return; // Skip analytics if no test name provided
                }

                // Event: selection counts as a conversion for the chosen variant
                await recordAbEvent({
                    testName: testName,
                    variant: variantName,
                    outcome: true,
                });
                // Result: declare the chosen variant as the winner for this run
                await recordAbResult({
                    category: testName,
                    options: names,
                    winner: selectedIndex,
                });
            }
        } catch (analyticsError) {
            console.warn("[A/B] Failed to post analytics", analyticsError);
        }
    } catch (error) {
        console.error("Failed to record variant selection:", error);
    }
}
