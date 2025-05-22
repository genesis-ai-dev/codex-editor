import * as vscode from "vscode";

interface Note {
    note: string;
    ref_id: number;
}

interface Question {
    question: string;
    response: string;
}

interface VerseData {
    notes: Note[];
    questions: Question[];
}

interface References {
    [id: number]: {
        id: number;
        content: string;
    };
}

interface Verses {
    [book: string]: {
        [verse: string]: VerseData;
    };
}

interface ChatContext {
    verses: Verses;
    references: References;
}

class VerseDataReader {
    private data: ChatContext = { verses: {}, references: {} };
    private path: string = "no";

    constructor(private extensionContext: vscode.ExtensionContext) {
        const filePath = vscode.Uri.joinPath(
            this.extensionContext.extensionUri,
            "src/utils/chat_context.json"
        ).fsPath;
        this.loadJSON(filePath)
            .then(() => console.log("JSON loaded successfully"))
            .catch((error) => console.error("Error loading JSON:", error));
        this.path = filePath;
    }

    public async loadJSON(filePath: string): Promise<void> {
        try {
            const fileUri = vscode.Uri.file(filePath);
            try {
                const fileContents = await vscode.workspace.fs.readFile(fileUri);
                this.data = JSON.parse(new TextDecoder().decode(fileContents));
                console.log("Loaded data:", this.data); // Log the loaded data
            } catch (error: any) {
                if (
                    error.code === "FileNotFound" ||
                    (error.name === "FileSystemError" && error.message.includes("ENOENT"))
                ) {
                    console.log("chat_context.json not found. Creating it with default content.");
                    const defaultData: ChatContext = { verses: {}, references: {} };
                    await vscode.workspace.fs.writeFile(
                        fileUri,
                        Buffer.from(JSON.stringify(defaultData, null, 2))
                    );
                    this.data = defaultData;
                } else {
                    console.error(
                        "Error reading or parsing JSON file, initializing with default data:",
                        error
                    );
                    this.data = { verses: {}, references: {} }; // Initialize with default on other errors
                }
            }
        } catch (error) {
            // This catch block is for errors creating the fileUri or other unexpected errors.
            console.error("Unexpected error in loadJSON, initializing with default data:", error);
            this.data = { verses: {}, references: {} }; // Initialize with default
        }
    }

    public getVerseData(book: string, verse: string): string {
        console.log(`Requested book: ${book}, verse: ${verse}`); // Log the requested book and verse

        if (!this.data.verses[book] || !this.data.verses[book][verse]) {
            console.error(`Data not found for book: ${book}, verse: ${verse}`);
            return this.path;
        }

        const verseData = this.data.verses[book][verse];
        let result = `Notes for ${book} ${verse}:\n`;

        for (const note of verseData.notes) {
            const refContent =
                this.data.references[note.ref_id]?.content || "Reference content not found";
            result += `- Note: ${note.note}\n  Reference: ${refContent}\n`;
        }

        result += `\nQuestions for ${book} ${verse}:\n`;

        for (const question of verseData.questions) {
            result += `- Question: ${question.question}\n  Response: ${question.response}\n`;
        }

        return result;
    }
}

// Export the VerseDataReader class for use in other scripts
export { VerseDataReader };
