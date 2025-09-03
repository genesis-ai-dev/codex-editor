// Type declarations for usfm-grammar-web library
declare module 'usfm-grammar-web' {
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
        toTSV(): any; // TODO: what types are these?
        toXML(): any; // TODO: what types are these?
    }

    export const LEVEL: {
        RELAXED: any;
        STRICT: any;
    };
} 