import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair } from "../../types";

const SYSTEM_MESSAGE = `You are a helpful assistant for Bible translation.
You will be given translation pairs, and a new verse to translate. Based on the pairs,
and other data you will be given, you will generate a new translation for the verse.
Then, the user may suggest improvements etc...
Think each thing through carefully, and make sure you understand the context of the text.
Respond in this xml format:
<response>
    <addMemory id="home-heimat">Example: "I thought I should use the word 'house' to translate 'heimat' but the user said 'home' is a better translation."</addMemory> // Optional, if you need to remember something the user has suggested to help with future translations.
    <thinking>Example: "I will use the word 'house' instead of 'home' in this verse because..."</thinking> // Take as long as you need to think!
    <translation>Example: "The house is the center of the family's life."</translation>
    <memoriesUsed> // Optional, the Ids of the memories you used.
        <memory id="some-memory-id">Some memory</memory> // A memory you found useful in the translation process.
        ... // the more the better!
    </memoriesUsed>
</response>
`;

export class SilverPath {
    private chatbot: Chatbot;
    private silverPathFile: string;

    constructor(workspaceUri: vscode.Uri) {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        this.silverPathFile = path.join(workspaceUri.fsPath, "files", "silver_path.json");
    }

    async generateTranslation(text: string, cellId: string): Promise<string> {
        const similarPairs = await this.findSimilarPairs(text);
        const context = this.formatSimilarPairs(similarPairs);

        const message = `
            Similar translations:
            ${context}

            Please generate a translation for:
            ${text}
        `;

        const response = await this.chatbot.getCompletion(message);
        const parsed = this.parseXML(response);
        return parsed.translation;
    }

    private async findSimilarPairs(text: string): Promise<TranslationPair[]> {
        try {
            const results = await vscode.commands.executeCommand<TranslationPair[]>(
                "translators-copilot.searchParallelCells",
                text
            );
            return results || [];
        } catch (error) {
            console.error("Error searching parallel cells:", error);
            return [];
        }
    }

    private formatSimilarPairs(pairs: TranslationPair[]): string {
        return pairs
            .map(
                (pair) => `
CellId: ${pair.cellId}
Source: ${pair.sourceCell.content}
Target: ${pair.targetCell.content}
`
            )
            .join("\n");
    }

    private parseXML(xml: string): { thinking: string; translation: string } {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, "text/xml");
        const thinking = xmlDoc.getElementsByTagName("thinking")[0].textContent || "";
        const translation = xmlDoc.getElementsByTagName("translation")[0].textContent || "";
        return { thinking, translation };
    }
}
