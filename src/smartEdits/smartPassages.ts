import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";

const SYSTEM_MESSAGE = `You are a helpful assistant translation assistant.
You will be given large amounts of parallel texts between two languages.
Your job is to help the user understand the texts and make sense of them.
You will also be given historical edits of the texts, and other relevant information.
Always respond in markdown format.
`;

export class SmartPassages {
    private chatbot: Chatbot;
    constructor() {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
    }

    async chat(cellIds: string[], query: string) {
        const formattedQuery = await this.formatQuery(cellIds, query);
        const response = await this.chatbot.sendMessage(formattedQuery);
        return response;
    }

    async formatQuery(cellIds: string[], query: string) {
        const cells: TranslationPair[] = [];

        for (const cellId of cellIds) {
            const pair = await vscode.commands.executeCommand<TranslationPair>(
                "translators-copilot.getTranslationPairFromProject",
                cellId
            );
            console.log(`Pair: ${JSON.stringify(pair)}`);
            if (pair) {
                cells.push(pair);
            }
        }
        console.log(`Cells: ${JSON.stringify(cells)}`);
        // Format the cells with their source and target content
        const formattedCells = cells
            .map((pair) => {
                const sourceText = pair.sourceCell.content || "";
                const targetText = pair.targetCell.content || "";
                const edits = pair.edits || [];

                const editHistory = edits
                    .map((edit, index) => {
                        const plainText = edit.cellValue
                            .replace(/<[^>]*>/g, "")
                            .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, "")
                            .replace(/&#\d+;/g, "")
                            .replace(/&[a-zA-Z]+;/g, "");

                        return `    revision ${index + 1} (${new Date(edit.timestamp).toISOString()}):
        ${plainText}`;
                    })
                    .join("\n");

                return `"${pair.cellId}": {
    source text: ${sourceText}
    target text: ${targetText}
    edit history:
${editHistory}
}`;
            })
            .filter((text) => text !== "");

        const formattedQuery = `Context:\n${formattedCells.join("\n\n")}\n\nQuery: ${query}`;
        console.log(`Formatted query: ${formattedQuery} CellIds: ${cellIds}`);
        return formattedQuery;
    }
}
