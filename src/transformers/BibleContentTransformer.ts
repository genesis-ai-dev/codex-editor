import * as vscode from "vscode";

export class BibleContentTransformer {
    async transformContent(fileUri: vscode.Uri): Promise<{
        verses: Array<{
            book: string;
            chapter: number;
            verse: number;
            text: string;
        }>;
        statistics: {
            totalVerses: number;
            processedBooks: string[];
        };
    }> {
        try {
            // Read the file content
            const content = await vscode.workspace.fs.readFile(fileUri);
            const textContent = new TextDecoder().decode(content);

            if (!textContent) {
                throw new Error("No content to transform");
            }

            // Split into lines and filter out empty lines
            const lines = textContent.split("\n").filter((line) => line.trim());

            const verses: Array<{
                book: string;
                chapter: number;
                verse: number;
                text: string;
            }> = [];

            const processedBooks = new Set<string>();

            // Process each line
            for (const line of lines) {
                // Expected format: "GEN 1:1 In the beginning..."
                const match = line.match(/^(\w+)\s+(\d+):(\d+)\s+(.+)$/);
                if (match) {
                    const [_, book, chapter, verse, text] = match;
                    verses.push({
                        book,
                        chapter: parseInt(chapter),
                        verse: parseInt(verse),
                        text: text.trim(),
                    });
                    processedBooks.add(book);
                }
            }

            return {
                verses,
                statistics: {
                    totalVerses: verses.length,
                    processedBooks: Array.from(processedBooks),
                },
            };
        } catch (error) {
            console.error("Transform error:", error);
            throw new Error(
                `Failed to transform content: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            );
        }
    }
}
