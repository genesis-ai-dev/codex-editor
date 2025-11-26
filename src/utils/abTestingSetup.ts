import { abTestingRegistry } from "./abTestingRegistry";
import { callLLM } from "./llmUtils";
import type * as vscode from "vscode";
import type { TranslationPair } from "../../types";
import type { CompletionConfig } from "./llmUtils";
import { buildFewShotExamplesText, buildMessages } from "../providers/translationSuggestions/shared";

// Helper function to fetch translation pairs using SBS algorithm
async function fetchTranslationPairs(
  executeCommand: <T = any>(command: string, ...rest: any[]) => Thenable<T>,
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

      // Run sequentially to avoid concurrent API request limits
      const compA = await runForCount(counts[0]);
      const compB = await runForCount(counts[1]);

      return {
        variants: [compA, compB],
        names: ["15 examples", "30 examples"]
      };
    }
  );
}

// Context for A/B tests
interface ABTestContext {
  vscodeWorkspaceConfig?: { get: (key: string) => unknown };
  executeCommand: <T = any>(command: string, ...rest: any[]) => Thenable<T>;
  currentCellId: string;
  currentCellSourceContent: string;
  numberOfFewShotExamples: number;
  useOnlyValidatedExamples: boolean;
  allowHtmlPredictions: boolean;
  fewShotExampleFormat: string;
  targetLanguage: string | null;
  systemMessage: string;
  userMessageInstructions: string;
  precedingTranslationPairs: any[];
  completionConfig: CompletionConfig;
  token?: vscode.CancellationToken;
}
