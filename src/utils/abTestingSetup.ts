import { abTestingRegistry } from "./abTestingRegistry";
import { callLLM } from "./llmUtils";
import type * as vscode from "vscode";
import type { ChatMessage } from "../../types";
import type { CompletionConfig } from "./llmUtils";

interface LlmGenerationContext {
  messages: ChatMessage[];
  completionConfig: CompletionConfig;
  token?: vscode.CancellationToken;
}

export function initializeABTesting() {
  // Register a simple A/B test for LLM generation with a default probability.
  // Probability means: chance to generate multiple variants instead of single completion.
  const defaultProbability = 0.5;
  abTestingRegistry.register<LlmGenerationContext, string>(
    "llmGeneration",
    defaultProbability,
    async ({ messages, completionConfig, token }) => {
      // For now: do ONE LLM call, then duplicate the result to simulate variants for UI testing
      const single = await callLLM(messages, completionConfig, token);
      const count = Math.max(2, completionConfig.abTestingVariants || 2);
      return Array.from({ length: count }, () => single);
    }
  );
}


