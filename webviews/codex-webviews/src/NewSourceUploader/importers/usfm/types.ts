// Type declarations for usfm-grammar library
declare module 'usfm-grammar' {
    export interface ParsedUSFM {
        book: {
            bookCode: string;
        };
        chapters: Array<{
            chapterNumber: number;
            contents: Array<{
                verseNumber?: number;
                verseText?: string;
                text?: string;
                marker?: string;
            }>;
        }>;
    }

    export class USFMParser {
        constructor(input: string, level: any);
        toJSON(): ParsedUSFM;
    }

    export const LEVEL: {
        RELAXED: any;
        STRICT: any;
    };
} 