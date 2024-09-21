export class USFMParser {
    constructor(input: string, level?: LEVEL);
    toJSON(filter?: FILTER): JSON;
    validate(): boolean;
    toCSV(): string;
    toTSV(): string;
}

export class JSONParser {
    constructor(jsonInput: JSON);
    toUSFM(): string;
    validate(): boolean;
    toCSV(): string;
    toTSV(): string;
}

export enum LEVEL {
    RELAXED = "relaxed",
    STRICT = "strict",
}

export enum FILTER {
    SCRIPTURE = "scripture",
}

export interface ParsedUSFM {
    book: Book;
    chapters: Chapter[];
    _messages: Messages;
}

interface Book {
    bookCode: string;
    description: string;
    meta: Meum[];
}

interface Meum {
    h?: string;
    toc3?: string;
    toc2?: string;
    toc1?: string;
    mt2?: string;
    mt1?: string;
}

interface Chapter {
    chapterNumber: string;
    contents: UsfmVerseRefContent[];
}

interface Messages {
    _warnings: string[];
}

interface UsfmVerseRefContent {
    s?: string;
    p: string | null;
    verseNumber?: string;
    contents?: string[];
    verseText?: string;
}
