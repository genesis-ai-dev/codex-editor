import * as vscode from "vscode";
import OpenAI from "openai";
import { ChatMessage } from "../../types";

class Chatbot {
    private openai: OpenAI;
    private config: vscode.WorkspaceConfiguration;
    private messages: ChatMessage[];
    private maxBuffer: number;

    constructor(private systemMessage: string) {
        this.config = vscode.workspace.getConfiguration("translators-copilot");
        this.openai = new OpenAI({
            apiKey: this.getApiKey(),
            baseURL: this.config.get("llmEndpoint") || "https://api.openai.com/v1",
        });
        this.messages = [{ role: "system", content: systemMessage }];
        this.maxBuffer = 20;
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

    async sendMessage(message: string): Promise<string> {
        await this.addMessage("user", message);
        const response = await this.callLLM(this.messages);
        await this.addMessage("assistant", response);
        if (this.messages.length > this.maxBuffer) {
            this.messages.shift();
        }
        return response;
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
