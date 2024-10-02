import Chatbot from "./chat";
import MiniSearch from "minisearch";
import { minisearchDoc } from "../activationHelpers/contextAware/miniIndex/indexes/translationPairsIndex";
import { Edit, TranslationPair } from "../../types";
import {
    searchParallelCells,
    getEditHistories,
    getTranslationPairFromProject,
} from "../activationHelpers/contextAware/miniIndex/indexes/search";

interface CellEditHistory {
    edits: Edit[];
}

interface CellsEditHistory {
    [cellId: string]: CellEditHistory;
}

const SYSTEM_MESSAGE =
    "You are a helpful assistant. Given past edit histories of similar texts, you will help edit the current text.";

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
        const editHistories = this.getEditHistories(similarEntries);
        const editHistoryString = this.formatEditHistories(editHistories);
        const message = this.createEditMessage(editHistoryString, text);
        return this.chatbot.getCompletion(message);
    }

    private findSimilarEntries(text: string): string[] {
        const results = searchParallelCells(this.translationPairsIndex, this.sourceTextIndex, text);
        return results.map((result) => result.cellId);
    }

    private getEditHistories(cellIds: string[]): CellsEditHistory {
        const editHistories: CellsEditHistory = {};
        cellIds.forEach((cellId) => {
            const edits = getEditHistories(this.translationPairsIndex, cellId);
            editHistories[cellId] = { edits };
        });
        return editHistories;
    }

    private formatEditHistories(editHistories: CellsEditHistory): string {
        return Object.entries(editHistories)
            .map(([cellId, cellHistory]) => {
                const cellValue = cellHistory.edits.map((edit) => edit.cellValue).join("\n");
                return `Cell ${cellId}:\n${cellValue}`;
            })
            .join("\n");
    }

    private createEditMessage(editHistoryString: string, text: string): string {
        return `Edit Histories of Similar Texts:\n${editHistoryString}\n\nEdit the following text based on the edit patterns you've seen in similar texts, or leave it as is if nothing needs to be changed:\n${text}`;
    }
}
