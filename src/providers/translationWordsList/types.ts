export type TwlTsvRow = {
    Reference: string;
    ID: string;
    Tags: string;
    OrigWords: string;
    Occurrence: string;
    TWLink: string;
    [key: string]: string;
};

export type ChapterVerseRef = {
    [chapter: string]: {
        [verse: string]: TwlTsvRow[];
    };
};

export type TwlBooksWithChaptersAndVerses = {
    [bookId: string]: ChapterVerseRef;
};
