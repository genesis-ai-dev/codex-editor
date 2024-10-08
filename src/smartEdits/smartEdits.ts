import Chatbot from "./chat";
import { TranslationPair, SmartEditContext, SmartSuggestion, SavedSuggestions } from "../../types";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
const SYSTEM_MESSAGE = `You are a helpful assistant. Given similar edits across a corpus, you will suggest edits to a new text. 
Your suggestions should follow this format:
    {
        "suggestions": [
            {
                "oldString": "The old string to be replaced",
                "newString": "The new string to replace the old string"
            },
            {
                "oldString": "The old string to be replaced",
                "newString": "The new string to replace the old string"
            }
        ]
    }
    Rules:
        1. These will be in languages you may not be familiar with, so try your best anyways and use the context to infer the correct potential edits.
        2. Do not make edits based only on HTML. Preserve all HTML tags in the text.
        3. If no edits are needed, return this default response:
        {
            "suggestions": []
        }
        4. Focus on meaningful content changes, not just HTML structure modifications.
    `;

export class SmartEdits {
    private chatbot: Chatbot;
    private smartEditsPath: string;
    private lastProcessedCellId: string | null = null;
    private lastSuggestions: SmartSuggestion[] = [];

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartEditsPath = path.join(workspaceUri.fsPath, "files", "smart_edits.json");
        console.log("SmartEdits initialized with path:", this.smartEditsPath);
    }

    async getEdits(text: string, cellId: string): Promise<SmartSuggestion[]> {
        console.log(`Getting edits for cellId: ${cellId}`);

        const similarEntries = await this.findSimilarEntries(text);
        console.log(`Found ${similarEntries.length} similar entries`);

        if (similarEntries.length === 0) {
            console.log("No similar entries found. Returning empty suggestions.");
            this.lastProcessedCellId = cellId;
            this.lastSuggestions = [];
            return [];
        }

        const firstResultCellId = similarEntries[0].cellId;
        console.log(`Using cellId from first result: ${firstResultCellId}`);

        if (firstResultCellId === this.lastProcessedCellId) {
            console.log("Cell hasn't changed. Returning last suggestions.");
            return this.lastSuggestions;
        }

        const savedSuggestions = await this.loadSavedSuggestions(firstResultCellId);

        if (savedSuggestions && savedSuggestions.lastCellValue === text) {
            console.log("Using saved suggestions for cellId:", firstResultCellId);
            this.lastProcessedCellId = firstResultCellId;
            this.lastSuggestions = savedSuggestions.suggestions;
            return savedSuggestions.suggestions;
        }

        console.log("Getting similar texts...");
        const similarTexts = await this.getSimilarTexts(similarEntries);
        console.log(`Retrieved ${similarTexts.length} similar texts`);

        const similarTextsString = this.formatSimilarTexts(similarTexts);
        const message = this.createEditMessage(similarTextsString, text);

        console.log("Sending message to chatbot...");
        const jsonResponse = await this.chatbot.getJsonCompletion(message);
        console.log("Received response from chatbot:", jsonResponse);

        let suggestions: SmartSuggestion[] = [];
        if (Array.isArray(jsonResponse.suggestions)) {
            suggestions = jsonResponse.suggestions.map((suggestion: any) => ({
                oldString: suggestion.oldString || "",
                newString: suggestion.newString || "",
            }));
        }

        console.log(`Generated ${suggestions.length} suggestions`);
        await this.saveSuggestions(firstResultCellId, text, suggestions);
        this.lastProcessedCellId = firstResultCellId;
        this.lastSuggestions = suggestions;
        return suggestions;
    }

    private async loadSavedSuggestions(cellId: string): Promise<SavedSuggestions | null> {
        try {
            console.log(`Loading saved suggestions for cellId: ${cellId}`);
            const fileContent = await fs.readFile(this.smartEditsPath, "utf8");
            const savedEdits: { [key: string]: SavedSuggestions } = JSON.parse(fileContent);
            const result = savedEdits[cellId] || null;
            console.log(`Loaded suggestions for cellId ${cellId}:`, result);
            return result;
        } catch (error) {
            console.error("Error loading saved suggestions:", error);
            return null;
        }
    }

    private async saveSuggestions(
        cellId: string,
        text: string,
        suggestions: SmartSuggestion[]
    ): Promise<void> {
        try {
            console.log(`Saving suggestions for cellId: ${cellId}`);
            let savedEdits: { [key: string]: SavedSuggestions } = {};
            try {
                const fileContent = await fs.readFile(this.smartEditsPath, "utf8");
                savedEdits = JSON.parse(fileContent);
            } catch (error) {
                console.log("No existing saved edits found, starting with empty object");
            }

            savedEdits[cellId] = {
                cellId,
                lastCellValue: text,
                suggestions,
            };

            await fs.writeFile(this.smartEditsPath, JSON.stringify(savedEdits, null, 2));
            console.log(`Saved suggestions for cellId: ${cellId}`);
        } catch (error) {
            console.error("Error saving suggestions:", error);
        }
    }

    private async findSimilarEntries(text: string): Promise<TranslationPair[]> {
        console.log("Finding similar entries for text:", text);
        try {
            const results = await vscode.commands.executeCommand<TranslationPair[]>(
                "translators-copilot.searchParallelCells",
                text
            );
            console.log(`Found ${results?.length || 0} similar entries`);
            return results || [];
        } catch (error) {
            console.error("Error searching parallel cells:", error);
            return [];
        }
    }
    private async getSimilarTexts(similarEntries: TranslationPair[]): Promise<SmartEditContext[]> {
        console.log(`Getting similar texts for ${similarEntries.length} entries`);
        const similarTexts: SmartEditContext[] = [];
        for (const entry of similarEntries) {
            if (entry.targetCell.uri) {
                try {
                    let filePath = entry.targetCell.uri
                        .toString()
                        .replace(".project/sourceTexts", "files/target");
                    filePath = filePath.replace(".source", ".codex");
                    console.log(`Reading file for cellId ${entry.cellId}: ${filePath}`);
                    const fileContent = await fs.readFile(
                        vscode.Uri.parse(filePath).fsPath,
                        "utf8"
                    );
                    const jsonContent = JSON.parse(fileContent);
                    const cell = jsonContent.cells.find(
                        (cell: any) => cell.metadata.id === entry.cellId
                    );
                    if (cell) {
                        const context: SmartEditContext = {
                            cellId: entry.cellId,
                            currentCellValue: cell.value,
                            edits: cell.metadata.edits || [],
                        };
                        similarTexts.push(context);
                        console.log(`Added context for cellId: ${entry.cellId}`);
                    } else {
                        console.log(`Cell not found for cellId: ${entry.cellId}`);
                    }
                } catch (error) {
                    console.error(`Error reading file for cellId ${entry.cellId}:`, error);
                }
            } else {
                console.log(`No valid URI found for cellId: ${entry.cellId}`);
            }
        }
        console.log(`Retrieved ${similarTexts.length} similar texts`);
        return similarTexts;
    }

    private formatSimilarTexts(similarTexts: SmartEditContext[]): string {
        console.log(`Formatting ${similarTexts.length} similar texts`);
        const formattedTexts = similarTexts.map((context) => {
            const revisions = context.edits
                .map((edit, index) => {
                    return `revision ${index + 1}: ${JSON.stringify(edit.cellValue)}`;
                })
                .join(",\n");
            return `"${context.cellId}": {\n${revisions}\n}`;
        });
        return `{\n${formattedTexts.join(",\n")}\n}`;
    }

    private createEditMessage(similarTextsString: string, text: string): string {
        console.log("Creating edit message");
        const message = `Similar Texts:\n${similarTextsString}\n\nEdit the following text based on the patterns you've seen in similar texts, always return the json format specified. Do not suggest edits that are merely HTML changes. Focus on meaningful content modifications.\nText: ${text}`;
        console.log("Edit message created: ", message);
        return message;
    }
}
