import * as vscode from "vscode";
import OpenAI from "openai";
import { ChatMessage } from "../../types";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { getAuthApi } from "../extension";

class Chatbot {
    private openai!: OpenAI; // Using definite assignment assertion
    private config: vscode.WorkspaceConfiguration;

    constructor(private systemMessage: string) {
        this.config = vscode.workspace.getConfiguration("codex-editor-extension");

        // Initialize OpenAI with proper configuration (will check Frontier API)
        this.initializeOpenAI();
    }

    private async initializeOpenAI() {
        // Only use Frontier auth if user hasn't provided their own API key
        const apiKey = this.getApiKey();
        const hasCustomApiKey = apiKey && apiKey.trim().length > 0;
        
        let llmEndpoint: string | undefined;
        let authBearerToken: string | undefined;
        let frontierApiAvailable = false;

        if (!hasCustomApiKey) {
            // User doesn't have their own key, try Frontier auth
            try {
                const frontierApi = getAuthApi();
                if (frontierApi) {
                    const authStatus = frontierApi.getAuthStatus();
                    if (authStatus.isAuthenticated) {
                        frontierApiAvailable = true;
                        llmEndpoint = await frontierApi.getLlmEndpoint();
                        // Get auth token from the auth provider
                        authBearerToken = await frontierApi.authProvider.getToken();
                    }
                }
            } catch (error) {
                console.debug("Could not get LLM endpoint from auth API:", error);
            }

            // Warn if API key is not set and no Frontier API is available
            if (!frontierApiAvailable) {
                console.warn(
                    "LLM API key is not set (codex-editor-extension.api_key) and you are not logged into Frontier. Backtranslation will be disabled."
                );
            }
        }

        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: llmEndpoint || this.config.get("llmEndpoint") || "https://api.frontierrnd.com/api/v1",
            defaultHeaders: authBearerToken
                ? {
                    Authorization: `Bearer ${authBearerToken}`,
                }
                : undefined,
        });
        console.log("Initialized OpenAI for backtranslation with", {
            llmEndpoint:
                llmEndpoint || this.config.get("llmEndpoint") || "https://api.frontierrnd.com/api/v1",
            authBearerToken,
            usingCustomApiKey: hasCustomApiKey,
        });
    }

    private getApiKey(): string {
        return this.config.get("api_key") || "";
    }

    private mapMessageRole(role: string): "system" | "user" | "assistant" {
        switch (role) {
            case "context":
                return "user";
            case "system":
            case "user":
            case "assistant":
                return role;
            default:
                return "user";
        }
    }

    private async callLLM(messages: ChatMessage[]): Promise<string> {
        try {
            // Ensure OpenAI is initialized with the latest configuration
            // This helps if Frontier authentication state changes during a session
            if (!this.openai) {
                await this.initializeOpenAI();
            }

            const model = "default";

            const completion = await this.openai.chat.completions.create({
                model,
                messages: messages.map((message) => ({
                    role: this.mapMessageRole(message.role),
                    content: message.content,
                })) as ChatCompletionMessageParam[],
                // Let the server decide temperature for the default model.
                ...(model.toLowerCase() === "default" ? {} : (model.toLowerCase() === "gpt-5" ? { temperature: 1 } : { temperature: this.config.get("temperature") || 0.8 })),
                stream: false,
            });

            if (
                completion.choices &&
                completion.choices.length > 0 &&
                completion.choices[0].message
            ) {
                return completion.choices[0].message.content?.trim() ?? "";
            } else {
                throw new Error("Unexpected response format from the LLM");
            }
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                // Try to reinitialize OpenAI in case authentication state changed
                try {
                    await this.initializeOpenAI();

                    // If we still don't have valid authentication, show appropriate message
                    const apiKey = this.getApiKey();
                    const frontierApi = getAuthApi();
                    const isAuthenticated = frontierApi?.getAuthStatus().isAuthenticated;

                    if (!apiKey && !isAuthenticated) {
                        vscode.window.showErrorMessage(
                            "Authentication failed. Please add a valid API key or log in to Frontier to use backtranslation."
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            "Authentication failed. Please check your API key or Frontier credentials."
                        );
                    }
                } catch (reinitError) {
                    console.error("Failed to reinitialize OpenAI client:", reinitError);
                }
                return "";
            }
            console.error("Error calling LLM:", error);
            throw error;
        }
    }

    private getJson(content: string): any {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            console.error("Error parsing JSON from LLM response:", error);
        }
        return null;
    }

    async getCompletion(prompt: string): Promise<string> {
        const response = await this.callLLM([
            { role: "system", content: this.systemMessage },
            { role: "user", content: prompt },
        ]);
        return response;
    }

    async getJsonCompletion(prompt: string): Promise<any> {
        const response = await this.getCompletion(prompt);
        return this.getJson(response);
    }

}

export default Chatbot;