import * as vscode from "vscode";
import OpenAI from "openai";
import { ChatMessage } from "../../types";

class Chatbot {
    private openai: OpenAI;
    private config: vscode.WorkspaceConfiguration;
    private messages: ChatMessage[];
    private contextMessage: ChatMessage | null;
    private maxBuffer: number;

    constructor(private systemMessage: string) {
        this.config = vscode.workspace.getConfiguration("translators-copilot");
        this.openai = new OpenAI({
            apiKey: this.getApiKey(),
            baseURL: this.config.get("llmEndpoint") || "https://api.openai.com/v1",
        });
        this.messages = [{ role: "system", content: systemMessage }];
        this.contextMessage = null;
        this.maxBuffer = 50;
    }

    private getApiKey(): string {
        return this.config.get("api_key") || "";
    }

    private async callLLM(messages: ChatMessage[]): Promise<string> {
        try {
            let model = this.config.get("model") as string;
            if (model === "custom") {
                model = this.config.get("customModel") as string;
            }

            const completion = await this.openai.chat.completions.create({
                model: model,
                messages: messages,
                max_tokens: this.config.get("max_tokens") || 2048,
                temperature: this.config.get("temperature") || 0.8,
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
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
                return "";
            }
            throw error;
        }
    }

    private async *streamLLM(messages: ChatMessage[]): AsyncGenerator<string> {
        try {
            let model = this.config.get("model") as string;
            if (model === "custom") {
                model = this.config.get("customModel") as string;
            }

            const stream = await this.openai.chat.completions.create({
                model: model,
                messages: messages,
                max_tokens: this.config.get("max_tokens") || 2048,
                temperature: this.config.get("temperature") || 0.8,
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
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
                return;
            }
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
        onChunk: (chunk: { index: number; content: string }, isLast: boolean) => void
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
