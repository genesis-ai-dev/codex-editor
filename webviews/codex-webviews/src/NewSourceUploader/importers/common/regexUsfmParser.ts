// Lightweight regex-based USFM utilities: tokenizer, simple chapter/verse parser,
// tag counter, and serializer for well-formed, normalized inputs we generate in tests.

export interface RegexUsfmChapterContent {
    verseNumber?: number;
    verseText?: string;
    text?: string;
    marker?: string;
}

export interface RegexUsfmChapter {
    chapterNumber: number;
    contents: RegexUsfmChapterContent[];
}

export interface RegexParsedUSFM {
    book: { bookCode: string; };
    chapters: RegexUsfmChapter[];
    headerLines?: string[];
    rawHeader?: string;
}

const BOOK_CODE_REGEX = /\\id\s+([A-Z0-9]{3})/;
const CHAPTER_LINE_REGEX = /^\\c\s+(\d+)\s*$/;
const VERSE_LINE_REGEX = /^\\v\s+(\d+[a-z]?)\s+(.*)$/i;

// Matches a backslash marker anywhere (paragraph-level or inline), including variants like q1, th2, qt-s, qt-e, and closing markers ending with *
const ANY_MARKER_REGEX = /\\([a-zA-Z]+\d*(?:-[se])?\*?)/g;

// Extract the canonical base tag (e.g., q1 -> q, th2 -> th, qt-s -> qt, qt-e -> qt, wj* -> wj)
export const getBaseTag = (marker: string): string => {
    let base = marker;
    if (base.endsWith('*')) base = base.slice(0, -1);
    // Strip milestone -s / -e suffix
    base = base.replace(/-(?:s|e)$/i, '');
    // Strip trailing digits used for levels (e.g., q1, th2, li3)
    base = base.replace(/\d+$/, '');
    return base;
};

export const countMarkersByTag = (usfm: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    let match: RegExpExecArray | null;
    const regex = new RegExp(ANY_MARKER_REGEX);
    while ((match = regex.exec(usfm)) !== null) {
        const raw = match[1];
        const base = getBaseTag(raw);
        counts[base] = (counts[base] || 0) + 1;
    }
    return counts;
};

export const parseUsfmToJson = (usfm: string): RegexParsedUSFM => {
    const bookMatch = usfm.match(BOOK_CODE_REGEX);
    let bookCode = bookMatch?.[1]?.toUpperCase();
    
    // For files without \id marker (like lectionaries), use a placeholder
    if (!bookCode) {
        // Try to infer from filename or use a generic code
        bookCode = 'XXX'; // Placeholder for files without \id
    }

    const lines = usfm.split(/\r?\n/);
    const chapters: RegexUsfmChapter[] = [];
    const headerLines: string[] = [];
    let currentChapter: RegexUsfmChapter | null = null;
    let lastVerseEntry: RegexUsfmChapterContent | null = null;
    let seenFirstChapter = false;
    const headerCollected: string[] = [];

    for (const line of lines) {
        const cMatch = line.match(CHAPTER_LINE_REGEX);
        if (cMatch) {
            const chapterNumber = parseInt(cMatch[1], 10);
            currentChapter = { chapterNumber, contents: [] };
            chapters.push(currentChapter);
            seenFirstChapter = true;
            lastVerseEntry = null;
            continue;
        }

        const vMatch = line.match(VERSE_LINE_REGEX);
        if (vMatch && currentChapter) {
            // Keep verseNumber as number where possible; some inputs may have a/b suffixes.
            const verseRaw = vMatch[1];
            const verseNumber = /^\d+$/i.test(verseRaw) ? parseInt(verseRaw, 10) : (verseRaw as unknown as number);
            const verseText = vMatch[2] ?? '';
            const entry: RegexUsfmChapterContent = { verseNumber, verseText };
            currentChapter.contents.push(entry);
            lastVerseEntry = entry;
            continue;
        }

        // Accumulate any lines before first chapter as header (including markers and blanks)
        if (!seenFirstChapter) {
            headerLines.push(line);
            headerCollected.push(line);
            continue;
        }

        // Preserve other marker lines (paragraph-level, tables, section headings, etc.)
        if (currentChapter && line.startsWith('\\')) {
            currentChapter.contents.push({ marker: line });
            lastVerseEntry = null;
            continue;
        }

        // Optionally capture plain text lines (no leading marker)
        if (currentChapter && !line.startsWith('\\') && line.trim().length > 0) {
            if (lastVerseEntry && typeof lastVerseEntry.verseText !== 'undefined') {
                lastVerseEntry.verseText = `${lastVerseEntry.verseText} ${line}`.trim();
            } else {
                currentChapter.contents.push({ text: line });
            }
        }
    }

    // Handle files without chapters (e.g., lectionary readings, introductions)
    // Create a virtual chapter 0 to hold all content
    if (chapters.length === 0) {
        const virtualChapter: RegexUsfmChapter = { chapterNumber: 0, contents: [] };
        let lastVerseEntry: RegexUsfmChapterContent | null = null;
        
        // Process all lines after header as content
        for (const line of lines) {
            // Skip header lines (already collected)
            if (headerCollected.includes(line)) {
                continue;
            }
            
            const vMatch = line.match(VERSE_LINE_REGEX);
            if (vMatch) {
                const verseRaw = vMatch[1];
                const verseNumber = /^\d+$/i.test(verseRaw) ? parseInt(verseRaw, 10) : (verseRaw as unknown as number);
                const verseText = vMatch[2] ?? '';
                const entry: RegexUsfmChapterContent = { verseNumber, verseText };
                virtualChapter.contents.push(entry);
                lastVerseEntry = entry;
            } else if (line.startsWith('\\')) {
                virtualChapter.contents.push({ marker: line });
                lastVerseEntry = null;
            } else if (line.trim().length > 0) {
                // Plain text - attach to last verse if exists, otherwise add as separate text
                if (lastVerseEntry && typeof lastVerseEntry.verseText !== 'undefined') {
                    lastVerseEntry.verseText = `${lastVerseEntry.verseText} ${line}`.trim();
                } else {
                    virtualChapter.contents.push({ text: line });
                }
            }
        }
        chapters.push(virtualChapter);
    }

    const rawHeader = headerCollected.length > 0 ? headerCollected.join('\n') : undefined;
    return { book: { bookCode }, chapters, headerLines, rawHeader };
};

export const stringifyUsfmFromJson = (doc: RegexParsedUSFM, originalHeader?: string): string => {
    const lines: string[] = [];
    if (doc.rawHeader && doc.rawHeader.length > 0) {
        lines.push(doc.rawHeader);
    } else {
        const header = (doc.headerLines && doc.headerLines.length > 0)
            ? doc.headerLines
            : (originalHeader && originalHeader.trim().length > 0)
                ? [originalHeader.trim()]
                : [`\\id ${doc.book.bookCode}`, '\\usfm 3.0'];
        for (const h of header) lines.push(h);
    }
    for (const chapter of doc.chapters) {
        lines.push(`\\c ${chapter.chapterNumber}`);
        for (const item of chapter.contents) {
            if (typeof item.verseNumber !== 'undefined' && typeof item.verseText !== 'undefined') {
                lines.push(`\\v ${item.verseNumber} ${item.verseText}`);
            } else if (item.marker) {
                lines.push(item.marker);
            } else if (item.text && !item.marker) {
                lines.push(item.text);
            }
        }
    }
    return lines.join('\n');
};


