import Chatbot from './chat';

type EditType = 'llm-generation' | 'user-edit';

interface Edit {
    cellValue: string;
    timestamp: number;
    type: EditType;
}

interface CellEditHistory {
    edits: Edit[];
}

interface CellsEditHistory {
    [cellId: string]: CellEditHistory;
}

const SYSTEM_MESSAGE = "You are a helpful assistant. Given past edit histories, you will help edit a similar text.";

export class SmartEdits {
    private chatbot: Chatbot;

    constructor() {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
    }

    async edit(text: string, editHistory: CellsEditHistory): Promise<string> {
        const editHistoryString = this.formatEditHistory(editHistory);
        const message = this.createEditMessage(editHistoryString, text);
        return this.chatbot.getCompletion(message);
    }

    private formatEditHistory(editHistory: CellsEditHistory): string {
        return Object.entries(editHistory)
            .map(([cellId, cellHistory]) => {
                const cellValue = cellHistory.edits.map(edit => edit.cellValue).join('\n');
                return `Cell ${cellId}:\n${cellValue}`;
            })
            .join('\n');
    }

    private createEditMessage(editHistoryString: string, text: string): string {
        return `Edit History:\n${editHistoryString}\nEdit the following text based on the edits you've seen, or leave it as is if nothing needs to be changed: ${text}`;
    }
}
