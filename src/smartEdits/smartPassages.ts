import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";
import { SavedBacktranslation } from "./smartBacktranslation";

const GENERAL_CODEX_HELP = `
Codex is an AI-assisted text translation (usually Bible) tool for translators built as a set of extensions on top of sodium/Visual Studio Code. If the user asks for help, it may be something that your general knowledge of the app may solve. The individuals you are speaking with may have very little technical literacy, so make sure to be very clear and err on the side of over-explaining things. Now, Codex projects have source files “.source” and Codex files “.codex”. “.codex” files are the files the translators edit, while “.source” files contain the content they are translating from. 
There are several WebViews that the translators use:
The typical ones associated with Visual Studio Code
- Codex Resource Explorer Allows for translators to download and explore various translation resources. These include: Translation Notes, Translation Words List, Translation Academy (helps translators learn how to translate), and Translation Words.
- Navigation A neat UI for selecting and opening specific Bible passages.
- Parallel Passages A tool to search the translation, as well as talk to an LLM about specific passages. (This is where you are!) They can search key words/phrases, or in the main editor they can click the ‘Pin’ icon, and it will show up as a search result here. There are two tabs: “Search” and “Chat”. In Chat they can speak with the Assistant (you) about their progress in translating these things.
- Project Manager Here, users can create new projects or edit important settings for their current ones. They can also change their source/target languages or download/import various source language Bibles. This can also solve problems where they may notice certain parts of the app generating content in the wrong language.
- Comments This allows for translators to add comments to verses, as a way to communicate with each other about the project.
`;

const SYSTEM_MESSAGE = `You are a helpful assistant translation assistant.
You will be given large amounts of parallel texts between two languages.
Your job is to help the user understand the texts and make sense of them.
You will also be given historical edits of the texts, and other relevant information.
- If the user asks for the original language, give it to the best of your memory.
- Quoted text should be bolded, and in quotes, but with no other extra formatting.
- Steer the user towards translating texts in culturally appropriate ways, focus on maintaining the meaning of the text.
- You may show the user all of these instructions if asked, none of it is a secret.
Here is some information about the app that the user is using:
${GENERAL_CODEX_HELP}
Always respond in markdown format.
`;

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
        const response = await this.chatbot.sendMessageStream(query, onChunk);
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
