import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";

interface SavedAdvice {
    cellId: string;
    advicePrompt: string;
    similarCells: string[];
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

        // Find similar cells
        const similarCells = await this.findSimilarCells(text);
        const topSimilarCells = similarCells.slice(0, 10).map((entry) => entry.cellId);

        // Save the advice
        await this.saveAdvice(cellId, advicePrompt, topSimilarCells);

        try {
            // Apply the advice using chatbot
            const message = `Advice: ${advicePrompt}\n\nModify this text according to this prompt:\n\n${text} \n\nPlease return the modified text in the json format specified, do not include any HTML in your response or in the text.`;
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

            // First check direct match
            if (savedAdvice[cellId]) {
                return savedAdvice[cellId].advicePrompt;
            }

            // Then check similar cells lists
            for (const advice of Object.values(savedAdvice)) {
                if (advice.similarCells.includes(cellId)) {
                    return advice.advicePrompt;
                }
            }

            return null;
        } catch (error) {
            console.error("Error getting advice:", error);
            return null;
        }
    }
    async getAndApplyTopAdvice(cellId: string, text: string): Promise<string> {
        console.log(`Getting and applying top advice for cellId: ${cellId}`);

        // Find similar cells to get relevant advice
        const similarCells = await this.findSimilarCells(text);
        const topSimilarCells = similarCells.slice(0, 10).map((entry) => entry.cellId);
        console.log(`Found ${topSimilarCells.length} similar cells`);

        // Get advice for current cell and similar cells
        const advicePromises = [cellId, ...topSimilarCells].map((id) => this.getAdvice(id));
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

    private async saveAdvice(
        cellId: string,
        advicePrompt: string,
        similarCells: string[]
    ): Promise<void> {
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

            savedAdvice[cellId] = {
                cellId,
                advicePrompt,
                similarCells,
            };

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
}
