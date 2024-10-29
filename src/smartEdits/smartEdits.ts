import Chatbot from "./chat";
import {
    TranslationPair,
    SmartEditContext,
    SmartSuggestion,
    SavedSuggestions,
    EditHistoryEntry,
} from "../../types";
import * as vscode from "vscode";
import * as path from "path";
import { diffWords } from "diff";

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
        5. Pay close attention to what commonly changes between revisions, and attempt to supply suggestions that implement these if it makes sense.
    `;

export class SmartEdits {
    private chatbot: Chatbot;
    private smartEditsPath: string;
    private lastProcessedCellId: string | null = null;
    private lastSuggestions: SmartSuggestion[] = [];
    private editHistory: { [key: string]: EditHistoryEntry[] } = {};

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartEditsPath = path.join(workspaceUri.fsPath, "files", "smart_edits.json");
        console.log("SmartEdits initialized with path:", this.smartEditsPath);
    }

    async getEdits(text: string, cellId: string): Promise<SmartSuggestion[]> {
        const similarEntries = await this.findSimilarEntries(text);
        const cellHistory = this.editHistory[cellId] || [];

        if (similarEntries.length === 0) {
            this.lastProcessedCellId = cellId;
            this.lastSuggestions = [];
            return [];
        }

        const firstResultCellId = similarEntries[0].cellId;

        if (firstResultCellId === this.lastProcessedCellId) {
            return this.lastSuggestions;
        }

        const savedSuggestions = await this.loadSavedSuggestions(firstResultCellId);

        if (savedSuggestions && savedSuggestions.lastCellValue === text) {
            this.lastProcessedCellId = firstResultCellId;
            this.lastSuggestions = savedSuggestions.suggestions;
            return savedSuggestions.suggestions;
        }

        const similarTexts = await this.getSimilarTexts(similarEntries);

        const similarTextsString = this.formatSimilarTexts(similarTexts);
        const message = this.createEditMessage(similarTextsString, text, cellHistory);

        const jsonResponse = await this.chatbot.getJsonCompletion(message);

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

    async loadSavedSuggestions(cellId: string): Promise<SavedSuggestions | null> {
        try {
            const fileUri = vscode.Uri.file(this.smartEditsPath);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const savedEdits: { [key: string]: SavedSuggestions } = JSON.parse(
                fileContent.toString()
            );
            const result = savedEdits[cellId] || null;
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
        if (suggestions.length === 0) return;
        try {
            let savedEdits: { [key: string]: SavedSuggestions } = {};
            try {
                const fileUri = vscode.Uri.file(this.smartEditsPath);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                savedEdits = JSON.parse(fileContent.toString());
            } catch (error) {
                console.log("No existing saved edits found, starting with empty object");
            }

            savedEdits[cellId] = {
                cellId,
                lastCellValue: text,
                suggestions,
                lastUpdatedDate: new Date().toISOString(),
            };

            const fileUri = vscode.Uri.file(this.smartEditsPath);
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedEdits, null, 2))
            );
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
        const similarTexts: SmartEditContext[] = [];
        for (const entry of similarEntries) {
            if (entry.targetCell.uri) {
                try {
                    let filePath = entry.targetCell.uri
                        .toString()
                        .split(path.sep)
                        .join("/") // Normalize path separators
                        .replace(
                            path.join(".project", "sourceTexts").split(path.sep).join("/"),
                            path.join("files", "target").split(path.sep).join("/")
                        );
                    filePath = filePath.replace(".source", ".codex");
                    const fileUri = vscode.Uri.parse(filePath);
                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const jsonContent = JSON.parse(fileContent.toString());
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
        const formattedTexts = similarTexts
            .map((context) => {
                const edits = context.edits;
                if (edits.length === 0) return "";

                const firstEdit = this.stripHtml(edits[0].cellValue);
                const lastEdit = this.stripHtml(edits[edits.length - 1].cellValue);

                if (edits.length === 1 || firstEdit === lastEdit) return "";

                const diff = this.generateDiff(firstEdit, lastEdit);
                return `"${context.cellId}": {
                        revision 1: ${JSON.stringify(firstEdit)}
                        revision 2: ${JSON.stringify(lastEdit)}
                        diff:
                    ${diff}
}`;
            })
            .filter((text) => text !== "");
        return `{\n${formattedTexts.join(",\n")}\n}`;
    }

    private stripHtml(text: string): string {
        // Remove HTML tags
        let strippedText = text.replace(/<[^>]*>/g, "");
        // Remove common HTML entities
        strippedText = strippedText.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, "");
        // Remove other numeric HTML entities
        strippedText = strippedText.replace(/&#\d+;/g, "");
        // Remove any remaining & entities
        strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
        return strippedText;
    }

    private generateDiff(oldText: string, newText: string): string {
        const diff = diffWords(oldText, newText);
        return diff
            .map((part) => {
                if (part.added) {
                    return `    + ${part.value}`;
                }
                if (part.removed) {
                    return `    - ${part.value}`;
                }
                return `      ${part.value}`;
            })
            .join("");
    }

    private createEditMessage(
        similarTextsString: string,
        text: string,
        history: EditHistoryEntry[]
    ): string {
        const historyString =
            history.length > 0
                ? `\nRecent edit history for this cell:\n${history
                      .map(
                          (entry) =>
                              `Before: ${entry.before}\nAfter: ${entry.after}\nTimestamp: ${new Date(entry.timestamp).toISOString()}`
                      )
                      .join("\n\n")}`
                : "";

        return `Similar Texts:\n${similarTextsString}\n${historyString}\n\nEdit the following text based on the patterns you've seen in similar texts and recent edits, always return the json format specified. Do not suggest edits that are merely HTML changes. Focus on meaningful content modifications.\nText: ${text}`;
    }

    async updateEditHistory(cellId: string, history: EditHistoryEntry[]): Promise<void> {
        this.editHistory[cellId] = history;
        console.log(`Updated edit history for cellId: ${cellId}`);
    }
}
