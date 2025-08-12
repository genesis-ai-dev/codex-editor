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
  const defaultProbability = 1.0; // Compare models on every run for now
  abTestingRegistry.register<LlmGenerationContext, string>(
    "llmGeneration",
    defaultProbability,
    async ({ messages, completionConfig, token }) => {
      // Compare gpt-4o vs gpt-5 with graceful fallback if gpt-5 is unavailable
      const config4o: CompletionConfig = { ...completionConfig, model: "gpt-4o", temperature: completionConfig.temperature };
      const config5: CompletionConfig = { ...completionConfig, model: "gpt-5", temperature: 1, };

      const [variant4o, variant5] = await Promise.all([
        callLLM(messages, config4o, token),
        callLLM(messages, config5, token),
      ]);
      return { variants: [variant4o, variant5], names: ["gpt-4o", "gpt-5"] };
    }
  );
}


