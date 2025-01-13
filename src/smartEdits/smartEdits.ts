import Chatbot from "./chat";
import {
    TranslationPair,
    SmartEditContext,
    SmartSuggestion,
    SavedSuggestions,
    EditHistoryEntry,
} from "../../types";
import * as vscode from "vscode";
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
        6. The replacements should focus as few words as possible, break into multiple suggestions when needed.
    `;

export class SmartEdits {
    private chatbot: Chatbot;
    private smartEditsPath: vscode.Uri;
    private teachFile: vscode.Uri;
    private lastProcessedCellId: string | null = null;
    private lastSuggestions: SmartSuggestion[] = [];
    private editHistory: { [key: string]: EditHistoryEntry[] } = {};

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartEditsPath = vscode.Uri.joinPath(workspaceUri, "files", "smart_edits.json");
        this.teachFile = vscode.Uri.joinPath(workspaceUri, "files", "silver_path_memories.json");

        this.ensureFileExists(this.smartEditsPath);
        this.ensureFileExists(this.teachFile);
    }

    private async ensureFileExists(fileUri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch (error) {
            if ((error as any).code === "FileNotFound") {
                await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
            } else {
                throw error;
            }
        }
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

        await this.saveSuggestions(firstResultCellId, text, suggestions);
        this.lastProcessedCellId = firstResultCellId;
        this.lastSuggestions = suggestions;
        return suggestions;
    }

    async loadSavedSuggestions(cellId: string): Promise<SavedSuggestions | null> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.smartEditsPath);
            const fileString = fileContent.toString();
            const savedEdits: { [key: string]: SavedSuggestions } = fileString
                ? JSON.parse(fileString)
                : {};
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
                const fileContent = await vscode.workspace.fs.readFile(this.smartEditsPath);
                const fileString = fileContent.toString();
                savedEdits = fileString ? JSON.parse(fileString) : {};
            } catch (error) {
                console.log("No existing saved edits found, starting with empty object");
            }

            savedEdits[cellId] = {
                cellId,
                lastCellValue: text,
                suggestions,
                lastUpdatedDate: new Date().toISOString(),
            };

            await vscode.workspace.fs.writeFile(
                this.smartEditsPath,
                Buffer.from(JSON.stringify(savedEdits, null, 2))
            );
        } catch (error) {
            console.error("Error saving suggestions:", error);
        }
    }

    private async findSimilarEntries(text: string): Promise<TranslationPair[]> {
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

    private async getSimilarTexts(similarEntries: TranslationPair[]): Promise<SmartEditContext[]> {
        const similarTexts: SmartEditContext[] = [];
        const allMemories = await this.readAllMemories();

        for (const entry of similarEntries) {
            if (entry.targetCell.uri) {
                try {
                    const uri = vscode.Uri.parse(entry.targetCell.uri.toString());
                    const pathSegments = uri.path.split("/").filter(Boolean);

                    // Create new path segments array with modifications
                    const newPathSegments = pathSegments
                        .map((segment) => {
                            if (segment === ".source") return ".codex";
                            if (segment === "sourceTexts") return "target";
                            return segment;
                        })
                        .filter((segment) => segment !== ".project");

                    // Ensure 'files' is in the correct position
                    if (!newPathSegments.includes("files")) {
                        newPathSegments.unshift("files");
                    }

                    // Create new URI with modified path
                    const fileUri = uri.with({ path: "/" + newPathSegments.join("/") });

                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const fileString = fileContent.toString();
                    const jsonContent = fileString ? JSON.parse(fileString) : { cells: [] };
                    const cell = jsonContent.cells?.find(
                        (cell: any) => cell.metadata.id === entry.cellId
                    );
                    if (cell) {
                        const context: SmartEditContext = {
                            cellId: entry.cellId,
                            currentCellValue: cell.value,
                            edits: cell.metadata.edits || [],
                            memory: allMemories[entry.cellId]?.content || "",
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
        return similarTexts;
    }

    private formatSimilarTexts(similarTexts: SmartEditContext[]): string {
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
                        memory: ${JSON.stringify(context.memory)}
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
    }

    private async readAllMemories(): Promise<{
        [cellId: string]: { content: string; times_used: number };
    }> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.teachFile);
            const fileString = fileContent.toString();
            return fileString ? JSON.parse(fileString) : {};
        } catch (error) {
            console.error("Error reading memories:", error);
            return {};
        }
    }
}
