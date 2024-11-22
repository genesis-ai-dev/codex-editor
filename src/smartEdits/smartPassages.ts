import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";
import { SavedBacktranslation } from "./smartBacktranslation";
import { SYSTEM_MESSAGE } from "./prompts";

interface TranslationPairWithBacktranslation extends TranslationPair {
    backtranslation?: string;
    feedback?: string;
}

interface Feedback {
    content: string;
}

export class SmartPassages {
    private chatbot: Chatbot;
    private feedbackFile: string;

    constructor() {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        // Assuming the workspace URI is available. You might need to pass it to the constructor.
        const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri;
        if (workspaceUri) {
            this.feedbackFile = path.join(
                workspaceUri.fsPath,
                "files",
                "smart_passages_memories.json"
            );
        } else {
            throw new Error("No workspace found");
        }
    }

    async chat(cellIds: string[], query: string) {
        await this.updateContext(cellIds);
        const response = await this.chatbot.sendMessage(query);
        return response;
    }

    async chatStream(
        cellIds: string[],
        query: string,
        onChunk: (chunk: string) => void,
        editIndex?: number
    ) {
        await this.updateContext(cellIds);
        if (editIndex !== undefined) {
            await this.chatbot.editMessage(editIndex, query);
        }
        const response = await this.chatbot.sendMessageStream(query, (chunk, isLast) => {
            onChunk(
                JSON.stringify({
                    index: chunk.index,
                    content: chunk.content,
                    isLast: isLast,
                })
            );
        });
        return response;
    }

    private async updateContext(cellIds: string[]) {
        const formattedContext = await this.formatContext(cellIds);
        await this.chatbot.setContext(formattedContext);
    }

    private async formatContext(cellIds: string[]): Promise<string> {
        const cells: TranslationPairWithBacktranslation[] = [];
        const generalEntries: { cellId: string; content: string }[] = [];
        const allMemories = await this.readAllMemories();

        // Separate general entries
        Object.entries(allMemories).forEach(([id, feedback]) => {
            if (id.startsWith("General")) {
                generalEntries.push({ cellId: id, content: feedback.content });
            }
        });

        // Add specific cell IDs
        for (const cellId of cellIds) {
            const pair = await vscode.commands.executeCommand<TranslationPair | null>(
                "translators-copilot.getTranslationPairFromProject",
                cellId
            );
            console.log(`Pair: ${JSON.stringify(pair)}`);

            const pairWithBacktranslation: TranslationPairWithBacktranslation = pair
                ? {
                      ...pair,
                      backtranslation: undefined,
                      edits: [],
                      feedback: undefined,
                  }
                : { cellId, sourceCell: { content: "" }, targetCell: { content: "" } };

            if (pair) {
                if (pair.targetCell.uri) {
                    try {
                        // Get the file content similar to SmartEdits
                        let filePath = pair.targetCell.uri
                            .toString()
                            .replace(".source", ".codex")
                            .replace(".project/sourceTexts/", "files/target/");
                        filePath = filePath.replace(".source", ".codex");
                        const fileUri = vscode.Uri.parse(filePath);
                        const fileContent = await vscode.workspace.fs.readFile(fileUri);
                        const jsonContent = JSON.parse(fileContent.toString());

                        // Find the cell and get its edits
                        const cell = jsonContent.cells.find(
                            (cell: any) => cell.metadata.id === pair.cellId
                        );
                        if (cell) {
                            pairWithBacktranslation.edits = cell.metadata.edits || [];
                        }
                    } catch (error) {
                        console.error(`Error reading file for cellId ${pair.cellId}:`, error);
                    }
                }

                try {
                    // Get backtranslation for the cell
                    const backtranslation =
                        await vscode.commands.executeCommand<SavedBacktranslation | null>(
                            "codex-smart-edits.getBacktranslation",
                            pair.cellId
                        );
                    if (backtranslation) {
                        pairWithBacktranslation.backtranslation = backtranslation.backtranslation;
                    }
                } catch (error) {
                    console.error(
                        `Error getting backtranslation for cellId ${pair.cellId}:`,
                        error
                    );
                }
            }

            // Add feedback to the pair
            if (allMemories[cellId]) {
                pairWithBacktranslation.feedback = allMemories[cellId].content;
            }

            cells.push(pairWithBacktranslation);
        }

        // Format the cells and general entries
        const formattedGeneralEntries = generalEntries.map(
            (entry) => `"${entry.cellId}": {
    general feedback: ${entry.content}
}`
        );

        const formattedCells = cells
            .map((pair) => {
                const sourceText = pair.sourceCell?.content || "N/A";
                const targetText = pair.targetCell?.content || "N/A";
                const edits = pair.edits || [];
                const backtranslation = pair.backtranslation || "N/A";
                const feedbackText = pair.feedback ? `\n    feedback: ${pair.feedback}` : "";

                // Only include edit history if there are edits
                const editHistory =
                    edits.length > 0
                        ? edits
                              .map((edit, index) => {
                                  const plainText = edit.cellValue
                                      .replace(/<[^>]*>/g, "")
                                      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, "")
                                      .replace(/&#\d+;/g, "")
                                      .replace(/&[a-zA-Z]+;/g, "");

                                  return `    revision ${index + 1} (${new Date(edit.timestamp).toISOString()}):
        ${plainText}`;
                              })
                              .join("\n")
                        : "";

                return `"${pair.cellId}": {
    source text: ${sourceText}
    target text: ${targetText}
    backtranslation: ${backtranslation}${feedbackText}${editHistory ? "\n    edit history:\n" + editHistory : ""}
}`;
            })
            .filter((text) => text !== "");

        const allFormattedEntries = [...formattedGeneralEntries, ...formattedCells];

        return `Context:\n${allFormattedEntries.join("\n\n")}`;
    }

    async updateFeedback(cellId: string, content: string): Promise<void> {
        const allMemories = await this.readAllMemories();

        if (!allMemories[cellId]) {
            allMemories[cellId] = { content: "" };
        }

        // Trim the existing content and the new content
        const existingContent = allMemories[cellId].content.trim();
        const newContent = content.trim();

        // Add a newline only if there's existing content
        allMemories[cellId].content = existingContent
            ? `${existingContent}\n- ${newContent}`
            : `- ${newContent}`;

        await this.writeAllMemories(allMemories);
    }

    private async readAllMemories(): Promise<{ [cellId: string]: Feedback }> {
        try {
            const data = await fs.readFile(this.feedbackFile, "utf-8");
            const trimmedData = data.trim();
            if (!trimmedData) {
                return {};
            }
            try {
                const parsedData = JSON.parse(trimmedData);
                return typeof parsedData === "object" && parsedData !== null ? parsedData : {};
            } catch (parseError) {
                console.error("Error parsing memories JSON:", parseError);
                // If parsing fails, attempt to repair the file
                await this.validateAndRepairMemories();
                return {};
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // File doesn't exist, create it with an empty object
                await this.writeAllMemories({});
                return {};
            }
            console.error("Error reading memories:", error);
            // In case of any error, return an empty object
            return {};
        }
    }

    private async writeAllMemories(memories: { [cellId: string]: Feedback }): Promise<void> {
        try {
            const safeMemories = typeof memories === "object" && memories !== null ? memories : {};
            const jsonString = JSON.stringify(safeMemories, null, 2);
            await fs.writeFile(this.feedbackFile, jsonString, "utf-8");
        } catch (error) {
            console.error("Error writing memories:", error);
        }
    }

    private async validateAndRepairMemories(): Promise<void> {
        try {
            const data = await fs.readFile(this.feedbackFile, "utf-8");
            const lines = data.split("\n");
            const repairedLines = lines.filter((line) => line.trim() !== "");
            const repairedData = repairedLines.join("\n");
            const parsedData = JSON.parse(repairedData);
            await this.writeAllMemories(parsedData);
        } catch (error) {
            console.error("Error validating and repairing memories:", error);
            // If all else fails, reset to an empty object
            await this.writeAllMemories({});
        }
    }
}
