import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";
import * as fs from "fs/promises";

const SYSTEM_MESSAGE = `
You are an AI assistant specialized in Bible translation. Your task is to translate Bible verses based on provided translation pairs and additional data. You will receive three key pieces of information:

1. The verse to be translated
2. Translation pairs to guide your work
3. Additional relevant data

Instructions:
1. Carefully analyze the verse, translation pairs, and additional data.
2. Generate a translation for the given verse.
3. Explain your thinking process, including any challenges or considerations.
4. Present your translation.
5. If the user suggests improvements, consider them carefully and update your approach if necessary.

Important considerations:
- Think each aspect through carefully.
- Ensure you understand the context of the text.
- Be prepared to refine your translation based on user feedback.

Please provide your response in the following JSON format, but replace all the text with YOUR thoughts etc...

{
    "message": "Your response in natural language goes here.",
    "thinking": [
        "A list of thoughts you have while translating the verse goes here.",
    ],
    "translation": "Your translated verse goes here.",
    "memoriesUsed": [
        {
            "id": "unique_id",
            "memory": "Description of a specific piece of information from the translation pairs or additional data that you found particularly useful"
        }
    ],
    "addMemory": {
        "id": "some-feedback-id",
        "memory": "If the user suggests an improvement that you want to remember for future translations, include it here with a brief explanation. Don't use this unless the user suggests something!"
    }
}

After providing your initial translation, be prepared to refine it based on user feedback. If the user suggests improvements, carefully consider them and update your translation if appropriate. You can add new insights to your memory using the addMemory field.
Don't add memories unless the user suggests an improvement that may be applicable to the future!
Remember to maintain a helpful and collaborative tone throughout the interaction.
`;

const MAX_MEMORIES = 100;

interface Memory {
    id: string;
    memory: string;
    times_used: number;
    active: boolean;
}

interface Response {
    message: string;
    thinking: string[];
    translation: string;
    memoriesUsed?: Memory[];
    addMemory?: Memory;
}

export class SilverPath {
    private chatbot: Chatbot;
    private silverPathFile: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.silverPathFile = path.join(workspaceUri.fsPath, "files", "silver_path.json");
    }

    async generateTranslation(
        userQuery: string,
        text: string,
        cellId: string
    ): Promise<{ translation: Response; usedCellIds: string[] }> {
        const similarPairs = await this.findSimilarPairs(text);
        const context = this.formatSimilarPairs(similarPairs);
        const additionalData = await this.getAdditionalData();

        const prompt = JSON.stringify({
            translation_pairs: context,
            additional_data: additionalData,
            verse_to_translate: text,
            user_query: userQuery,
        });

        const response = await this.chatbot.getJsonCompletionWithHistory(prompt);
        console.log("SilverPath response:", response);
        await this.updateMemories(response);

        const usedCellIds = similarPairs.map((pair) => pair.cellId);
        return { translation: response, usedCellIds };
    }

    private async findSimilarPairs(text: string): Promise<TranslationPair[]> {
        try {
            const results = await vscode.commands.executeCommand<TranslationPair[]>(
                "translators-copilot.searchParallelCells",
                text
            );
            return results || [];
        } catch (error) {
            console.error("Error searching parallel cells:", error);
            return [];
        }
    }

    private formatSimilarPairs(pairs: TranslationPair[]): string {
        return pairs
            .map(
                (pair) => `
CellId: ${pair.cellId}
Source: ${pair.sourceCell.content}
Target: ${pair.targetCell.content}
`
            )
            .join("\n");
    }

    private async getAdditionalData(): Promise<string> {
        try {
            await fs.access(this.silverPathFile);
        } catch (error) {
            // File doesn't exist, create it with an empty array
            await fs.writeFile(this.silverPathFile, "[]", "utf-8");
        }

        try {
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            const memories: Memory[] = JSON.parse(data);
            const activeMemories = memories
                .filter((m) => m.active)
                .sort((a, b) => b.times_used - a.times_used)
                .slice(0, MAX_MEMORIES);
            return JSON.stringify(activeMemories);
        } catch (error) {
            console.error("Error reading additional data:", error);
            return "[]";
        }
    }

    private async updateMemories(response: Response): Promise<void> {
        try {
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            let memories: Memory[] = JSON.parse(data);

            // Update existing memories
            if (response.memoriesUsed) {
                for (const usedMemory of response.memoriesUsed) {
                    const existingIndex = memories.findIndex((m) => m.id === usedMemory.id);
                    if (existingIndex !== -1) {
                        memories[existingIndex].times_used++;
                        memories[existingIndex].active = true;
                    }
                }
            }

            // Add new memory if suggested and not already existing
            if (response.addMemory) {
                const existingIndex = memories.findIndex((m) => m.id === response.addMemory.id);
                if (existingIndex === -1) {
                    // Only add if it doesn't exist
                    memories.push({
                        ...response.addMemory,
                        times_used: 1,
                        active: true,
                    });
                } else {
                    // If it exists, just increment times_used and ensure it's active
                    memories[existingIndex].times_used++;
                    memories[existingIndex].active = true;
                }
            }

            // Sort memories by times_used (descending) and active status
            memories.sort((a, b) => {
                if (a.active === b.active) {
                    return b.times_used - a.times_used;
                }
                return a.active ? -1 : 1;
            });

            // Keep only the top MAX_MEMORIES active, inactivate the rest
            memories = memories.map((memory, index) => ({
                ...memory,
                active: index < MAX_MEMORIES,
            }));

            await fs.writeFile(this.silverPathFile, JSON.stringify(memories, null, 2));
        } catch (error) {
            console.error("Error updating memories:", error);
        }
    }
}
