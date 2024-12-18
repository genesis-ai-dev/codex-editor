import * as vscode from "vscode";
import OpenAI from "openai";
import { ChatMessage } from "../../types";

interface RouterResponse {
    user_query: string;
    path_selection: "conversational" | "final_translation" | "tech_help";
}

class Router {
    private openai: OpenAI;
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration("translators-copilot");
        this.openai = new OpenAI({
            apiKey: this.getApiKey(),
            baseURL: this.config.get("llmEndpoint") || "https://api.openai.com/v1",
        });
    }

    private getApiKey(): string {
        return this.config.get("api_key") || "";
    }

    async routeQuery(userQuery: string): Promise<RouterResponse> {
        try {
            let model = this.config.get("model") as string;
            if (model === "custom") {
                model = this.config.get("customModel") as string;
            }

            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a manager assistant who routes user queries to their appropriate paths.",
                    },
                    {
                        role: "user",
                        content: userQuery,
                    },
                ],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "router",
                            description:
                                "Routes user input to the appropriate path based on the context: Conversational, Final Translation, or Tech Help.",
                            parameters: {
                                type: "object",
                                required: ["user_query", "path_selection"],
                                properties: {
                                    user_query: {
                                        type: "string",
                                        description: "The input text or question from the user.",
                                    },
                                    path_selection: {
                                        type: "string",
                                        description:
                                            "Selects the path for routing the input, must be one of the following: 'conversational', 'final_translation', 'tech_help'.",
                                        enum: ["conversational", "final_translation", "tech_help"],
                                    },
                                },
                                additionalProperties: false,
                            },
                        },
                    },
                ],
                tool_choice: "auto",
                temperature: 1,
                max_tokens: 2048,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
            });

            if (response.choices && response.choices.length > 0 && response.choices[0].message) {
                const message = response.choices[0].message;
                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0];
                    if (toolCall.function.name === "router") {
                        const args = JSON.parse(toolCall.function.arguments);
                        return {
                            user_query: args.user_query,
                            path_selection: args.path_selection,
                        };
                    }
                }
            }

            throw new Error("Unexpected response format from the LLM");
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
            }
            throw error;
        }
    }
}

export default Router;
