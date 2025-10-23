export interface BibleBook {
    name: string;
    number: number;
    testament: 'old' | 'new';
    chapters: number;
    verses: number;
    verseCounts: number[]; // Array of verse counts per chapter in the book
}

export interface TestamentGroup {
    name: string;
    books: BibleBook[];
    totalChapters: number;
    totalVerses: number;
}

export interface BibleStructure {
    oldTestament: TestamentGroup;
    newTestament: TestamentGroup;
    allBooks: BibleBook[];
}

// All Bible Books (66 books)
const bibleBooks: BibleBook[] = [
    // Old Testament Books (39 books)
    {
        name: "Genesis",
        number: 1,
        testament: "old",
        chapters: 50,
        verses: 1533,
        verseCounts: [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 54, 33, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26]
    },
    {
        name: "Exodus",
        number: 2,
        testament: "old",
        chapters: 40,
        verses: 1213,
        verseCounts: [22, 25, 22, 31, 23, 30, 29, 28, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 37, 30, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38]
    },
    {
        name: "Leviticus",
        number: 3,
        testament: "old",
        chapters: 27,
        verses: 859,
        verseCounts: [17, 16, 17, 35, 26, 23, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34]
    },
    {
        name: "Numbers",
        number: 4,
        testament: "old",
        chapters: 36,
        verses: 1288,
        verseCounts: [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 35, 28, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 39, 17, 54, 42, 56, 29, 34, 13]
    },
    {
        name: "Deuteronomy",
        number: 5,
        testament: "old",
        chapters: 34,
        verses: 959,
        verseCounts: [46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 31, 19, 29, 23, 22, 20, 22, 21, 20, 23, 29, 26, 22, 19, 19, 26, 69, 28, 20, 30, 52, 29, 12]
    },
    {
        name: "Joshua",
        number: 6,
        testament: "old",
        chapters: 24,
        verses: 658,
        verseCounts: [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33]
    },
    {
        name: "Judges",
        number: 7,
        testament: "old",
        chapters: 21,
        verses: 618,
        verseCounts: [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25]
    },
    {
        name: "Ruth",
        number: 8,
        testament: "old",
        chapters: 4,
        verses: 85,
        verseCounts: [22, 23, 18, 22]
    },
    {
        name: "1 Samuel",
        number: 9,
        testament: "old",
        chapters: 31,
        verses: 810,
        verseCounts: [28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 16, 23, 28, 23, 43, 25, 12, 25, 11, 31, 13]
    },
    {
        name: "2 Samuel",
        number: 10,
        testament: "old",
        chapters: 24,
        verses: 695,
        verseCounts: [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 32, 44, 26, 22, 51, 39, 25]
    },
    {
        name: "1 Kings",
        number: 11,
        testament: "old",
        chapters: 22,
        verses: 816,
        verseCounts: [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53]
    },
    {
        name: "2 Kings",
        number: 12,
        testament: "old",
        chapters: 25,
        verses: 719,
        verseCounts: [18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 20, 22, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30]
    },
    {
        name: "1 Chronicles",
        number: 13,
        testament: "old",
        chapters: 29,
        verses: 942,
        verseCounts: [54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30]
    },
    {
        name: "2 Chronicles",
        number: 14,
        testament: "old",
        chapters: 36,
        verses: 822,
        verseCounts: [17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23]
    },
    {
        name: "Ezra",
        number: 15,
        testament: "old",
        chapters: 10,
        verses: 280,
        verseCounts: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44]
    },
    {
        name: "Nehemiah",
        number: 16,
        testament: "old",
        chapters: 13,
        verses: 406,
        verseCounts: [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31]
    },
    {
        name: "Esther",
        number: 17,
        testament: "old",
        chapters: 10,
        verses: 167,
        verseCounts: [22, 23, 15, 17, 14, 14, 10, 17, 32, 3]
    },
    {
        name: "Job",
        number: 18,
        testament: "old",
        chapters: 42,
        verses: 1070,
        verseCounts: [22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17, 6, 6]
    },
    {
        name: "Psalms",
        number: 19,
        testament: "old",
        chapters: 150,
        verses: 2461,
        verseCounts: [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6]
    },
    {
        name: "Proverbs",
        number: 20,
        testament: "old",
        chapters: 31,
        verses: 915,
        verseCounts: [33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31]
    },
    {
        name: "Ecclesiastes",
        number: 21,
        testament: "old",
        chapters: 12,
        verses: 222,
        verseCounts: [18, 26, 22, 17, 19, 12, 29, 17, 18, 20, 10, 14]
    },
    {
        name: "Song of Solomon",
        number: 22,
        testament: "old",
        chapters: 8,
        verses: 117,
        verseCounts: [17, 17, 11, 16, 16, 12, 14, 14]
    },
    {
        name: "Isaiah",
        number: 23,
        testament: "old",
        chapters: 66,
        verses: 1292,
        verseCounts: [31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24]
    },
    {
        name: "Jeremiah",
        number: 24,
        testament: "old",
        chapters: 52,
        verses: 1364,
        verseCounts: [19, 37, 25, 31, 31, 30, 34, 23, 25, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34]
    },
    {
        name: "Lamentations",
        number: 25,
        testament: "old",
        chapters: 5,
        verses: 154,
        verseCounts: [22, 22, 66, 22, 22]
    },
    {
        name: "Ezekiel",
        number: 26,
        testament: "old",
        chapters: 48,
        verses: 1273,
        verseCounts: [28, 10, 27, 17, 14, 27, 18, 11, 22, 25, 28, 23, 29, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 37, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 37, 31, 49, 27, 17]
    },
    {
        name: "Daniel",
        number: 27,
        testament: "old",
        chapters: 12,
        verses: 357,
        verseCounts: [21, 49, 30, 31, 28, 28, 27, 27, 21, 45, 13, 13]
    },
    {
        name: "Hosea",
        number: 28,
        testament: "old",
        chapters: 14,
        verses: 197,
        verseCounts: [9, 25, 5, 19, 15, 11, 16, 14, 17, 15, 11, 15, 15, 15]
    },
    {
        name: "Joel",
        number: 29,
        testament: "old",
        chapters: 3,
        verses: 73,
        verseCounts: [20, 32, 21]
    },
    {
        name: "Amos",
        number: 30,
        testament: "old",
        chapters: 9,
        verses: 146,
        verseCounts: [15, 16, 13, 27, 14, 17, 14, 15, 15]
    },
    {
        name: "Obadiah",
        number: 31,
        testament: "old",
        chapters: 1,
        verses: 21,
        verseCounts: [21]
    },
    {
        name: "Jonah",
        number: 32,
        testament: "old",
        chapters: 4,
        verses: 48,
        verseCounts: [16, 11, 10, 11]
    },
    {
        name: "Micah",
        number: 33,
        testament: "old",
        chapters: 7,
        verses: 105,
        verseCounts: [16, 13, 12, 14, 16, 20, 14]
    },
    {
        name: "Nahum",
        number: 34,
        testament: "old",
        chapters: 3,
        verses: 47,
        verseCounts: [14, 14, 19]
    },
    {
        name: "Habakkuk",
        number: 35,
        testament: "old",
        chapters: 3,
        verses: 56,
        verseCounts: [17, 20, 19]
    },
    {
        name: "Zephaniah",
        number: 36,
        testament: "old",
        chapters: 3,
        verses: 53,
        verseCounts: [18, 15, 20]
    },
    {
        name: "Haggai",
        number: 37,
        testament: "old",
        chapters: 2,
        verses: 38,
        verseCounts: [15, 23]
    },
    {
        name: "Zechariah",
        number: 38,
        testament: "old",
        chapters: 14,
        verses: 211,
        verseCounts: [17, 17, 17, 10, 14, 15, 14, 23, 17, 12, 17, 14, 9, 21]
    },
    {
        name: "Malachi",
        number: 39,
        testament: "old",
        chapters: 4,
        verses: 55,
        verseCounts: [14, 17, 24, 6]
    },
    // New Testament Books (27 books)
    {
        name: "Matthew",
        number: 40,
        testament: "new",
        chapters: 28,
        verses: 1071,
        verseCounts: [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20]
    },
    {
        name: "Mark",
        number: 41,
        testament: "new",
        chapters: 16,
        verses: 678,
        verseCounts: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20]
    },
    {
        name: "Luke",
        number: 42,
        testament: "new",
        chapters: 24,
        verses: 1151,
        verseCounts: [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53]
    },
    {
        name: "John",
        number: 43,
        testament: "new",
        chapters: 21,
        verses: 879,
        verseCounts: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25]
    },
    {
        name: "Acts",
        number: 44,
        testament: "new",
        chapters: 28,
        verses: 1007,
        verseCounts: [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31]
    },
    {
        name: "Romans",
        number: 45,
        testament: "new",
        chapters: 16,
        verses: 433,
        verseCounts: [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27]
    },
    {
        name: "1 Corinthians",
        number: 46,
        testament: "new",
        chapters: 16,
        verses: 437,
        verseCounts: [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24]
    },
    {
        name: "2 Corinthians",
        number: 47,
        testament: "new",
        chapters: 13,
        verses: 257,
        verseCounts: [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14]
    },
    {
        name: "Galatians",
        number: 48,
        testament: "new",
        chapters: 6,
        verses: 149,
        verseCounts: [24, 21, 29, 31, 26, 18]
    },
    {
        name: "Ephesians",
        number: 49,
        testament: "new",
        chapters: 6,
        verses: 155,
        verseCounts: [23, 22, 21, 32, 33, 24]
    },
    {
        name: "Philippians",
        number: 50,
        testament: "new",
        chapters: 4,
        verses: 104,
        verseCounts: [30, 30, 21, 23]
    },
    {
        name: "Colossians",
        number: 51,
        testament: "new",
        chapters: 4,
        verses: 95,
        verseCounts: [29, 23, 25, 18]
    },
    {
        name: "1 Thessalonians",
        number: 52,
        testament: "new",
        chapters: 5,
        verses: 89,
        verseCounts: [10, 20, 13, 18, 28]
    },
    {
        name: "2 Thessalonians",
        number: 53,
        testament: "new",
        chapters: 3,
        verses: 47,
        verseCounts: [12, 17, 18]
    },
    {
        name: "1 Timothy",
        number: 54,
        testament: "new",
        chapters: 6,
        verses: 113,
        verseCounts: [20, 15, 16, 16, 25, 21]
    },
    {
        name: "2 Timothy",
        number: 55,
        testament: "new",
        chapters: 4,
        verses: 83,
        verseCounts: [18, 26, 17, 22]
    },
    {
        name: "Titus",
        number: 56,
        testament: "new",
        chapters: 3,
        verses: 46,
        verseCounts: [16, 15, 15]
    },
    {
        name: "Philemon",
        number: 57,
        testament: "new",
        chapters: 1,
        verses: 25,
        verseCounts: [25]
    },
    {
        name: "Hebrews",
        number: 58,
        testament: "new",
        chapters: 13,
        verses: 303,
        verseCounts: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25]
    },
    {
        name: "James",
        number: 59,
        testament: "new",
        chapters: 5,
        verses: 108,
        verseCounts: [27, 26, 18, 17, 20]
    },
    {
        name: "1 Peter",
        number: 60,
        testament: "new",
        chapters: 5,
        verses: 105,
        verseCounts: [25, 25, 22, 19, 14]
    },
    {
        name: "2 Peter",
        number: 61,
        testament: "new",
        chapters: 3,
        verses: 61,
        verseCounts: [21, 22, 18]
    },
    {
        name: "1 John",
        number: 62,
        testament: "new",
        chapters: 5,
        verses: 105,
        verseCounts: [10, 29, 24, 21, 21]
    },
    {
        name: "2 John",
        number: 63,
        testament: "new",
        chapters: 1,
        verses: 13,
        verseCounts: [13]
    },
    {
        name: "3 John",
        number: 64,
        testament: "new",
        chapters: 1,
        verses: 15,
        verseCounts: [15]
    },
    {
        name: "Jude",
        number: 65,
        testament: "new",
        chapters: 1,
        verses: 25,
        verseCounts: [25]
    },
    {
        name: "Revelation",
        number: 66,
        testament: "new",
        chapters: 22,
        verses: 404,
        verseCounts: [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21]
    }
];

// Derive testament groups from the single array
const oldTestamentBooks = bibleBooks.filter(book => book.testament === 'old');
const newTestamentBooks = bibleBooks.filter(book => book.testament === 'new');

// Calculate totals for each testament
const oldTestamentTotal: TestamentGroup = {
    name: "Old Testament",
    books: oldTestamentBooks,
    totalChapters: oldTestamentBooks.reduce((sum, book) => sum + book.chapters, 0),
    totalVerses: oldTestamentBooks.reduce((sum, book) => sum + book.verses, 0)
};

const newTestamentTotal: TestamentGroup = {
    name: "New Testament",
    books: newTestamentBooks,
    totalChapters: newTestamentBooks.reduce((sum, book) => sum + book.chapters, 0),
    totalVerses: newTestamentBooks.reduce((sum, book) => sum + book.verses, 0)
};

// Complete Bible structure
export const bibleStructure: BibleStructure = {
    oldTestament: oldTestamentTotal,
    newTestament: newTestamentTotal,
    allBooks: bibleBooks
};

// Utility functions for Bible structure operations
export class BibleStructureHelper {
    //Get a book by name (case-insensitive)
    static getBookByName(name: string): BibleBook | undefined {
        return bibleStructure.allBooks.find(book =>
            book.name.toLowerCase() === name.toLowerCase()
        );
    }

    //Get a book by number
    static getBookByNumber(number: number): BibleBook | undefined {
        return bibleStructure.allBooks.find(book => book.number === number);
    }

    //Get all books in a testament
    static getBooksByTestament(testament: 'old' | 'new'): BibleBook[] {
        return bibleStructure.allBooks.filter(book => book.testament === testament);
    }

    //Get verse count for a specific book and chapter
    static getVerseCount(bookName: string, chapter: number): number | undefined {
        const book = this.getBookByName(bookName);
        if (!book || chapter < 1 || chapter > book.chapters) {
            return undefined;
        }
        return book.verseCounts[chapter - 1];
    }

    //Get total verses up to a specific book and chapter
    static getCumulativeVerseCount(bookName: string, chapter: number): number {
        const book = this.getBookByName(bookName);
        if (!book || chapter < 1 || chapter > book.chapters) {
            return 0;
        }

        // Sum all verses in previous books
        let totalVerses = 0;
        for (const b of bibleStructure.allBooks) {
            if (b.number < book.number) {
                totalVerses += b.verses;
            } else if (b.number === book.number) {
                // Add verses from previous chapters in current book
                for (let i = 0; i < chapter - 1; i++) {
                    totalVerses += b.verseCounts[i];
                }
                break;
            }
        }
        return totalVerses;
    }

    //Find which book and chapter a verse number belongs to
    static findBookAndChapterByVerseNumber(verseNumber: number): { book: BibleBook; chapter: number; } | null {
        let currentVerse = 1;

        for (const book of bibleStructure.allBooks) {
            for (let chapter = 1; chapter <= book.chapters; chapter++) {
                const versesInChapter = book.verseCounts[chapter - 1];
                if (verseNumber >= currentVerse && verseNumber < currentVerse + versesInChapter) {
                    return { book, chapter };
                }
                currentVerse += versesInChapter;
            }
        }

        return null;
    }

    //Get verse reference string (e.g., "Genesis 1:31")
    static getVerseReference(bookName: string, chapter: number, verse: number): string {
        const book = this.getBookByName(bookName);
        if (!book || chapter < 1 || chapter > book.chapters || verse < 1) {
            return "Invalid reference";
        }

        const versesInChapter = book.verseCounts[chapter - 1];
        if (verse > versesInChapter) {
            return "Invalid reference";
        }

        return `${bookName} ${chapter}:${verse}`;
    }

    //Validate if a verse reference is valid
    static isValidVerseReference(bookName: string, chapter: number, verse: number): boolean {
        const book = this.getBookByName(bookName);
        if (!book || chapter < 1 || chapter > book.chapters || verse < 1) {
            return false;
        }

        const versesInChapter = book.verseCounts[chapter - 1];
        return verse <= versesInChapter;
    }

    //Get all books that match a search pattern
    static searchBooks(pattern: string): BibleBook[] {
        const regex = new RegExp(pattern, 'i');
        return bibleStructure.allBooks.filter(book =>
            regex.test(book.name)
        );
    }

    //Get statistics for the entire Bible
    static getBibleStatistics() {
        return {
            totalBooks: bibleStructure.allBooks.length,
            oldTestamentBooks: oldTestamentTotal.books.length,
            newTestamentBooks: newTestamentTotal.books.length,
            totalChapters: oldTestamentTotal.totalChapters + newTestamentTotal.totalChapters,
            totalVerses: oldTestamentTotal.totalVerses + newTestamentTotal.totalVerses,
            oldTestamentChapters: oldTestamentTotal.totalChapters,
            oldTestamentVerses: oldTestamentTotal.totalVerses,
            newTestamentChapters: newTestamentTotal.totalChapters,
            newTestamentVerses: newTestamentTotal.totalVerses
        };
    }
}