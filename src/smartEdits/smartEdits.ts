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
import { ICEEdits } from "./iceEdits";
import { tokenizeText } from "@/utils/nlpUtils";

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
    private iceEdits: ICEEdits;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.smartEditsPath = vscode.Uri.joinPath(workspaceUri, "files", "smart_edits.json");
        this.teachFile = vscode.Uri.joinPath(workspaceUri, "files", "silver_path_memories.json");
        this.iceEdits = new ICEEdits(workspaceUri.fsPath);

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

        // Get ICE suggestions first
        const tokens = tokenizeText({ method: "whitespace", text });
        const iceSuggestions: SmartSuggestion[] = [];

        // Process each word/token for ICE suggestions
        for (let i = 0; i < tokens.length; i++) {
            const leftToken = i > 0 ? tokens[i - 1] : "";
            const rightToken = i < tokens.length - 1 ? tokens[i + 1] : "";
            const currentToken = tokens[i];

            const suggestions = await this.iceEdits.calculateSuggestions(
                currentToken,
                leftToken,
                rightToken
            );

            // Convert ICE suggestions to SmartSuggestions
            suggestions.forEach((suggestion) => {
                iceSuggestions.push({
                    oldString: suggestion.original,
                    newString: suggestion.replacement,
                    confidence: suggestion.confidence,
                    source: "ice",
                    frequency: suggestion.frequency,
                });
            });
        }

        // If we have high-confidence ICE suggestions, return them immediately
        const highConfidenceIceSuggestions = iceSuggestions.filter((s) => s.confidence === "high");
        if (highConfidenceIceSuggestions.length > 0) {
            this.lastProcessedCellId = cellId;
            this.lastSuggestions = highConfidenceIceSuggestions;
            return highConfidenceIceSuggestions;
        }

        // Continue with LLM suggestions if no high-confidence ICE suggestions
        if (similarEntries.length === 0) {
            this.lastProcessedCellId = cellId;
            // Include low-confidence ICE suggestions if available
            this.lastSuggestions = iceSuggestions;
            return iceSuggestions;
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

        let llmSuggestions: SmartSuggestion[] = [];
        if (Array.isArray(jsonResponse.suggestions)) {
            llmSuggestions = jsonResponse.suggestions.map((suggestion: any) => ({
                oldString: suggestion.oldString || "",
                newString: suggestion.newString || "",
                source: "llm",
            }));
        }

        // Combine LLM suggestions with ICE suggestions
        const allSuggestions = [...llmSuggestions, ...iceSuggestions];
        await this.saveSuggestions(firstResultCellId, text, allSuggestions);

        this.lastProcessedCellId = firstResultCellId;
        this.lastSuggestions = allSuggestions;
        return allSuggestions;
    }

    async loadSavedSuggestions(cellId: string): Promise<SavedSuggestions | null> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.smartEditsPath);
            const fileString = fileContent.toString();
            const savedEdits: { [key: string]: SavedSuggestions } = fileString
                ? JSON.parse(fileString)
                : {};
            const result = savedEdits[cellId] || null;

            if (result) {
                // Filter out rejected suggestions
                result.suggestions = result.suggestions.filter(
                    (suggestion) =>
                        !result.rejectedSuggestions?.some(
                            (rejected) =>
                                rejected.oldString === suggestion.oldString &&
                                rejected.newString === suggestion.newString
                        )
                );
            }

            return result;
        } catch (error) {
            console.error("Error loading saved suggestions:", error);
            return null;
        }
    }

    /**
     * Mark a smart edit suggestion as rejected
     */
    async rejectSmartSuggestion(
        cellId: string,
        oldString: string,
        newString: string
    ): Promise<void> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.smartEditsPath);
            const fileString = fileContent.toString();
            const savedEdits: { [key: string]: SavedSuggestions } = fileString
                ? JSON.parse(fileString)
                : {};

            const cellEdits = savedEdits[cellId];
            if (cellEdits) {
                // Initialize rejectedSuggestions if it doesn't exist
                if (!cellEdits.rejectedSuggestions) {
                    cellEdits.rejectedSuggestions = [];
                }

                // Add to rejected suggestions if not already there
                if (
                    !cellEdits.rejectedSuggestions.some(
                        (s) => s.oldString === oldString && s.newString === newString
                    )
                ) {
                    cellEdits.rejectedSuggestions.push({ oldString, newString });
                }

                // Filter out the rejected suggestion from current suggestions
                cellEdits.suggestions = cellEdits.suggestions.filter(
                    (s) => !(s.oldString === oldString && s.newString === newString)
                );

                savedEdits[cellId] = cellEdits;
                await vscode.workspace.fs.writeFile(
                    this.smartEditsPath,
                    Buffer.from(JSON.stringify(savedEdits, null, 2))
                );
            }
        } catch (error) {
            console.error("Error rejecting smart suggestion:", error);
            throw error;
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

        // Record each edit in ICE edits using the new recordFullEdit method
        for (const entry of history) {
            await this.iceEdits.recordFullEdit(entry.before, entry.after);
        }
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

    async getIceEdits(text: string): Promise<SmartSuggestion[]> {
        const tokens = tokenizeText({ method: "whitespace", text });
        const iceSuggestions: SmartSuggestion[] = [];

        // Process each word/token for ICE suggestions
        for (let i = 0; i < tokens.length; i++) {
            const leftToken = i > 0 ? tokens[i - 1] : "";
            const rightToken = i < tokens.length - 1 ? tokens[i + 1] : "";
            const currentToken = tokens[i];

            const suggestions = await this.iceEdits.calculateSuggestions(
                currentToken,
                leftToken,
                rightToken
            );

            suggestions.forEach((suggestion) => {
                iceSuggestions.push({
                    oldString: currentToken,
                    newString: suggestion.replacement,
                    confidence: suggestion.confidence,
                    source: "ice",
                    frequency: suggestion.frequency,
                });
            });
        }

        return iceSuggestions;
    }
}
