import * as vscode from "vscode";

export interface TransformedVerse {
    book: string;
    chapter: number;
    verse: number;
    text: string;
}

export interface TransformationResult {
    verses: TransformedVerse[];
    statistics: {
        totalVerses: number;
        processedBooks: string[];
    };
}

export class BibleContentTransformer {
    async transformContent(fileUri: vscode.Uri): Promise<TransformationResult> {
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = Buffer.from(content).toString('utf-8');
        const lines = textContent.split('\n').filter(line => line.trim());

        const verses: TransformedVerse[] = [];
        const processedBooks = new Set<string>();

        for (const line of lines) {
            const match = line.match(/^([\w\s]+)\s+(\d+):(\d+)\s+(.+)$/);
            if (match) {
                const [_, book, chapter, verse, text] = match;
                const trimmedBook = book.trim();
                
                processedBooks.add(trimmedBook);
                verses.push({
                    book: trimmedBook,
                    chapter: parseInt(chapter, 10),
                    verse: parseInt(verse, 10),
                    text: text.trim()
                });
            }
        }

        // Sort verses by book, chapter, and verse number
        verses.sort((a, b) => {
            if (a.book !== b.book) return a.book.localeCompare(b.book);
            if (a.chapter !== b.chapter) return a.chapter - b.chapter;
            return a.verse - b.verse;
        });

        return {
            verses,
            statistics: {
                totalVerses: verses.length,
                processedBooks: Array.from(processedBooks)
            }
        };
    }

    async writeTransformedContent(
        transformedContent: TransformationResult,
        outputUri: vscode.Uri
    ): Promise<void> {
        const content = transformedContent.verses
            .map(verse => `${verse.book} ${verse.chapter}:${verse.verse} ${verse.text}`)
            .join('\n');

        await vscode.workspace.fs.writeFile(
            outputUri,
            Buffer.from(content, 'utf-8')
        );
    }
}
