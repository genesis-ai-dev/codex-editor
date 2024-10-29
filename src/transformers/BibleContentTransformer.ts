import * as vscode from "vscode";
import { verseRefRegex } from "../utils/verseRefUtils";

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
        const textContent = Buffer.from(content).toString("utf-8");
        const lines = textContent.split("\n").filter((line) => line.trim());

        const verses: TransformedVerse[] = [];
        const processedBooks = new Set<string>();

        for (const line of lines) {
            const match = line.match(verseRefRegex);
            if (match) {
                const [_, book, chapter, verse, text] = match;
                const trimmedBook = book.trim();

                processedBooks.add(trimmedBook);
                verses.push({
                    book: trimmedBook,
                    chapter: parseInt(chapter, 10),
                    verse: parseInt(verse, 10),
                    text: text.trim(),
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
                processedBooks: Array.from(processedBooks),
            },
        };
    }

    async writeTransformedContent(
        transformedContent: TransformationResult,
        outputUri: vscode.Uri
    ): Promise<void> {
        // Group verses by book and chapter
        const versesByBookAndChapter = transformedContent.verses.reduce(
            (acc, verse) => {
                const bookKey = verse.book;
                const chapterKey = `${verse.chapter}`;

                if (!acc[bookKey]) {
                    acc[bookKey] = {};
                }
                if (!acc[bookKey][chapterKey]) {
                    acc[bookKey][chapterKey] = [];
                }

                acc[bookKey][chapterKey].push(verse);
                return acc;
            },
            {} as Record<string, Record<string, TransformedVerse[]>>
        );

        // Build content with proper structure
        let content = "";
        for (const book of Object.keys(versesByBookAndChapter)) {
            for (const chapter of Object.keys(versesByBookAndChapter[book])) {
                // Add empty paratext cell for chapter heading
                content += `${book} ${chapter}:0 \n`;

                // Add verse cells
                const verses = versesByBookAndChapter[book][chapter];
                for (const verse of verses) {
                    content += `${verse.book} ${verse.chapter}:${verse.verse} ${verse.text}\n`;
                }
            }
        }

        await vscode.workspace.fs.writeFile(outputUri, Buffer.from(content, "utf-8"));
    }
}
