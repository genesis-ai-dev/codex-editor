import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";

const SYSTEM_MESSAGE = `You are a helpful assistant translation assistant.
You will be given texts in rare languages. 
Then you will be asked to create a backtranslation of that text back into a larger language like English etc.
The texts you will be given are mostly Bible texts. The purpose of the backtranslations you generate is to help
ensure quality of the translation you are given. The backtranslations help translators understand what they are saying,
and may help others who are not familiar with the language grasp the meaning of the original translated text.
It is important to maintain the meaning, culturally, of the original text. On a simple level, a backtranslation can be thought of as
a word-for-word literal translation.

Your response should follow this JSON format:
{
    "backtranslation": "MARKDOWN_TEXT",
}
The backtranslation should be in markdown format, and include notes that may be relevant for the translator.

For example, given this text in a rare language:
"Yesu i tok, 'Yu mas laikim ol arapela man wankain olsem yu laikim yu yet.'"

Your response should be:
{
    "backtranslation": "Jesus said, 'You must love other people the same way you love yourself.'\n\n*Note: The original uses 'laikim' which has connotations of both 'love' and 'like'. The context suggests the stronger meaning 'love' is intended here.*"
}
`;

export interface SavedBacktranslation {
    cellId: string;
    originalText: string;
    backtranslation: string;
    lastUpdated: number;
}

export class SmartBacktranslation {
    private chatbot: Chatbot;
    private backtranslationPath: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.backtranslationPath = path.join(workspaceUri.fsPath, "files", "backtranslations.json");
    }

    async generateBacktranslation(text: string, cellId: string): Promise<SavedBacktranslation> {
        const similarBacktranslations = await this.findSimilarBacktranslations(text);
        const context = this.formatSimilarBacktranslations(similarBacktranslations);

        const message = `
Similar backtranslations:
${context}

Please provide a backtranslation for the following text:
${text}
`;

        const response = await this.chatbot.getJsonCompletion(message);

        const backtranslation: SavedBacktranslation = {
            cellId,
            originalText: text,
            backtranslation: response.backtranslation,
            lastUpdated: Date.now(),
        };

        await this.saveBacktranslation(backtranslation);
        return backtranslation;
    }

    async editBacktranslation(
        cellId: string,
        newText: string,
        existingBacktranslation: string
    ): Promise<SavedBacktranslation> {
        const message = `
Existing backtranslation:
${existingBacktranslation}

The original text has been updated. Please update the backtranslation accordingly:
${newText}
`;

        const response = await this.chatbot.getJsonCompletion(message);

        const updatedBacktranslation: SavedBacktranslation = {
            cellId,
            originalText: newText,
            backtranslation: response.backtranslation,
            lastUpdated: Date.now(),
        };

        await this.saveBacktranslation(updatedBacktranslation);
        return updatedBacktranslation;
    }

    private async findSimilarBacktranslations(
        originalText: string
    ): Promise<SavedBacktranslation[]> {
        const similarEntries = await this.findSimilarEntries(originalText);
        const savedBacktranslations = await this.loadSavedBacktranslations();

        const similarBacktranslations = similarEntries
            .map((entry) => savedBacktranslations[entry.cellId])
            .filter((bt): bt is SavedBacktranslation => bt !== undefined)
            .sort((a, b) => b.lastUpdated - a.lastUpdated)
            .slice(0, 5);

        return similarBacktranslations;
    }

    private async findSimilarEntries(originalText: string): Promise<TranslationPair[]> {
        try {
            const results = await vscode.commands.executeCommand<TranslationPair[]>(
                "translators-copilot.searchParallelCells",
                originalText
            );
            return results || [];
        } catch (error) {
            console.error("Error searching parallel cells:", error);
            return [];
        }
    }

    private formatSimilarBacktranslations(backtranslations: SavedBacktranslation[]): string {
        return backtranslations
            .map(
                (bt) => `
CellId: ${bt.cellId}
Original: ${bt.originalText}
Backtranslation: ${bt.backtranslation}
`
            )
            .join("\n");
    }

    private async loadSavedBacktranslations(): Promise<{ [key: string]: SavedBacktranslation }> {
        try {
            const fileUri = vscode.Uri.file(this.backtranslationPath);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(fileContent.toString());
        } catch (error) {
            console.log("No existing saved backtranslations found, starting with empty object");
            return {};
        }
    }

    private async saveBacktranslation(backtranslation: SavedBacktranslation): Promise<void> {
        try {
            const savedBacktranslations = await this.loadSavedBacktranslations();
            savedBacktranslations[backtranslation.cellId] = backtranslation;

            const fileUri = vscode.Uri.file(this.backtranslationPath);
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(JSON.stringify(savedBacktranslations, null, 2))
            );
        } catch (error) {
            console.error("Error saving backtranslation:", error);
        }
    }

    async getBacktranslation(cellId: string): Promise<SavedBacktranslation | null> {
        const savedBacktranslations = await this.loadSavedBacktranslations();
        return savedBacktranslations[cellId] || null;
    }

    async getAllBacktranslations(): Promise<SavedBacktranslation[]> {
        const savedBacktranslations = await this.loadSavedBacktranslations();
        return Object.values(savedBacktranslations);
    }

    async setBacktranslation(
        cellId: string,
        originalText: string,
        userBacktranslation: string
    ): Promise<SavedBacktranslation> {
        const backtranslation: SavedBacktranslation = {
            cellId,
            originalText,
            backtranslation: userBacktranslation,
            lastUpdated: Date.now(),
        };

        await this.saveBacktranslation(backtranslation);
        return backtranslation;
    }
}
