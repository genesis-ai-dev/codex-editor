import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";
import * as fs from "fs/promises";
import { SavedPrompt } from "./types";

const SYSTEM_MESSAGE = `
You are an AI assistant specialized in Bible translation. Your task is to translate Bible verses based on provided translation pairs and additional data. You will receive three key pieces of information:

1. The verse to be translated
2. Translation pairs to guide your work
3. Additional relevant data (memories) specific to this verse

Instructions:
1. Carefully analyze the verse, translation pairs, and additional data.
2. Generate a translation for the given verse.
3. Explain your thinking process, including any challenges or considerations.
4. Present your translation.
5. Manage memories by updating them as needed.

Important considerations:
- Think each aspect through carefully.
- Ensure you understand the context of the text.
- Be proactive in managing memories for future translations.

Please provide your response in the following JSON format:

{
    "message": "Your response in natural language goes here.",
    "thinking": [
        "A list of thoughts you have while translating the verse goes here.",
    ],
    "memoriesUsed": [
        "List of cellIds for memories you found useful. Always actually impliment the memories and advice here!"
    ],
    "translation": "Your translated verse goes here.",
    "memoryUpdates": [
        {
            "cellId": "The cellId associated with this memory. ",
            "content": "The updated memory content",
            "reason": "Brief explanation of why this memory is being updated"
        }
    ]
}

You have control over memory management. Use the "memoryUpdates" field to update memories as you see fit. Consider the following:

1. Update existing memories if you have new insights or information.
2. If a cell doesn't have a memory yet, you can create one by providing an update for it.
3. To effectively delete a memory, update its content to an empty string.
4. Update memories whenever the user gives feedback.
5. Don't use it to save translations, only use it to save information you find useful, notes, or user feedback (especially user feedback!).
6. They should be as generally applicable as possible, and concise.
`;
interface Memory {
    content: string;
    times_used: number;
}

interface MemoryUpdate {
    cellId: string;
    content: string;
    reason: string;
}

interface Response {
    message: string;
    thinking: string[];
    translation: string;
    memoriesUsed?: string[];
    memoryUpdates?: MemoryUpdate[];
}

export class SilverPath {
    private chatbot: Chatbot;
    private silverPathFile: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.silverPathFile = path.join(workspaceUri.fsPath, "files", "silver_path_memories.json");
    }

    async generateTranslation(
        userQuery: string,
        text: string,
        cellId: string
    ): Promise<{ translation: Response; usedCellIds: string[] }> {
        const similarPairs = await this.findSimilarPairs(text);
        const context = await this.formatSimilarPairsWithMemories(similarPairs);

        const prompt = JSON.stringify({
            translation_pairs: context,
            verse_to_translate: text,
            user_query: userQuery,
        });

        const response = await this.chatbot.getJsonCompletionWithHistory(prompt);
        console.log("SilverPath response:", response);
        await this.updateMemories(response);

        const usedCellIds = [cellId, ...similarPairs.map((pair) => pair.cellId)];
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

    private async formatSimilarPairsWithMemories(pairs: TranslationPair[]): Promise<string> {
        const allMemories = await this.readAllMemories();

        return pairs
            .map((pair) => {
                const memory = allMemories[pair.cellId] || { content: "", times_used: 0 };
                return `
CellId: ${pair.cellId}
Source: ${pair.sourceCell.content}
Target: ${pair.targetCell.content}
Memory: ${memory.content}
`;
            })
            .join("\n");
    }

    private async readAllMemories(): Promise<{ [cellId: string]: Memory }> {
        try {
            await fs.access(this.silverPathFile);
        } catch (error) {
            // File doesn't exist, create it with an empty object
            await fs.writeFile(this.silverPathFile, "{}", "utf-8");
        }

        try {
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            return JSON.parse(data);
        } catch (error) {
            console.error("Error reading memories:", error);
            return {};
        }
    }

    private async updateMemories(response: Response): Promise<void> {
        try {
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            const allMemories: { [cellId: string]: Memory } = JSON.parse(data);

            // Update used memories
            if (response.memoriesUsed) {
                for (const cellId of response.memoriesUsed) {
                    if (allMemories[cellId]) {
                        allMemories[cellId].times_used++;
                    }
                }
            }

            // Process memory updates
            if (response.memoryUpdates) {
                for (const update of response.memoryUpdates) {
                    if (!allMemories[update.cellId]) {
                        allMemories[update.cellId] = { content: "", times_used: 0 };
                    }
                    allMemories[update.cellId].content = update.content;
                    allMemories[update.cellId].times_used++;
                }
            }

            await fs.writeFile(this.silverPathFile, JSON.stringify(allMemories, null, 2));
        } catch (error) {
            console.error("Error updating memories:", error);
        }
    }
}
