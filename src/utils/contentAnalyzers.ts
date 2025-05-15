import * as vscode from "vscode";
import { BookPreview, FileType } from "../../types";
import { getFileType } from "./fileTypeUtils";

export async function analyzeUsfmContent(content: string): Promise<BookPreview[]> {
    const books: BookPreview[] = [];
    const lines = content.split("\n");

    let currentBook: Partial<BookPreview> = {};
    let verseCount = 0;
    let chapterCount = 0;

    for (const line of lines) {
        if (line.startsWith("\\id ")) {
            if (currentBook.name) {
                books.push({
                    name: currentBook.name,
                    versesCount: verseCount,
                    chaptersCount: chapterCount,
                    previewContent: lines.slice(0, 5).join("\n"),
                });
            }
            currentBook = { name: line.substring(4).trim() };
            verseCount = 0;
            chapterCount = 0;
        } else if (line.startsWith("\\c ")) {
            chapterCount++;
        } else if (line.startsWith("\\v ")) {
            verseCount++;
        }
    }

    // Add the last book
    if (currentBook.name) {
        books.push({
            name: currentBook.name,
            versesCount: verseCount,
            chaptersCount: chapterCount,
            previewContent: lines.slice(0, 5).join("\n"),
        });
    }

    return books;
}

export async function analyzeUsxContent(content: string): Promise<BookPreview[]> {
    const books: BookPreview[] = [];
    const lines = content.split("\n");

    // Simple regex patterns for USX elements
    const bookPattern = /<book\s+code="([^"]+)"/i;
    const chapterPattern = /<chapter\s+number="([^"]+)"/i;
    const versePattern = /<verse\s+number="([^"]+)"/i;

    let currentBook: Partial<BookPreview> = {};
    let verseCount = 0;
    let chapterCount = 0;

    for (const line of lines) {
        const bookMatch = line.match(bookPattern);
        if (bookMatch) {
            if (currentBook.name) {
                books.push({
                    name: currentBook.name,
                    versesCount: verseCount,
                    chaptersCount: chapterCount,
                    previewContent: lines.slice(0, 5).join("\n"),
                });
            }
            currentBook = { name: bookMatch[1] };
            verseCount = 0;
            chapterCount = 0;
            continue;
        }

        if (line.match(chapterPattern)) {
            chapterCount++;
        }

        if (line.match(versePattern)) {
            verseCount++;
        }
    }

    // Add the last book
    if (currentBook.name) {
        books.push({
            name: currentBook.name,
            versesCount: verseCount,
            chaptersCount: chapterCount,
            previewContent: lines.slice(0, 5).join("\n"),
        });
    }

    return books;
}

export async function analyzeSubtitlesContent(content: string): Promise<BookPreview[]> {
    // Basic analysis for subtitles/VTT files
    const lines = content.split("\n");
    const segments = content.split("\n\n").filter(Boolean);

    return [
        {
            name: "Subtitles",
            versesCount: segments.length,
            chaptersCount: 1,
            previewContent: lines.slice(0, 5).join("\n"),
        },
    ];
}

export async function analyzePlainTextContent(content: string): Promise<BookPreview[]> {
    const lines = content.split("\n");

    return [
        {
            name: "Plain Text",
            versesCount: lines.length,
            chaptersCount: 1,
            previewContent: content.slice(0, 200),
        },
    ];
}

export async function analyzeSourceContent(
    fileUri: vscode.Uri,
    content: string
): Promise<BookPreview[]> {
    const fileType = getFileType(fileUri);

    switch (fileType) {
        case "usfm":
            return await analyzeUsfmContent(content);
        case "subtitles":
            return await analyzeSubtitlesContent(content);
        case "plaintext":
            return await analyzePlainTextContent(content);
        default:
            return [];
    }
}
