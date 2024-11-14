import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";

// The system message says to respond in the third person, not sure if we should keep that or not.
const SYSTEM_MESSAGE = `You are a helpful assistant translation assistant.
You will be given large amounts of parallel texts between two languages.
Your job is to help the user understand the texts and make sense of them.
You will also be given historical edits of the texts, and other relevant information.
- If the user asks for the original language, you should respond with the original language of the text within a codeblock for clarity.
- If the user asks for technical help with "codex", respond that you are not capable of that yet, but you will be able to soon. Feel free to attempt to help them with other technical questions.
- Steer the user towards translating texts in culturally appropriate ways, focus on maintaining the meaning of the text.
- Always respond in the third person.
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

    async chatStream(
        cellIds: string[],
        query: string,
        onChunk: (chunk: string) => void,
        editIndex?: number
    ) {
        const formattedQuery = await this.formatQuery(cellIds, query);
        if (editIndex !== undefined) {
            await this.chatbot.editMessage(editIndex, formattedQuery);
            const response = await this.chatbot.sendMessageStream(formattedQuery, onChunk);
            return response;
        }
        const response = await this.chatbot.sendMessageStream(formattedQuery, onChunk);
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
            if (pair && pair.targetCell.uri) {
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
                        pair.edits = cell.metadata.edits || [];
                    }
                } catch (error) {
                    console.error(`Error reading file for cellId ${pair.cellId}:`, error);
                }
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
