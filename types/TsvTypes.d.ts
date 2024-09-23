/**
 * A number between 1-150 representing a chapter number.
 */
export type ChapterNum = number;

/**
 * A string of a number between 1-150 representing a chapter number.
 */
export type ChapterNumString = string;

/**
 * A number between 1-176 representing a verse number.
 */
export type VerseNum = number;

/**
 * A string of a number between 1-150 representing a verse number.
 */
export type VerseNumString = string;

/**
 * A number that is >= 0.
 */
export type ItemIndex = number;

/**
 * A string in the format 'chapter:verse'.
 * 'chapter' can be a number or the word 'front'
 * 'verse'' can be a number, the word 'intro', the word 'front', or a verse range (verseStart-verseEnd)
 * Can be a reference range (i.e 1:2-3)
 * Can be multiple references (i.e 2:3;4:23)
 */
export type ReferenceString = string;

/**
 * A string in the format of a Bible book ID, which is a three character string
 *
 * @example 'gen', 'jhn', 'php'
 */
export type BookId = string;

/**
 * An object representing a reference to a chapter and verse.
 */
export interface TSVReference {
    chapter: ChapterNum;
    verse: VerseNum;
}

/**
 * A number that must be greater than zero.
 */
export type IDLength = number;

/**
 * An alphanumeric random string of four characters that always starts with a letter.
 */
export type IDString = string;

/**
 * A string denoting a TSVRow id and reference range that reflects a TSVRow's reference.
 *
 * @example js3o_1:2-5
 * @example fg89_1:2;2:3
 *
 */
export type ReferenceRangeTag = string;

/**
 * String containing TSV file content.
 */
export type TSVFileContent = string;

/**
 * A function that sets the content of a TSV file.
 */
export type SetContentFunction = (tsvFileContent: TSVFileContent) => void;

/**
 * An object representing a row in a TSV file.
 */
export interface TSVRow {
    Reference: ReferenceString;
    ID: IDString;
    [key: string]: any; // additional TSV column header/data
}

/**
 * Object representing a TSV Row item to update
 */
export interface UpdatedRowValue {
    [columnName: string]: string;
}

/**
 * An object representing a scripture TSV.
 * Mapping of chapter numbers to verse data.
 */
export interface ScriptureTSV {
    [chapter: ChapterNumString]: { [verse: VerseNumString]: Array<TSVRow> };
}

export interface TnTSV {
    [chapter: ChapterNumString]: { [verse: VerseNumString]: Array<TranslationNoteType> };
}

export type ReferenceRangeOperation = (
    verseArray: TSVRow[],
    refRangeTag: ReferenceRangeTag,
    ...restParams: any[]
) => TSVRow[];

/**
 * An object representing the frequency index of unique values and value lengths for each column in a list of TSVRow items.
 */
export interface RowsLengthIndex {
    rowsIndex: { [column: string]: { [value: string]: number } };
    lengthIndex: { [column: string]: { [valueLength: number]: number } };
}

/**
 * A string representing the original words (Hebrew/Greek) that the note represents
 */
export type OrigQuote = string;

/**
 * A string representing a number
 */
export type NumericString = string;

/**
 * A string containing markdown content
 */
export type MarkdownString = string;

export type TranslationNoteType = {
    Reference: ReferenceString;
    ID: IDString;
    Tags: string;
    SupportReference: string;
    Quote: OrigQuote;
    Occurrence: NumericString;
    Note: MarkdownString;
};

/**
 * A number that must be >= 0
 */
export type NoteIndex = number;
