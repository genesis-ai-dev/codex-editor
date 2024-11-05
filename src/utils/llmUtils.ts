import OpenAI from "openai";
import { CompletionConfig } from "../providers/translationSuggestions/inlineCompletionsProvider";
import { ChatMessage } from "../../types";
import * as vscode from "vscode";

/**
 * Calls the Language Model (LLM) with the given messages and configuration.
 *
 * @param messages - An array of ChatMessage objects representing the conversation history.
 * @param config - The CompletionConfig object containing LLM configuration settings.
 * @returns A Promise that resolves to the LLM's response as a string.
 * @throws Error if the LLM response is unexpected or if there's an error during the API call.
 */
export async function callLLM(messages: ChatMessage[], config: CompletionConfig): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.endpoint,
        });

        let model = config.model;
        if (model === "custom") {
            model = config.customModel;
        }

        console.log("model", model);

        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                max_tokens: config.maxTokens,
                temperature: config.temperature,
            });

            if (
                completion.choices &&
                completion.choices.length > 0 &&
                completion.choices[0].message
            ) {
                return completion.choices[0].message.content?.trim() ?? "";
            } else {
                throw new Error(
                    "Unexpected response format from the LLM; callLLM() failed - case 1"
                );
            }
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
                return "";
            }
            throw error;
        }
    } catch (error) {
        console.error("Error calling LLM:", error);
        throw new Error("Failed to get a response from the LLM; callLLM() failed - case 2");
    }
}



export async function performReflection( text_to_refine: string, text_context: string, num_improvers: number, number_of_loops: number, config: CompletionConfig ): Promise<string> {

  async function generateImprovement(text: string): Promise<string> {
    //const response = callLLM([
    //awaiting right now until we can debug this.
    const response = await callLLM([
      {
        role: "system",
        content:
          "You are an AI that is responsible for grading an answer according to a Christian perspective. " +
          "Provide a grade from 0 to 100 where 0 is the lowest grade and 100 is the highest grade and a grade comment.",
      },
      {
        role: "user",
        content: `Context: ${text_context}\nAnswer to grade: ${text}\nGrade:`,
      },
    ], config);

    //if we just return the promise instead of resolving it, then we can make all the requests in parallel
    return response;
  }

  async function generateSummary(improvements: Promise<string>[]): Promise<string> {
    const results = await Promise.all(improvements);
    const summarizedContent = results.join("\n\n");
    const summary = await callLLM(
      [
        {
          role: "system",
          content:
            "You are an AI tasked with summarizing suggested improvements according to a Christian perspective to an answer."
        },
        {
          role: "user",
          content: `Context: ${text_context}\nReferenced answer: ${text}\nSuggestions to summarize: ${summarizedContent}\nSummary:`,
        },
      ],
      config
    );
    return summary.trim();
  }

  async function implementImprovements(text: string, improvements: Promise<string>): Promise<string> {
    try {
      const improvedText = improvements.then((result) => {
        // Apply the improvement logic here. For simplicity, let's assume we append the improvements.
        return callLLM(
          [
            {
              role: "system",
              content: `You are an AI tasked with implementing improvements to a text. The improvements requested for it are: "${result}".`,
            },
            {
              role: "user",
              content: text,
            },
          ],
          config
        );
      });
      return await improvedText;
    } catch (error) {
      console.error("Error implementing improvements:", error);
      throw new Error("Failed to implement improvements");
    }
  }

  let text : string = text_to_refine;

  for (let i = 0; i < number_of_loops; i++) {
    const improvements: Promise<string>[] = [];
    for (let j = 0; j < num_improvers; j++) {
      improvements.push(generateImprovement(text));
    }

    const summarized_improvements = num_improvers == 1 ? 
        improvements[0] : 
        generateSummary(improvements);
    text = await implementImprovements(text, summarized_improvements);
  }

  return text;
}