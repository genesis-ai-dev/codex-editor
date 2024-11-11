import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";

interface SavedPrompt {
    cellId: string;
    prompt: string;
    lastUpdated: number;
    updateCount: number;
}
interface TargetCell {
    cellId: string;
    targetContent: string;
    id?: string;
    score?: number;
    sourceContent?: string;
}

const SYSTEM_MESSAGE = `You are a helpful assistant that modifies text and manages prompts.
Your response should follow this json format:
    {
        "modifiedText": "The modified text that follows the prompt",
        "updatedPrompt": "The consolidated/updated prompt that combines previous and new instructions",
        "updateType": "merge | replace | revert"
    }
    
Rules:
    1. Preserve all HTML tags in the text
    2. Focus on meaningful content changes based on the prompt
    3. If no changes are needed, return the original text
    4. The text may be in unfamiliar languages - use context clues
    5. For prompt management:
       - If new prompt contradicts previous, use "replace" or "revert"
       - If new prompt builds on previous, use "merge" and combine them clearly
       - Always maintain the core intention of the most recent prompt
`;

export class PromptedSmartEdits {
    private chatbot: Chatbot;
    private smartPromptPath: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartPromptPath = path.join(workspaceUri.fsPath, "files", "smart_prompt.json");
        console.log("SmartPrompt initialized with path:", this.smartPromptPath);
    }
    async hasApplicablePrompts(cellId: string, text: string): Promise<boolean> {
        // First check if this cell already has its own prompt
        const existingPrompt = await this.getPromptFromCellId(cellId);
        if (existingPrompt) {
            return false; // Cell already has a prompt
        }

        // Find similar cells
        if (text) {
            const similarCells = await this.findSimilarCells(text);

            // Check if any similar cells have prompts
            for (const cell of similarCells) {
                const prompt = await this.getPromptFromCellId(cell.cellId);
                if (prompt) {
                    return true; // Found a similar cell with a prompt
                }
            }
        }

        return false; // No applicable prompts found
    }

    async applyPromptedEdit(text: string, prompt: string, cellId: string): Promise<string> {
        console.log(`Applying prompt for cellId: ${cellId}, prompt: ${prompt}`);

        // Get existing prompt if any
        const existingPrompt = await this.getPromptFromCellId(cellId);
        console.log(`Existing prompt: ${existingPrompt}`);
        // Process any cell references in the prompt
        const processedPrompt = await this.processCellReferences(prompt);
        console.log("Prompt has been processed:");
        console.log("Processed prompt: ", processedPrompt);

        try {
            // Apply the processed prompt using chatbot
            const message = `Previous Prompt: ${existingPrompt || "None"}\n\nNew Prompt: ${processedPrompt}\n\nModify this text according to these prompts:\n\n${text}`;
            const response = await this.chatbot.getJsonCompletion(message);

            if (response && response.modifiedText) {
                // Save the updated prompt based on LLM's decision
                await this.savePromptToCellId(cellId, response.updatedPrompt, response.updateType);
                return response.modifiedText;
            }
            return text;
        } catch (error) {
            console.error("Error applying prompt:", error);
            return text;
        }
    }

    async getPromptFromCellId(cellId: string): Promise<string | null> {
        try {
            // console.log(`Getting prompt for cellId: ${cellId}`);
            const fileUri = vscode.Uri.file(this.smartPromptPath);

            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const savedPrompts: { [key: string]: SavedPrompt } = JSON.parse(
                    fileContent.toString()
                );

                if (savedPrompts[cellId]) {
                    return savedPrompts[cellId].prompt;
                }
            } catch (error: any) {
                // If file doesn't exist, create it with empty content
                if (error.code === "FileNotFound" || error.code === "ENOENT") {
                    await vscode.workspace.fs.writeFile(
                        fileUri,
                        Buffer.from(JSON.stringify({}, null, 2))
                    );
                }
            }

            return null;
        } catch (error) {
            console.error("Error getting prompt:", error);
            return null;
        }
    }

    async getTopPrompts(cellId: string, text: string): Promise<string[]> {
        const similarCells = await this.findSimilarCells(text);
        const cellIds = [cellId, ...similarCells.map((cell) => cell.cellId)];
        // Get prompt for current cell and similar cells
        const promptPromises = cellIds.map((id) => this.getPromptFromCellId(id));
        const allPrompts = await Promise.all(promptPromises);
        // Filter out null values and return valid prompts
        const validPrompts = allPrompts.filter((prompt): prompt is string => prompt !== null);
        return validPrompts;
    }

    private async savePromptToCellId(
        cellId: string,
        prompt: string,
        updateType: string
    ): Promise<void> {
        try {
            let savedPrompts: { [key: string]: SavedPrompt } = {};

            try {
                const fileUri = vscode.Uri.file(this.smartPromptPath);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                savedPrompts = JSON.parse(fileContent.toString());
            } catch (error) {
                console.log("No existing saved prompt found, starting with empty object");
            }

            // Update or initialize the prompt
            savedPrompts[cellId] = {
                cellId,
                prompt,
                lastUpdated: Date.now(),
                updateCount: (savedPrompts[cellId]?.updateCount || 0) + 1,
            };

            const fileUri = vscode.Uri.file(this.smartPromptPath);
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedPrompts, null, 2))
            );
        } catch (error) {
            console.error("Error saving prompt:", error);
        }
    }

    private async findSimilarCells(text: string): Promise<TranslationPair[]> {
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

    // Add helper function to extract and process cell references
    private async processCellReferences(prompt: string): Promise<string> {
        // Match patterns like @GEN 1:1, @GEN1:1, @gen 1:12 etc
        const cellIdPattern = /@([a-zA-Z]+)\s*(\d+):(\d+)/g;
        let processedPrompt = prompt;

        for (const match of Array.from(prompt.matchAll(cellIdPattern))) {
            const book = match[1].toUpperCase();
            const chapter = match[2];
            const verse = match[3];
            const cellId = `${book} ${chapter}:${verse}`;

            try {
                const targetCell = await vscode.commands.executeCommand<TargetCell>(
                    "translators-copilot.getTargetCellByCellId",
                    cellId
                );
                if (targetCell?.targetContent) {
                    processedPrompt = processedPrompt.replace(
                        match[0],
                        ` "${targetCell.targetContent}" `
                    );
                } else {
                    console.log(`No content found for ${cellId}`);
                }
            } catch (error) {
                console.error(`Error processing cell reference ${cellId}:`, error);
            }
        }

        return processedPrompt;
    }
}
