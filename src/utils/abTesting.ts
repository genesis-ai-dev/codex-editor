/**
 * Consolidated A/B Testing utilities
 * Combines: abTestingRegistry, abTestingAnalytics, abTestingUtils, abTestingSetup
 */

import * as vscode from "vscode";
import { callLLM } from "./llmUtils";
import type { TranslationPair } from "../../types";
import type { CompletionConfig } from "./llmUtils";
import { buildFewShotExamplesText, buildMessages } from "../providers/translationSuggestions/shared";

// ============================================================================
// Registry
// ============================================================================

type ABTestResultPayload<TVariant> = TVariant[] | { variants: TVariant[]; names?: string[] };
type ABTestHandler<TContext, TVariant> = (context: TContext) => Promise<ABTestResultPayload<TVariant>>;

interface ABTestEntry<TContext, TVariant> {
    name: string;
    probability: number; // 0..1
    handler: ABTestHandler<TContext, TVariant>;
}

class ABTestingRegistry {
    private tests = new Map<string, ABTestEntry<unknown, unknown>>();

    register<TContext, TVariant>(
        name: string,
        probability: number,
        handler: ABTestHandler<TContext, TVariant>
    ): void {
        const clamped = Math.max(0, Math.min(1, probability));
        this.tests.set(name, { name, probability: clamped, handler: handler as ABTestHandler<unknown, unknown> });
    }

    get<TContext, TVariant>(name: string): ABTestEntry<TContext, TVariant> | undefined {
        return this.tests.get(name) as ABTestEntry<TContext, TVariant> | undefined;
    }

    shouldRun(name: string): boolean {
        const entry = this.tests.get(name);
        if (!entry) return false;
        const rnd = Math.random();
        return rnd < entry.probability;
    }

    async maybeRun<TContext, TVariant>(
        name: string,
        context: TContext
    ): Promise<{ variants: TVariant[]; names?: string[]; testName?: string } | null> {
        const entry = this.tests.get(name) as ABTestEntry<TContext, TVariant> | undefined;
        if (!entry) return null;
        if (!this.shouldRun(name)) return null;
        try {
            const result = await entry.handler(context);
            if (Array.isArray(result)) {
                return { variants: result, testName: entry.name };
            }
            return { ...result, testName: entry.name };
        } catch (err) {
            console.error(`[ABTestingRegistry] Test '${name}' failed`, err);
            return null;
        }
    }
}

export const abTestingRegistry = new ABTestingRegistry();
export type { ABTestHandler };

// ============================================================================
// Analytics
// ============================================================================

const ANALYTICS_BASE = "https://zero.codexeditor.app";

async function postJson(path: string, payload: Record<string, unknown>): Promise<void> {
    try {
        await fetch(`${ANALYTICS_BASE}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        console.warn(`[ABTestingAnalytics] POST ${path} failed`, err);
    }
}

function getOptionalContext() {
    try {
        const pm = vscode.workspace.getConfiguration("codex-project-manager");
        const userEmail = pm.get<string>("userEmail") || undefined;
        const userName = pm.get<string>("userName") || undefined;
        const projectName = pm.get<string>("projectName") || undefined;
        return { userId: userEmail || userName, projectId: projectName };
    } catch {
        return {} as { userId?: string; projectId?: string };
    }
}

export async function recordAbResult(args: {
    category: string;
    options: string[];
    winner: number; // 0-based
    userId?: string | number;
    projectId?: string | number;
}): Promise<void> {
    const extras = getOptionalContext();
    const body: Record<string, unknown> = {
        category: args.category,
        options: args.options,
        winner: args.winner,
    };
    if (args.userId ?? extras.userId) body.user_id = args.userId ?? extras.userId;
    if (args.projectId ?? extras.projectId) body.project_id = args.projectId ?? extras.projectId;
    await postJson("/analytics/result", body);
}

// ============================================================================
// Variant Selection Recording
// ============================================================================

/**
 * Record user's variant selection to cloud analytics
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
        console.log(`Recording variant selection for test ${testId} cell ${cellId}: variant ${selectedIndex}`);

        // Post selection to cloud analytics if we have variant names
        if (Array.isArray(names) && typeof selectedIndex === "number" && names[selectedIndex] && testName) {
            await recordAbResult({
                category: testName,
                options: names,
                winner: selectedIndex,
            });

            console.log(`A/B test result sent to cloud: ${testName} - winner: ${names[selectedIndex]}`);
        }
    } catch (error) {
        console.warn("[A/B] Failed to record variant selection:", error);
    }
}

// ============================================================================
// Test Setup & Context
// ============================================================================

// Context for A/B tests
interface ABTestContext {
    vscodeWorkspaceConfig?: { get: (key: string) => unknown };
    executeCommand: <T = unknown>(command: string, ...rest: unknown[]) => Thenable<T>;
    currentCellId: string;
    currentCellSourceContent: string;
    numberOfFewShotExamples: number;
    useOnlyValidatedExamples: boolean;
    allowHtmlPredictions: boolean;
    fewShotExampleFormat: string;
    targetLanguage: string | null;
    systemMessage: string;
    userMessageInstructions: string;
    precedingTranslationPairs: (string | null)[];
    completionConfig: CompletionConfig;
    token?: vscode.CancellationToken;
}

// Helper function to fetch translation pairs using SBS algorithm
async function fetchTranslationPairs(
    executeCommand: <T = unknown>(command: string, ...rest: unknown[]) => Thenable<T>,
    sourceContent: string,
    count: number,
    useOnlyValidatedExamples: boolean
): Promise<TranslationPair[]> {
    return await executeCommand<TranslationPair[]>(
        "codex-editor-extension.getTranslationPairsFromSourceCellQuery",
        sourceContent,
        Math.max(count, 2),
        useOnlyValidatedExamples
    );
}

// Helper function to generate LLM completion from translation pairs
async function generateCompletionFromPairs(
    pairs: TranslationPair[],
    count: number,
    ctx: ABTestContext
): Promise<string> {
    const examplePairs = (pairs || []).slice(0, count);

    const examplesText = buildFewShotExamplesText(
        examplePairs,
        ctx.allowHtmlPredictions,
        "source-and-target" // Always use source-and-target format
    );

    const msgs = buildMessages(
        ctx.targetLanguage,
        ctx.systemMessage,
        ctx.userMessageInstructions.split("\n"),
        examplesText,
        ctx.precedingTranslationPairs,
        ctx.currentCellSourceContent,
        ctx.allowHtmlPredictions,
        "source-and-target"
    );

    return await callLLM(msgs, ctx.completionConfig, ctx.token);
}

export function initializeABTesting() {
    // A/B testing setup
    // Previous tests removed after conclusive results:
    // - Search Algorithm: SBS won 71.5% vs FTS5-BM25 28.5% (822 tests)
    // - Source vs Target: source-and-target won 55.1% vs target-only 44.9% (405 tests)
    // - Example Count 15 vs 30: No significant difference (52.1% vs 47.9%, 71 tests)
    // - SBS Efficiency: SBS 15 tied FTS5-BM25 30 (50.6% vs 49.4%, 79 tests)
    //
    // Current defaults: SBS algorithm, 15 examples, source-and-target format
    //
    // Remaining test: Validate that 15 examples is sufficient with more data

    abTestingRegistry.register<ABTestContext, string>(
        "Example Count Test",
        1.0,
        async (ctx) => {
            const counts = [15, 30];

            // Fetch enough pairs for the larger count
            const maxCount = Math.max(...counts);
            const pairs = await fetchTranslationPairs(
                ctx.executeCommand,
                ctx.currentCellSourceContent,
                maxCount,
                ctx.useOnlyValidatedExamples
            );

            const runForCount = async (count: number): Promise<string> => {
                return await generateCompletionFromPairs(pairs, count, ctx);
            };

            // Run concurrently using Promise.all for improved performance
            const [compA, compB] = await Promise.all([runForCount(counts[0]), runForCount(counts[1])]);

            return {
                variants: [compA, compB],
                names: ["15 examples", "30 examples"],
            };
        }
    );
}
