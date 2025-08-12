import * as vscode from "vscode";
import OpenAI from "openai";
import { ChatMessage } from "../../types";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { getAuthApi } from "../extension";

class Chatbot {
    private openai!: OpenAI; // Using definite assignment assertion
    private config: vscode.WorkspaceConfiguration;
    public messages: ChatMessage[];
    private contextMessage: ChatMessage | null;
    private maxBuffer: number;
    private language: string;

    constructor(private systemMessage: string) {
        this.config = vscode.workspace.getConfiguration("codex-editor-extension");
        this.language = this.config.get("main_chat_language") || "en";

        // Initialize OpenAI with proper configuration (will check Frontier API)
        this.initializeOpenAI();

        this.messages = [
            {
                role: "system",
                content:
                    systemMessage + `\n\nTalk with the user in this language: ${this.language}.`,
            },
        ];
        this.contextMessage = null;
        this.maxBuffer = 30;
    }

    private async initializeOpenAI() {
        // Get the LLM endpoint from auth API if available
        let llmEndpoint: string | undefined;
        let authBearerToken: string | undefined;
        let frontierApiAvailable = false;

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
        const apiKey = this.getApiKey();
        if (!apiKey && !frontierApiAvailable) {
            console.warn(
                "Smart Edits LLM API key is not set (codex-editor-extension.api_key) and you are not logged into Frontier. LLM suggestions will be disabled."
            );
        }

        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: llmEndpoint || this.config.get("llmEndpoint") || "https://api.openai.com/v1",
            defaultHeaders: authBearerToken
                ? {
                    Authorization: `Bearer ${authBearerToken}`,
                }
                : undefined,
        });
        console.log("Called OpenAI from smart edits with", {
            llmEndpoint:
                llmEndpoint || this.config.get("llmEndpoint") || "https://api.openai.com/v1",
            authBearerToken,
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

            let model = this.config.get("model") as string;
            if (model === "custom") {
                model = this.config.get("customModel") as string;
            }

            const completion = await this.openai.chat.completions.create({
                model: model,
                messages: messages.map((message) => ({
                    role: this.mapMessageRole(message.role),
                    content: message.content,
                })) as ChatCompletionMessageParam[],
                ...(model?.toLowerCase?.() === "gpt-5" ? { temperature: 1 } : { temperature: this.config.get("temperature") || 0.8 }),
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
                            "Authentication failed. Please add a valid API key or log in to Frontier to use the Smart Edits feature."
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

    private async *streamLLM(messages: ChatMessage[]): AsyncGenerator<string> {
        try {
            // Ensure OpenAI is initialized with the latest configuration
            if (!this.openai) {
                await this.initializeOpenAI();
            }

            let model = this.config.get("model") as string;
            if (model === "custom") {
                model = this.config.get("customModel") as string;
            }

            const stream = await this.openai.chat.completions.create({
                model: model,
                messages: messages.map((message) => ({
                    role: this.mapMessageRole(message.role),
                    content: message.content,
                })) as ChatCompletionMessageParam[],
                ...(model?.toLowerCase?.() === "gpt-5" ? { temperature: 1 } : { temperature: this.config.get("temperature") || 0.8 }),
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                    yield content;
                }
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
                            "Authentication failed. Please add a valid API key or log in to Frontier to use the Smart Edits feature."
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            "Authentication failed. Please check your API key or Frontier credentials."
                        );
                    }
                } catch (reinitError) {
                    console.error("Failed to reinitialize OpenAI client:", reinitError);
                }
                return;
            }
            console.error("Error streaming from LLM:", error);
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

    async addMessage(role: "user" | "assistant", content: string): Promise<void> {
        this.messages.push({ role, content });
    }

    async setContext(context: string): Promise<void> {
        this.contextMessage = {
            role: "user",
            content: `Below is your current context, 
            this message may change and is not an error. 
            It simply means that the user has changed the verses they are looking at. 
            This means there may be conflicts between the context and what you previously thought the context was, 
            this is not your fault, it just means the context has changed.\nContext:\n${context}`,
        };
    }

    private getMessagesWithContext(): ChatMessage[] {
        if (this.contextMessage) {
            return [
                { role: "system", content: this.systemMessage },
                this.contextMessage,
                ...this.messages,
            ];
        }
        return this.messages;
    }

    async sendMessage(message: string): Promise<string> {
        await this.addMessage("user", message);
        const response = await this.callLLM(this.getMessagesWithContext());
        await this.addMessage("assistant", response);
        if (this.messages.length > this.maxBuffer) {
            this.messages.shift();
        }
        return response;
    }

    async editMessage(messageIndex: number, newContent: string): Promise<void> {
        if (messageIndex >= this.messages.length - 1) {
            throw new Error("Invalid message index");
        }

        this.messages = this.messages.slice(0, messageIndex + 1);
    }

    async sendMessageStream(
        message: string,
        onChunk: (chunk: { index: number; content: string; }, isLast: boolean) => void
    ): Promise<string> {
        await this.addMessage("user", message);
        let fullResponse = "";
        let chunkIndex = 0;

        for await (const chunk of this.streamLLM(this.getMessagesWithContext())) {
            onChunk({ index: chunkIndex++, content: chunk }, false);
            fullResponse += chunk;
        }

        // Send a final empty chunk to indicate the end of the stream
        onChunk({ index: chunkIndex, content: "" }, true);

        await this.addMessage("assistant", fullResponse);
        if (this.messages.length > this.maxBuffer) {
            this.messages.shift();
        }
        return fullResponse;
    }

    async getCompletion(prompt: string): Promise<string> {
        const response = await this.callLLM([
            { role: "system", content: this.systemMessage },
            { role: "user", content: prompt },
        ]);
        return response;
    }

    async causeMemoryLoss() {
        // TODO: Make the LLM beg to keep its memory before this happens.
        this.messages = [{ role: "system", content: this.systemMessage }];
    }

    async getJsonCompletion(prompt: string): Promise<any> {
        const response = await this.getCompletion(prompt);
        return this.getJson(response);
    }

    async getJsonCompletionWithHistory(prompt: string): Promise<any> {
        await this.addMessage("user", prompt);
        const response = await this.callLLM(this.getMessagesWithContext());
        await this.addMessage("assistant", response);
        if (this.messages.length > this.maxBuffer) {
            this.messages.shift();
        }
        return this.getJson(response);
    }
}

export default Chatbot;