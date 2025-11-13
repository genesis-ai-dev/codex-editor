import { abTestingRegistry } from "./abTestingRegistry";
import { callLLM } from "./llmUtils";
import type * as vscode from "vscode";
import type { TranslationPair } from "../../types";
import type { CompletionConfig } from "./llmUtils";
import { buildFewShotExamplesText, buildMessages } from "../providers/translationSuggestions/shared";

// Helper function to fetch translation pairs using a specific algorithm
async function fetchTranslationPairs(
  executeCommand: <T = any>(command: string, ...rest: any[]) => Thenable<T>,
  algorithm: string,
  sourceContent: string,
  count: number,
  useOnlyValidatedExamples: boolean
): Promise<TranslationPair[]> {
  return await executeCommand<TranslationPair[]>(
    "codex-editor-extension.getTranslationPairsFromSourceCellQueryWithAlgorithm",
    algorithm,
    sourceContent,
    Math.max(count, 2),
    useOnlyValidatedExamples
  );
}

// Helper function to generate LLM completion from translation pairs
async function generateCompletionFromPairs(
  pairs: TranslationPair[],
  count: number,
  format: "source-and-target" | "target-only",
  ctx: SearchAlgorithmContext
): Promise<string> {
  const examplePairs = (pairs || []).slice(0, count);
  
  const examplesText = buildFewShotExamplesText(
    examplePairs,
    ctx.allowHtmlPredictions,
    format
  );

  const msgs = buildMessages(
    ctx.targetLanguage,
    ctx.systemMessage,
    ctx.userMessageInstructions.split("\n"),
    examplesText,
    ctx.precedingTranslationPairs,
    ctx.currentCellSourceContent,
    ctx.allowHtmlPredictions,
    format
  );
  
  return await callLLM(msgs, ctx.completionConfig, ctx.token);
}

export function initializeABTesting() {
  // All test probabilities are set to 1.0; global gating is applied at call sites.
  // NOTE: The model comparison test (gpt-4o vs gpt-5) is intentionally disabled for now.
  // If needed later, restore the registration block for "llmGeneration".

  // Search algorithm comparison test (fts5-bm25 vs sbs) for few-shot retrieval
  abTestingRegistry.register<SearchAlgorithmContext, string>(
    "Search Algorithm Test",
    1.0,
    async (ctx) => {
      const extConfig = ctx.vscodeWorkspaceConfig ?? undefined;
      const currentAlg = (extConfig?.get?.("searchAlgorithm") as string) || "fts5-bm25";
      const altAlg = currentAlg === "sbs" ? "fts5-bm25" : "sbs";
      const format = ctx.fewShotExampleFormat || "source-and-target";
      const count = ctx.numberOfFewShotExamples;

      const fetchForAlg = async (alg: string): Promise<string> => {
        const pairs = await fetchTranslationPairs(
          ctx.executeCommand,
          alg,
          ctx.currentCellSourceContent,
          count,
          ctx.useOnlyValidatedExamples
        );
        return await generateCompletionFromPairs(pairs, count, format, ctx);
      };

      const [compA, compB] = await Promise.all([
        fetchForAlg(currentAlg),
        fetchForAlg(altAlg),
      ]);

      return { variants: [compA, compB], names: [currentAlg, altAlg] };
    }
  );

  // Few-shot example format test: source-and-target vs target-only
  abTestingRegistry.register<SearchAlgorithmContext, string>(
    "Source vs Target Inclusion",
    1.0,
    async (ctx) => {
      const formats: Array<"source-and-target" | "target-only"> = [
        "source-and-target",
        "target-only",
      ];

      // Reuse pairs from the user's configured searchAlgorithm
      const currentAlg = (ctx.vscodeWorkspaceConfig?.get?.("searchAlgorithm") as string) || "fts5-bm25";
      const pairs = await fetchTranslationPairs(
        ctx.executeCommand,
        currentAlg,
        ctx.currentCellSourceContent,
        ctx.numberOfFewShotExamples,
        ctx.useOnlyValidatedExamples
      );

      const runForFormat = async (fmt: "source-and-target" | "target-only"): Promise<string> => {
        return await generateCompletionFromPairs(pairs, ctx.numberOfFewShotExamples, fmt, ctx);
      };

      const [compA, compB] = await Promise.all([
        runForFormat(formats[0]),
        runForFormat(formats[1]),
      ]);

      return { variants: [compA, compB], names: formats };
    }
  );

  // Few-shot example count test: 15 vs 30 examples
  abTestingRegistry.register<SearchAlgorithmContext, string>(
    "Few-Shot Example Count Test",
    1.0,
    async (ctx) => {
      const counts = [15, 30];
      
      // Use user's configured search algorithm and format
      const currentAlg = (ctx.vscodeWorkspaceConfig?.get?.("searchAlgorithm") as string) || "fts5-bm25";
      const format = ctx.fewShotExampleFormat || "source-and-target";
      
      // Fetch enough pairs for the larger count
      const maxCount = Math.max(...counts);
      const pairs = await fetchTranslationPairs(
        ctx.executeCommand,
        currentAlg,
        ctx.currentCellSourceContent,
        maxCount,
        ctx.useOnlyValidatedExamples
      );

      const runForCount = async (count: number): Promise<string> => {
        return await generateCompletionFromPairs(pairs, count, format, ctx);
      };

      const [compA, compB] = await Promise.all([
        runForCount(counts[0]),
        runForCount(counts[1]),
      ]);

      return { 
        variants: [compA, compB], 
        names: [`${counts[0]} examples`, `${counts[1]} examples`] 
      };
    }
  );

  // Low-resource search algorithm test: fts5-bm25 vs sbs with 10 examples each
  abTestingRegistry.register<SearchAlgorithmContext, string>(
    "Low-Resource Search Algorithm Test",
    1.0,
    async (ctx) => {
      const algorithms = ["fts5-bm25", "sbs"];
      const format = ctx.fewShotExampleFormat || "source-and-target";
      const count = 10; // Fixed at 10 examples for low-resource test

      const fetchForAlg = async (alg: string): Promise<string> => {
        const pairs = await fetchTranslationPairs(
          ctx.executeCommand,
          alg,
          ctx.currentCellSourceContent,
          count,
          ctx.useOnlyValidatedExamples
        );
        return await generateCompletionFromPairs(pairs, count, format, ctx);
      };

      const [compA, compB] = await Promise.all([
        fetchForAlg(algorithms[0]),
        fetchForAlg(algorithms[1]),
      ]);

      return { 
        variants: [compA, compB], 
        names: [`${algorithms[0]} (10 examples)`, `${algorithms[1]} (10 examples)`] 
      };
    }
  );

  // SBS efficiency test: sbs with 15 examples vs fts5-bm25 with 30 examples
  abTestingRegistry.register<SearchAlgorithmContext, string>(
    "SBS Efficiency Test",
    1.0,
    async (ctx) => {
      const format = ctx.fewShotExampleFormat || "source-and-target";
      
      const fetchForConfig = async (alg: string, count: number): Promise<string> => {
        const pairs = await fetchTranslationPairs(
          ctx.executeCommand,
          alg,
          ctx.currentCellSourceContent,
          count,
          ctx.useOnlyValidatedExamples
        );
        return await generateCompletionFromPairs(pairs, count, format, ctx);
      };

      const [compA, compB] = await Promise.all([
        fetchForConfig("sbs", 15),
        fetchForConfig("fts5-bm25", 30),
      ]);

      return { 
        variants: [compA, compB], 
        names: ["sbs (15 examples)", "fts5-bm25 (30 examples)"] 
      };
    }
  );
}

// Context for search algorithm test
interface SearchAlgorithmContext {
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
