import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";
import * as fs from "fs/promises";

const SYSTEM_MESSAGE = `
You are an AI assistant specialized in Bible translation. Your task is to translate Bible verses based on provided translation pairs and additional data. You will receive three key pieces of information:

1. The verse to be translated:
<verse_to_translate>
{{verse_to_translate}}
</verse_to_translate>

2. Translation pairs to guide your work:
<translation_pairs>
{{translation_pairs}}
</translation_pairs>

3. Additional relevant data:
<additional_data>
{{additional_data}}
</additional_data>

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

Please wrap your work in the following XML format:

<translation_process>
    <message>[A brief statement about your task, e.g., "I will now translate the given Bible verse."]</message>
    <thinking>
        [1. Analyze the verse to be translated, noting any key words or phrases.]
        [2. Review the translation pairs, identifying relevant matches.]
        [3. Consider the additional data for context and nuance.]
        [4. Propose an initial translation.]
        [5. Review and refine the translation.]
    </thinking>
    <translation>[Your translated verse goes here.]</translation>
    <memoriesUsed>
        <memory id="[unique_id]">[Description of a specific piece of information from the translation pairs or additional data that you found particularly useful]</memory>
        [Include as many memory entries as relevant]
    </memoriesUsed>
    <addMemory id="[unique_id]">[If the user suggests an improvement that you want to remember for future translations, include it here with a brief explanation]</addMemory>
</translation_process>

After providing your initial translation, be prepared to refine it based on user feedback. If the user suggests improvements, carefully consider them and update your translation if appropriate. You can add new insights to your memory using the <addMemory> tag.

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
    addMemory?: Memory;
    thinking: string;
    translation: string;
    memoriesUsed?: Memory[];
}

export class SilverPath {
    private chatbot: Chatbot;
    private silverPathFile: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.silverPathFile = path.join(workspaceUri.fsPath, "files", "silver_path.json");
    }

    async generateTranslation(userQuery: string, text: string, cellId: string): Promise<string> {
        const similarPairs = await this.findSimilarPairs(text);
        const context = this.formatSimilarPairs(similarPairs);
        const additionalData = await this.getAdditionalData();

        const message = `
            <translation_pairs>
                ${context}
            </translation_pairs>
            <additional_data>
                ${additionalData}
            </additional_data>
            <verse_to_translate>
                ${text}
            </verse_to_translate>
            <user_query>
                ${userQuery}
            </user_query>
        `;

        const response = await this.chatbot.getCompletion(message);
        const parsed = this.parseXML(response);
        await this.updateMemories(parsed);
        return parsed.translation;
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
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            const memories: Memory[] = JSON.parse(data);
            const activeMemories = memories
                .filter((m) => m.active)
                .sort((a, b) => b.times_used - a.times_used)
                .slice(0, MAX_MEMORIES);
            return JSON.stringify(activeMemories);
        } catch (error) {
            console.error("Error reading additional data:", error);
            return "";
        }
    }

    private parseXML(xml: string): Response {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, "text/xml");
        const thinking = xmlDoc.getElementsByTagName("thinking")[0]?.textContent || "";
        const translation = xmlDoc.getElementsByTagName("translation")[0]?.textContent || "";
        const memoriesUsedElements =
            xmlDoc.getElementsByTagName("memoriesUsed")[0]?.getElementsByTagName("memory") || [];
        const memoriesUsed = Array.from(memoriesUsedElements).map((memory) => ({
            id: memory.getAttribute("id") || "",
            memory: memory.textContent || "",
            times_used: 1,
            active: true,
        }));
        const addMemoryElement = xmlDoc.getElementsByTagName("addMemory")[0];
        const addMemory = addMemoryElement
            ? {
                  id: addMemoryElement.getAttribute("id") || "",
                  memory: addMemoryElement.textContent || "",
                  times_used: 1,
                  active: true,
              }
            : undefined;
        return { thinking, translation, memoriesUsed, addMemory };
    }

    private async updateMemories(response: Response): Promise<void> {
        try {
            const data = await fs.readFile(this.silverPathFile, "utf-8");
            const memories: Memory[] = JSON.parse(data);

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

            // Add or replace new memory if suggested
            if (response.addMemory) {
                const existingIndex = memories.findIndex((m) => m.id === response.addMemory!.id);
                if (existingIndex !== -1) {
                    // Replace existing memory with the new one
                    memories[existingIndex] = {
                        ...response.addMemory,
                        times_used: memories[existingIndex].times_used + 1,
                        active: true,
                    };
                } else {
                    // Add new memory
                    memories.push({
                        ...response.addMemory,
                        times_used: 1,
                        active: true,
                    });
                }
            }

            // Sort memories by times_used (descending) and active status
            memories.sort((a, b) => {
                if (a.active === b.active) {
                    return b.times_used - a.times_used;
                }
                return a.active ? -1 : 1;
            });

            // Inactivate excess memories
            const activeMemories = memories.filter((m) => m.active);
            if (activeMemories.length > MAX_MEMORIES) {
                for (let i = MAX_MEMORIES; i < memories.length; i++) {
                    memories[i].active = false;
                }
            }

            await fs.writeFile(this.silverPathFile, JSON.stringify(memories, null, 2));
        } catch (error) {
            console.error("Error updating memories:", error);
        }
    }
}
