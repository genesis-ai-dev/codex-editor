import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";
import { SavedBacktranslation } from "./smartBacktranslation";
import { SYSTEM_MESSAGE } from "./prompts";

interface TranslationPairWithBacktranslation extends TranslationPair {
    backtranslation?: string;
}

export class SmartPassages {
    private chatbot: Chatbot;
    constructor() {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
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

        for (const cellId of cellIds) {
            const pair = await vscode.commands.executeCommand<TranslationPair>(
                "translators-copilot.getTranslationPairFromProject",
                cellId
            );
            console.log(`Pair: ${JSON.stringify(pair)}`);
            if (pair && pair.targetCell.uri) {
                const pairWithBacktranslation: TranslationPairWithBacktranslation = { ...pair };
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
                        `Error reading file or getting backtranslation for cellId ${pair.cellId}:`,
                        error
                    );
                }
                cells.push(pairWithBacktranslation);
            }
        }
        console.log(`Cells: ${JSON.stringify(cells)}`);
        // Format the cells with their source, target content, and backtranslation
        const formattedCells = cells
            .map((pair) => {
                const sourceText = pair.sourceCell.content || "";
                const targetText = pair.targetCell.content || "";
                const edits = pair.edits || [];
                const backtranslation = pair.backtranslation || "";

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
    target text: ${targetText}${
        backtranslation ? `\n    backtranslation: ${backtranslation}` : ""
    }${editHistory ? "\n    edit history:\n" + editHistory : ""}
}`;
            })
            .filter((text) => text !== "");

        return `Context:\n${formattedCells.join("\n\n")}`;
    }
}
