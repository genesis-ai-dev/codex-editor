import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";

// Update the interface to support multiple advice entries with timestamps
interface AdviceEntry {
    advicePrompt: string;
    timestamp: number;
}

interface SavedAdvice {
    cellId: string;
    adviceHistory: AdviceEntry[];
}

const SYSTEM_MESSAGE = `You are a helpful assistant that modifies text according to given advice/instructions.
Your response should follow this json format:
    {
        "modifiedText": "The modified text that follows the advice"
    }
    
Rules:
    1. Preserve all HTML tags in the text
    2. Focus on meaningful content changes based on the advice
    3. If no changes are needed, return the original text
    4. The text may be in unfamiliar languages - use context clues to make appropriate modifications
`;

export class SmartAdvice {
    private chatbot: Chatbot;
    private smartAdvicePath: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartAdvicePath = path.join(workspaceUri.fsPath, "files", "smart_advice.json");
        console.log("SmartAdvice initialized with path:", this.smartAdvicePath);
    }

    async applyAdvice(text: string, advicePrompt: string, cellId: string): Promise<string> {
        console.log(`Applying advice for cellId: ${cellId}`);

        // Process any cell references in the advice
        const processedAdvice = await this.processCellReferences(advicePrompt);

        // Save the original advice (with references)
        await this.saveAdvice(cellId, advicePrompt);

        try {
            // Apply the processed advice using chatbot
            const message = `Advice: ${processedAdvice}\n\nModify this text according to this prompt:\n\n${text} \n\nPlease return the modified text in the json format specified, do not include any HTML in your response or in the text.`;
            const response = await this.chatbot.getJsonCompletion(message);

            if (response && response.modifiedText) {
                return response.modifiedText;
            }
            return text;
        } catch (error) {
            console.error("Error applying advice:", error);
            return text;
        }
    }

    async getAdvice(cellId: string): Promise<string | null> {
        try {
            console.log(`Getting advice for cellId: ${cellId}`);
            const fileUri = vscode.Uri.file(this.smartAdvicePath);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const savedAdvice: { [key: string]: SavedAdvice } = JSON.parse(fileContent.toString());

            if (savedAdvice[cellId] && savedAdvice[cellId].adviceHistory.length > 0) {
                // Return the most recent advice
                const sortedAdvice = savedAdvice[cellId].adviceHistory.sort(
                    (a, b) => b.timestamp - a.timestamp
                );
                return sortedAdvice[0].advicePrompt;
            }

            return null;
        } catch (error) {
            console.error("Error getting advice:", error);
            return null;
        }
    }

    async getAndApplyTopAdvice(cellId: string, text: string): Promise<string> {
        console.log(`Getting and applying top advice for cellId: ${cellId}`);

        // Find similar cells
        const similarCells = await this.findSimilarCells(text);
        const cellIds = [cellId, ...similarCells.map((cell) => cell.cellId)];
        console.log(`Found ${similarCells.length} similar cells`);

        // Get advice for current cell and similar cells
        const advicePromises = cellIds.map((id) => this.getAdvice(id));
        const allAdvice = await Promise.all(advicePromises);
        console.log(`Retrieved ${allAdvice.length} pieces of advice`);

        // Filter out null values and get most recent valid advice
        const validAdvice = allAdvice.filter((advice) => advice !== null)[0];
        console.log(`Found valid advice: ${validAdvice ? "yes" : "no"}`);

        if (!validAdvice) {
            console.log("No valid advice found, returning original text");
            return text;
        }

        try {
            console.log("Applying advice using chatbot");
            // Apply the advice using chatbot
            const message = `Advice: ${validAdvice}\n\nModify this text according to this prompt:\n\n${text} \n\nPlease return the modified text in the json format specified, do not include any HTML in your response or in the text.`;
            const response = await this.chatbot.getJsonCompletion(message);

            if (response && response.modifiedText) {
                console.log("Successfully modified text with advice");
                return response.modifiedText;
            }
            console.log("No modified text in response, returning original");
            return text;
        } catch (error) {
            console.error("Error applying advice:", error);
            return text;
        }
    }

    private async saveAdvice(cellId: string, advicePrompt: string): Promise<void> {
        try {
            console.log(`Saving advice for cellId: ${cellId}`);
            let savedAdvice: { [key: string]: SavedAdvice } = {};

            try {
                const fileUri = vscode.Uri.file(this.smartAdvicePath);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                savedAdvice = JSON.parse(fileContent.toString());
            } catch (error) {
                console.log("No existing saved advice found, starting with empty object");
            }

            // Initialize or update advice history for the cell
            if (!savedAdvice[cellId]) {
                savedAdvice[cellId] = {
                    cellId,
                    adviceHistory: [],
                };
            }

            // Add new advice with timestamp
            savedAdvice[cellId].adviceHistory.push({
                advicePrompt,
                timestamp: Date.now(),
            });

            const fileUri = vscode.Uri.file(this.smartAdvicePath);
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedAdvice, null, 2))
            );
            console.log(`Saved advice for cellId: ${cellId}`);
        } catch (error) {
            console.error("Error saving advice:", error);
        }
    }

    private async findSimilarCells(text: string): Promise<TranslationPair[]> {
        console.log("Finding similar cells for text:", text);
        try {
            const results = await vscode.commands.executeCommand<TranslationPair[]>(
                "translators-copilot.searchParallelCells",
                text
            );
            console.log(`Found ${results?.length || 0} similar cells`);
            return results || [];
        } catch (error) {
            console.error("Error searching parallel cells:", error);
            return [];
        }
    }

    // Add helper function to extract and process cell references
    private async processCellReferences(advicePrompt: string): Promise<string> {
        // Match cellIds in format <BOOK C:V> or similar patterns
        const cellIdPattern = /<([^>]+)>/g;
        const matches = advicePrompt.match(cellIdPattern);

        if (!matches) return advicePrompt;

        let processedPrompt = advicePrompt;

        for (const match of matches) {
            const cellId = match.slice(1, -1); // Remove < >
            try {
                const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                    "translators-copilot.getTranslationPairFromProject",
                    cellId
                );

                if (translationPair) {
                    // Replace the cell reference with its actual content
                    processedPrompt = processedPrompt.replace(
                        match,
                        `"${translationPair.targetCell.content}"`
                    );
                }
            } catch (error) {
                console.error(`Error processing cell reference ${cellId}:`, error);
            }
        }

        return processedPrompt;
    }
}
