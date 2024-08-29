import { TokenJS } from 'token.js';
import { CompletionConfig } from '../providers/translationSuggestions/inlineCompletionsProvider';
import { ChatMessage } from '../../types';
import { OpenAIModel } from 'token.js/dist/chat';
import * as vscode from 'vscode';

/**
 * Calls the Language Model (LLM) with the given messages and configuration.
 * 
 * @param messages - An array of ChatMessage objects representing the conversation history.
 * @param config - The CompletionConfig object containing LLM configuration settings.
 * @returns A Promise that resolves to the LLM's response as a string.
 * @throws Error if the LLM response is unexpected or if there's an error during the API call.
 * 
 * Note: This function sets the API key as an environment variable, calls the LLM, and then clears the API key from the environment variable. This is a bit of a hacky way to manage the API key, but token.js does not provide a better way to manage the API key currently, and it's still more lightweight than other libraries.
 */
export async function callLLM(messages: ChatMessage[], config: CompletionConfig): Promise<string> {
    try {
        const tokenjs = new TokenJS();

        // Set the API key as an environment variable
        process.env.OPENAI_API_KEY = config.apiKey;

        try {
            const completion = await tokenjs.chat.completions.create({
                provider: 'openai',
                model: config.model as OpenAIModel,
                messages: messages,
                max_tokens: config.maxTokens,
                temperature: config.temperature,
            });

            // Clear the API key from the environment variable
            delete process.env.OPENAI_API_KEY;

            if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
                return completion.choices[0].message.content?.trim() ?? '';
            } else {
                throw new Error("Unexpected response format from the LLM; callLLM() failed - case 1");
            }
        } catch (error: any) {
            // Clear the API key from the environment variable
            delete process.env.OPENAI_API_KEY;

            if (error.response && error.response.status === 401) {
                vscode.window.showErrorMessage("Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM.");
                return '';
            }
            throw error;
        }
    } catch (error) {
        console.error("Error calling LLM:", error);
        throw new Error("Failed to get a response from the LLM; callLLM() failed - case 2");
    }
}