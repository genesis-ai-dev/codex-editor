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
