import Chatbot from "./chat";
import MiniSearch from "minisearch";
import { minisearchDoc } from "../activationHelpers/contextAware/miniIndex/indexes/translationPairsIndex";
import { TranslationPair } from "../../types";
import {
    searchParallelCells,
    getTranslationPairFromProject,
} from "../activationHelpers/contextAware/miniIndex/indexes/search";

const SYSTEM_MESSAGE =
    "You are a helpful assistant. Given similar texts, you will help edit the current text.";

export class SmartEdits {
    private chatbot: Chatbot;
    private translationPairsIndex: MiniSearch<minisearchDoc>;
    private sourceTextIndex: MiniSearch;

    constructor(translationPairsIndex: MiniSearch<minisearchDoc>, sourceTextIndex: MiniSearch) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.translationPairsIndex = translationPairsIndex;
        this.sourceTextIndex = sourceTextIndex;
    }

    async edit(text: string): Promise<string> {
        const similarEntries = this.findSimilarEntries(text);
        const similarTexts = this.getSimilarTexts(similarEntries);
        const similarTextsString = this.formatSimilarTexts(similarTexts);
        const message = this.createEditMessage(similarTextsString, text);
        return this.chatbot.getCompletion(message);
    }

    private findSimilarEntries(text: string): string[] {
        const results = searchParallelCells(this.translationPairsIndex, this.sourceTextIndex, text);
        return results.map((result) => result.cellId);
    }

    private getSimilarTexts(cellIds: string[]): { [cellId: string]: string } {
        const similarTexts: { [cellId: string]: string } = {};
        cellIds.forEach((cellId) => {
            const pair = getTranslationPairFromProject(this.translationPairsIndex, cellId);
            if (pair && pair.targetCell.content) {
                similarTexts[cellId] = pair.targetCell.content;
            }
        });
        return similarTexts;
    }

    private formatSimilarTexts(similarTexts: { [cellId: string]: string }): string {
        return Object.entries(similarTexts)
            .map(([cellId, text]) => {
                return `Cell ${cellId}:\n${text}`;
            })
            .join("\n");
    }

    private createEditMessage(similarTextsString: string, text: string): string {
        return `Similar Texts:\n${similarTextsString}\n\nEdit the following text based on the patterns you've seen in similar texts, or leave it as is if nothing needs to be changed:\n${text}`;
    }
}
