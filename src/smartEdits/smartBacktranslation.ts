import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";

const SYSTEM_MESSAGE = `You are a helpful assistant translation assistant.
You will be given texts in rare languages. 
Then you will be asked to create a backtranslation of that text back into a larger language like English etc.
The texts you will be given are mostly Bible texts. A backtranslation is a word-for-word, literal translation
that tries to represent the exact words and structure of the original text, even if it sounds unnatural in English.
For example, if the original says "house of him" instead of "his house", the backtranslation should preserve this structure.

The purpose of these literal backtranslations is to help ensure quality of the translation by showing exactly what
the translated text is saying at a word and meaninglevel. This helps translators verify their work and helps others who don't
know the source language understand the precise meaning and structure of the translation.

Your response should be only the backtranslation text.
The backtranslation should be in markdown format, and include notes that may be relevant for the translator.

For example, given this text in a rare language:
"Yesu i tok, 'Yu mas laikim ol arapela man wankain olsem yu laikim yu yet.'"

Your response should be only the backtranslation text.
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

Respond with only the backtranslation text/markdown.
`;

        const response = await this.chatbot.getCompletion(message);
        const cleanedResponse = this.removeMarkdownFormatting(response);

        const backtranslation: SavedBacktranslation = {
            cellId,
            originalText: text,
            backtranslation: cleanedResponse,
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

        const response = await this.chatbot.getCompletion(message);
        const cleanedResponse = this.removeMarkdownFormatting(response);

        const updatedBacktranslation: SavedBacktranslation = {
            cellId,
            originalText: newText,
            backtranslation: cleanedResponse,
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

    private removeMarkdownFormatting(text: string): string {
        // Remove markdown code block formatting
        return text.replace(/^```markdown\s*|\s*```$/g, "").trim();
    }
}
