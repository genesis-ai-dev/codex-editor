import { CodexCellTypes } from "../../types/enums";
import { isContentCellType, getVerseMarkerForCell } from "./exportHandlerUtils";

/** Verse ref regex: "1TH 1:1", "GEN 1:1", etc. */
const VERSE_REF_REGEX = /\b[A-Z0-9]{2,4}\s+\d+:\d+\b/;

/** Section-heading markers: \s, \s1, \s2, ... (excludes \sp etc.) */
const HEADING_MARKER_REGEX = /^\\s\d*$/;

/** Minimal cell shape the USFM body builder needs. */
export interface UsfmExportCell {
    metadata?: any;
    value: string;
}

export interface UsfmBodyOptions {
    /** Export unformatted paratext cells as \s1 section headings instead of \p paragraphs. */
    paratextAsHeadings?: boolean;
}

export interface UsfmBodyResult {
    body: string;
    verseCount: number;
    hasVerses: boolean;
}

/**
 * Gets the verse reference for a cell, from globalReferences (preferred) or metadata.id (legacy).
 * Returns null if no verse-ref format found.
 */
export function getVerseRefForCell(cell: { metadata?: any; }): string | null {
    const meta = cell.metadata as any;
    const globalRefs = meta?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const ref = globalRefs[0];
        if (typeof ref === "string" && VERSE_REF_REGEX.test(ref)) {
            return ref;
        }
    }
    const id = meta?.id;
    if (typeof id === "string" && VERSE_REF_REGEX.test(id)) {
        return id;
    }
    return null;
}

function getChapterFromVerseRef(verseRef: string): number | null {
    const match = verseRef.match(/\s(\d+):/);
    return match ? parseInt(match[1], 10) : null;
}

export function convertHtmlToUsfm(html: string): string {
    if (!html) return "";

    let content = html;

    content = content.replace(/<h1>(.*?)<\/h1>/gi, "\\s1 $1");
    content = content.replace(/<h2>(.*?)<\/h2>/gi, "\\s1 $1");
    content = content.replace(/<h3>(.*?)<\/h3>/gi, "\\s2 $1");
    content = content.replace(/<h4>(.*?)<\/h4>/gi, "\\s3 $1");
    content = content.replace(/<em>(.*?)<\/em>/gi, "\\em $1\\em*");
    content = content.replace(/<i>(.*?)<\/i>/gi, "\\it $1\\it*");
    content = content.replace(/<strong>(.*?)<\/strong>/gi, "\\bd $1\\bd*");
    content = content.replace(/<b>(.*?)<\/b>/gi, "\\bd $1\\bd*");
    content = content.replace(/<u>(.*?)<\/u>/gi, "\\ul $1\\ul*");
    content = content.replace(/<sup>(.*?)<\/sup>/gi, "\\sup $1\\sup*");
    content = content.replace(/<sub>(.*?)<\/sub>/gi, "\\sub $1\\sub*");

    content = content.replace(/<ul>(.*?)<\/ul>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;
        return items
            .map((item: string) => "\\li " + item.replace(/<\/?li>/gi, "").trim())
            .join("\n");
    });

    content = content.replace(/<ol>(.*?)<\/ol>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;
        return items
            .map(
                (item: string, index: number) =>
                    `\\li${index + 1} ` + item.replace(/<\/?li>/gi, "").trim()
            )
            .join("\n");
    });

    // Strip bracket-format footnotes (literal angle brackets) before HTML tag cleanup
    content = content.replace(/<([^>]*\\[^>]*)>/g, "$1");

    content = content.replace(/<[^>]*>/g, "");
    content = content.replace(/&nbsp;/g, " ");
    content = content.replace(/&lt;/g, "<");
    content = content.replace(/&gt;/g, ">");
    content = content.replace(/&amp;/g, "&");
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&apos;/g, "'");

    // Strip entity-encoded bracket-format footnotes too
    content = content.replace(/<([^>]*\\[^>]*)>/g, "$1");

    return content;
}

/**
 * Formats one paratext cell as a USFM line. Marker precedence:
 * 1. Explicit heading tags in the content (already converted to \s markers by convertHtmlToUsfm)
 * 2. The original USFM marker preserved in metadata by importers (e.g. \s, \q1)
 * 3. \s1 when the user opted in to exporting paratext cells as headings, otherwise \p
 */
function formatParatextCell(
    convertedContent: string,
    metadata: any,
    paratextAsHeadings: boolean
): { line: string; isHeading: boolean; } {
    if (convertedContent.startsWith("\\")) {
        return {
            line: convertedContent,
            isHeading: convertedContent.startsWith("\\s"),
        };
    }
    const marker =
        typeof metadata?.marker === "string" && metadata.marker.startsWith("\\")
            ? metadata.marker
            : null;
    if (marker) {
        return {
            line: `${marker} ${convertedContent}`,
            isHeading: HEADING_MARKER_REGEX.test(marker),
        };
    }
    if (paratextAsHeadings) {
        return { line: `\\s1 ${convertedContent}`, isHeading: true };
    }
    return { line: `\\p ${convertedContent}`, isHeading: false };
}

/**
 * Assembles the chapter/verse body of a USFM file from a book's cells
 * (pre-filtered to active, non-milestone cells with content).
 *
 * Chapter boundaries come from verse refs, or from legacy paratext cells whose
 * text is "Chapter N". Paratext cells that sit between chapters (e.g. a section
 * heading entered before a chapter's first verse) are attached to the chapter
 * they introduce, after its \c marker, rather than the still-open previous one.
 */
export function buildUsfmBody(
    relevantCells: UsfmExportCell[],
    options?: UsfmBodyOptions
): UsfmBodyResult {
    const paratextAsHeadings = !!options?.paratextAsHeadings;

    // For each cell, the chapter of the nearest following verse cell — used to
    // decide whether a paratext cell belongs to the upcoming chapter.
    const nextVerseChapter: (number | null)[] = new Array(relevantCells.length).fill(null);
    let upcomingChapter: number | null = null;
    for (let i = relevantCells.length - 1; i >= 0; i--) {
        nextVerseChapter[i] = upcomingChapter;
        const cell = relevantCells[i];
        if (isContentCellType(cell.metadata?.type)) {
            const verseRef = getVerseRefForCell(cell);
            const chapter = verseRef ? getChapterFromVerseRef(verseRef) : null;
            if (chapter !== null) {
                upcomingChapter = chapter;
            }
        }
    }

    let body = "";
    let verseCount = 0;
    let hasVerses = false;
    let currentChapter = 0;
    let chapterContent = "";
    let isFirstChapter = true;
    let pendingParatextLines: string[] = [];

    const openChapter = (chapterNum: number) => {
        if (chapterContent) {
            body += chapterContent;
        }
        currentChapter = chapterNum;
        isFirstChapter = false;
        chapterContent = `\\c ${chapterNum}\n`;
        for (const line of pendingParatextLines) {
            chapterContent += `${line}\n`;
        }
        pendingParatextLines = [];
        chapterContent += "\\p\n";
    };

    for (let i = 0; i < relevantCells.length; i++) {
        const cell = relevantCells[i];
        const cellMetadata = cell.metadata;
        const cellContent = convertHtmlToUsfm(cell.value.trim());

        if (cellMetadata?.type === CodexCellTypes.PARATEXT) {
            // Legacy chapter-marker paratext cells: literal "Chapter N" text.
            const plainText = cell.value.replace(/<[^>]*>/g, "").trim();
            const chapterMatch = plainText.startsWith("Chapter ")
                ? plainText.match(/Chapter (\d+)/i)
                : null;
            if (chapterMatch) {
                openChapter(parseInt(chapterMatch[1], 10));
                continue;
            }

            const { line, isHeading } = formatParatextCell(
                cellContent,
                cellMetadata,
                paratextAsHeadings
            );
            const upcoming = nextVerseChapter[i];
            if (upcoming !== null && upcoming !== currentChapter) {
                // Belongs to the next chapter; hold until its \c is emitted.
                pendingParatextLines.push(line);
            } else {
                chapterContent += `${line}\n`;
                if (isHeading) {
                    // Restart the paragraph so following verses don't attach to the heading.
                    chapterContent += "\\p\n";
                }
            }
        } else if (isContentCellType(cellMetadata?.type)) {
            const verseRef = getVerseRefForCell(cell);
            if (!verseRef) continue;

            const chapterNum = getChapterFromVerseRef(verseRef);
            const verseMarker = getVerseMarkerForCell(cell, verseRef);
            if (chapterNum === null || !verseMarker) continue;

            if (chapterNum !== currentChapter) {
                openChapter(chapterNum);
            } else if (isFirstChapter && currentChapter === 0) {
                // Verse ref with chapter 0 and no chapter opened yet (legacy edge case).
                openChapter(1);
            }

            chapterContent += `\\v ${verseMarker} ${cellContent}\n`;
            verseCount++;
            hasVerses = true;
        }
    }

    if (chapterContent) {
        body += chapterContent;
    }

    return { body, verseCount, hasVerses };
}
