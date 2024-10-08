import * as vscode from "vscode";
import { TokenJS } from "token.js";
import { OpenAIModel, GroqModel } from "token.js/dist/chat";

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

class Chatbot {
    private tokenjs: TokenJS;
    private config: vscode.WorkspaceConfiguration;
    private messages: ChatMessage[];
    private maxBuffer: number;

    constructor(private systemMessage: string) {
        this.tokenjs = new TokenJS();
        this.config = vscode.workspace.getConfiguration("translators-copilot");
        this.messages = [{ role: "system", content: systemMessage }];
        this.maxBuffer = 20;
    }

    private getApiKey(): string {
        return this.config.get("api_key") || "";
    }

    private async callLLM(messages: ChatMessage[]): Promise<string> {
        const apiKey = this.getApiKey();
        process.env.OPENAI_API_KEY = apiKey;

        try {
            const completion = await this.tokenjs.chat.completions.create({
                provider: "openai",
                model: "gpt-4-turbo-preview" as OpenAIModel,
                messages,
            });

            if (completion.choices?.[0]?.message?.content) {
                return completion.choices[0].message.content.trim();
            }
            throw new Error("Unexpected response format from the chatbot");
        } finally {
            delete process.env.OPENAI_API_KEY;
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
