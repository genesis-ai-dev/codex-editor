import { abTestingRegistry } from "./abTestingRegistry";
import { callLLM } from "./llmUtils";
import type * as vscode from "vscode";
import type { TranslationPair } from "../../types";
import type { CompletionConfig } from "./llmUtils";
import { buildFewShotExamplesText, buildMessages } from "../providers/translationSuggestions/shared";


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

      const fetchForAlg = async (alg: string): Promise<string> => {
        const pairs = await ctx.executeCommand<TranslationPair[]>(
          "codex-editor-extension.getTranslationPairsFromSourceCellQueryWithAlgorithm",
          alg,
          ctx.currentCellSourceContent,
          Math.max(ctx.numberOfFewShotExamples, 2),
          ctx.useOnlyValidatedExamples
        );

        const examplesText = buildFewShotExamplesText(
          (pairs || []).slice(0, ctx.numberOfFewShotExamples),
          ctx.allowHtmlPredictions,
          ctx.fewShotExampleFormat || "source-and-target"
        );

        const msgs = buildMessages(
          ctx.targetLanguage,
          ctx.systemMessage,
          ctx.userMessageInstructions.split("\n"),
          examplesText,
          ctx.precedingTranslationPairs,
          ctx.currentCellSourceContent,
          ctx.allowHtmlPredictions,
          ctx.fewShotExampleFormat || "source-and-target"
        );
        return await callLLM(msgs, ctx.completionConfig, ctx.token);
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

      const runForFormat = async (fmt: "source-and-target" | "target-only"): Promise<string> => {
        // Reuse pairs from the user's configured searchAlgorithm
        const currentAlg = (ctx.vscodeWorkspaceConfig?.get?.("searchAlgorithm") as string) || "fts5-bm25";
        const pairs = await ctx.executeCommand<TranslationPair[]>(
          "codex-editor-extension.getTranslationPairsFromSourceCellQueryWithAlgorithm",
          currentAlg,
          ctx.currentCellSourceContent,
          Math.max(ctx.numberOfFewShotExamples, 2),
          ctx.useOnlyValidatedExamples
        );

        const examplesText = buildFewShotExamplesText(
          (pairs || []).slice(0, ctx.numberOfFewShotExamples),
          ctx.allowHtmlPredictions,
          fmt
        );

        const msgs = buildMessages(
          ctx.targetLanguage,
          ctx.systemMessage,
          ctx.userMessageInstructions.split("\n"),
          examplesText,
          ctx.precedingTranslationPairs,
          ctx.currentCellSourceContent,
          ctx.allowHtmlPredictions,
          fmt
        );
        return await callLLM(msgs, ctx.completionConfig, ctx.token);
      };

      const [compA, compB] = await Promise.all([
        runForFormat(formats[0]),
        runForFormat(formats[1]),
      ]);

      return { variants: [compA, compB], names: formats };
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
