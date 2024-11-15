import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";
import { SavedPrompt, TargetCell } from "./types";

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
                // Save the updated prompt and generated text based on LLM's decision
                await this.savePromptAndTextToCellId(
                    cellId,
                    response.updatedPrompt,
                    response.modifiedText,
                    response.updateType,
                    false // Default isPinned to false when applying a new edit
                );
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

    async getTopPrompts(
        cellId: string,
        text: string
    ): Promise<Array<{ prompt: string; isPinned: boolean }>> {
        const similarCells = await this.findSimilarCells(text);
        const cellIds = [cellId, ...similarCells.map((cell) => cell.cellId)];

        // Read the saved prompts file
        const fileUri = vscode.Uri.file(this.smartPromptPath);
        let savedPrompts: { [key: string]: SavedPrompt } = {};
        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            savedPrompts = JSON.parse(fileContent.toString());
        } catch (error) {
            console.log("Error reading saved prompts:", error);
        }

        // Get all pinned prompts
        const pinnedPrompts = Object.values(savedPrompts)
            .filter((prompt) => prompt.isPinned)
            .map((prompt) => ({ prompt: prompt.prompt, isPinned: true }));

        // Get prompt and pinned status for current cell and similar cells
        const promptsWithPinStatus = await Promise.all(
            cellIds.map(async (id) => {
                const savedPrompt = savedPrompts[id];
                if (savedPrompt) {
                    return { prompt: savedPrompt.prompt, isPinned: savedPrompt.isPinned };
                }
                return null;
            })
        );

        // Combine pinned prompts and filtered prompts, then remove duplicates
        const allPrompts = [
            ...pinnedPrompts,
            ...promptsWithPinStatus.filter(
                (item): item is { prompt: string; isPinned: boolean } => item !== null
            ),
        ];

        // Remove duplicates based on prompt text
        const uniquePrompts = allPrompts.reduce(
            (acc, current) => {
                const x = acc.find((item) => item.prompt === current.prompt);
                if (!x) {
                    return acc.concat([current]);
                } else {
                    // If duplicate, keep the pinned version if either is pinned
                    return acc.map((item) =>
                        item.prompt === current.prompt
                            ? { ...item, isPinned: item.isPinned || current.isPinned }
                            : item
                    );
                }
            },
            [] as Array<{ prompt: string; isPinned: boolean }>
        );

        return uniquePrompts;
    }

    private async savePromptAndTextToCellId(
        cellId: string,
        prompt: string,
        generatedText: string,
        updateType: string,
        isPinned: boolean
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

            // Check if any existing prompt with the same text is pinned
            const existingPinnedState = Object.values(savedPrompts).some(
                (savedPrompt) => savedPrompt.prompt === prompt && savedPrompt.isPinned
            );

            // Update or initialize the prompt and generated text
            savedPrompts[cellId] = {
                cellId,
                prompt,
                generatedText,
                lastUpdated: Date.now(),
                updateCount: (savedPrompts[cellId]?.updateCount || 0) + 1,
                isPinned:
                    existingPinnedState || isPinned || savedPrompts[cellId]?.isPinned || false,
            };

            const fileUri = vscode.Uri.file(this.smartPromptPath);
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedPrompts, null, 2))
            );
        } catch (error) {
            console.error("Error saving prompt and generated text:", error);
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

    // Add a new method to handle pinning/unpinning prompts
    async togglePinPrompt(cellId: string, promptText: string): Promise<boolean> {
        try {
            const fileUri = vscode.Uri.file(this.smartPromptPath);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const savedPrompts: { [key: string]: SavedPrompt } = JSON.parse(fileContent.toString());

            // Find if any existing prompt with the same text is pinned
            const isPinned = Object.values(savedPrompts).some(
                (prompt) => prompt.prompt === promptText && prompt.isPinned
            );

            // Toggle pin state for all prompts with matching text
            for (const key in savedPrompts) {
                if (savedPrompts[key].prompt === promptText) {
                    savedPrompts[key].isPinned = !isPinned;
                }
            }

            // If the prompt doesn't exist for this cellId, add it
            if (!savedPrompts[cellId]) {
                savedPrompts[cellId] = {
                    cellId,
                    prompt: promptText,
                    generatedText: "",
                    lastUpdated: Date.now(),
                    updateCount: 1,
                    isPinned: !isPinned,
                };
            }

            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedPrompts, null, 2))
            );
            return !isPinned;
        } catch (error) {
            console.error("Error toggling pin status:", error);
            return false;
        }
    }
}
