/**
 * Builds notebook cells from parsed Biblica Study Bible IDML stories.
 *
 * Only intro/* note paragraphs become cells; verse paragraphs are scanned to derive the
 * chapter-range milestone label and globalReferences that get attached to those notes.
 *
 * Front/back matter volumes (see isBiblicaFrontBackMatterDocument) hold no scripture, so
 * they run in "all styles" mode where every text-bearing paragraph becomes a cell.
 */

import type { CustomNotebookCellData } from "types";
import type { ProcessedCell } from "../../types/common";
import { createProcessedCell } from "../../utils/workflowHelpers";
import { extractImagesFromHtml } from "../../utils/imageProcessor";
import { createNoteCellMetadata } from "./cellMetadata";
import type { IDMLStory } from "./types";
import {
    buildSegmentedParagraphHtml,
    extractContentSegmentStructureFromParagraph,
    getSegmentCharacterStylesForParagraph,
    joinContentSegments,
} from "../common/contentSegmentUtils";
import {
    isBiblicaBookTitleStyle,
    isBiblicaDivisionHeadingStyle,
    isBiblicaMajorSectionHeadingStyle,
    isBiblicaNoteSectionStyle,
    isBiblicaRunningHeadStyle,
    isStructuralOnlyContent,
    splitSegmentsAtLineBreaks,
    getStructuralApostropheSegmentIndexes,
    getVerseMarkerSegmentIndexes,
    mergeSegmentIndexes,
    omitSegmentsAtIndexes,
    toDivisionMilestoneLabel,
} from "./biblicaImportUtils";

export interface CreateCellsOptions {
    /**
     * Accept every text-bearing paragraph style, not just intro/* notes. Used for the
     * front/back matter volumes, whose text sits in layout styles.
     */
    includeAllTextStyles?: boolean;
}

/**
 * Compute the chapter-range milestone label for a note section.
 * - "Preface" if no verses have been scanned in this book yet.
 * - "3" if only chapter 3 was scanned since the last note section.
 * - "1-2" if chapters 1 through 2 were scanned since the last note section.
 */
export function computeChapterRangeLabel(
    firstChapter: string | null,
    lastChapter: string | null,
    hasEncounteredVerses: boolean
): string {
    if (!hasEncounteredVerses || !firstChapter) return "Preface";
    if (!lastChapter || firstChapter === lastChapter) return firstChapter;
    return `${firstChapter}-${lastChapter}`;
}

export async function createCellsFromStories(
    stories: IDMLStory[],
    htmlRepresentation: { stories?: { id: string; }[]; originalHash?: string; },
    sourceFileName: string,
    options: CreateCellsOptions = {}
): Promise<ProcessedCell[]> {
    const { includeAllTextStyles = false } = options;
    const cells: ProcessedCell[] = [];
    let currentBook = "";
    let currentChapter = "1";
    let currentVerseArray: string[] = [];
    let hasEncounteredVerses = false;

    // Chapter-range tracking for milestone labels.
    // firstChapterInRange: first chapter seen in verse paragraphs since last note section.
    // lastChapterInRange: latest chapter seen since last note section.
    let firstChapterInRange: string | null = null;
    let lastChapterInRange: string | null = null;
    // The computed label for the current note section (set once when we enter notes).
    let currentMilestoneLabel: string | null = null;
    // Set while inside a division section (intro:imt2) so its paragraphs land on their own
    // milestone instead of being folded into the following book's preface.
    let currentDivisionLabel: string | null = null;

    const updateChapterRange = (chapter: string) => {
        if (!firstChapterInRange) {
            firstChapterInRange = chapter;
        }
        lastChapterInRange = chapter;
    };

    for (const story of stories) {
        for (let i = 0; i < story.paragraphs.length; i++) {
            const paragraph = story.paragraphs[i];
            const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;

            const verseSegments = paragraph.metadata?.biblicaVerseSegments as
                | Array<{
                    bookAbbreviation?: string;
                    chapterNumber?: string;
                    verseNumber?: string;
                }>
                | undefined;
            const isPartOfSpanningVerse = paragraph.metadata?.isPartOfSpanningVerse as
                | boolean
                | undefined;
            const spanningVerseInfo = paragraph.metadata?.spanningVerseInfo as
                | {
                    bookAbbreviation?: string;
                    chapterNumber?: string;
                    verseNumber?: string;
                    verseKey?: string;
                }
                | undefined;

            // --- Update currentChapter from verse data ---
            if (verseSegments && Array.isArray(verseSegments) && verseSegments.length > 0) {
                const verseChapter = verseSegments[0].chapterNumber;
                if (verseChapter) currentChapter = verseChapter;
            } else if (isPartOfSpanningVerse && spanningVerseInfo?.chapterNumber) {
                currentChapter = spanningVerseInfo.chapterNumber;
            }

            // --- Detect new book ---
            if (paragraph.metadata?.bookAbbreviation) {
                const newBook = paragraph.metadata.bookAbbreviation as string;
                if (newBook !== currentBook) {
                    currentBook = newBook;
                    currentVerseArray = [];
                    currentChapter = "1";
                    hasEncounteredVerses = false;
                    firstChapterInRange = null;
                    lastChapterInRange = null;
                    currentMilestoneLabel = null;
                    currentDivisionLabel = null;
                }
            }

            // --- Update currentChapter from paragraph metadata ---
            if (paragraph.metadata?.lastChapterNumber) {
                currentChapter = paragraph.metadata.lastChapterNumber as string;
            }

            // --- Fallback book detection from paragraph content ---
            // Front/back matter is not scoped to a book, and its layout text (TOC lines,
            // dictionary entries) can look like a book code by accident.
            if (!currentBook && !includeAllTextStyles) {
                const validBookCodes = [
                    "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT",
                    "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH",
                    "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER",
                    "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON",
                    "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT",
                    "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL",
                    "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT",
                    "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN",
                    "JUD", "REV",
                ];
                const paragraphContent =
                    paragraph.characterStyleRanges
                        ?.map((r) => r.content || "")
                        .join("")
                        .trim() || "";
                const bookCodeMatch = paragraphContent.match(/^([A-Z0-9]{3})\s*[-–—\n]/);
                if (bookCodeMatch && validBookCodes.includes(bookCodeMatch[1])) {
                    currentBook = bookCodeMatch[1];
                }
            }

            // --- Update currentChapter from chapter number markers (cv:dc or meta:c) ---
            // JOB uses cv:dc ("1", "2", …), Psalms uses meta:c ("1:", "2:", …)
            const characterRanges = paragraph.characterStyleRanges || [];
            for (const range of characterRanges) {
                const style = range.appliedCharacterStyle || "";
                if (style.includes("cv%3adc") || style.includes("cv:dc")) {
                    const chapterNum = (range.content || "").trim();
                    if (chapterNum && /^\d+$/.test(chapterNum)) {
                        currentChapter = chapterNum;
                        break;
                    }
                }
                if (style.includes("meta%3ac") || style.includes("meta:c")) {
                    const metaCMatch = (range.content || "").trim().match(/^(\d+)/);
                    if (metaCMatch) {
                        currentChapter = metaCMatch[1];
                        break;
                    }
                }
            }

            // --- Handle verse paragraphs (skip, but track chapter range) ---
            if (verseSegments && Array.isArray(verseSegments) && verseSegments.length > 0) {
                // Entering a verse section resets the milestone label so the
                // next note section gets a fresh computation.
                currentMilestoneLabel = null;
                currentDivisionLabel = null;

                for (const verse of verseSegments) {
                    const { bookAbbreviation, chapterNumber, verseNumber } = verse;
                    const finalVerseBook = bookAbbreviation || currentBook;
                    const finalVerseChapter = chapterNumber;
                    if (finalVerseBook && finalVerseChapter && verseNumber) {
                        const verseRef = `${finalVerseBook} ${finalVerseChapter}:${verseNumber}`;
                        if (!currentVerseArray.includes(verseRef)) {
                            currentVerseArray.push(verseRef);
                        }
                        updateChapterRange(finalVerseChapter);
                        hasEncounteredVerses = true;
                    }
                }
                continue;
            }

            if (isPartOfSpanningVerse && spanningVerseInfo) {
                currentMilestoneLabel = null;
                currentDivisionLabel = null;
                const { bookAbbreviation, chapterNumber, verseNumber } = spanningVerseInfo;
                const spanningVerseBook = bookAbbreviation || currentBook;
                if (spanningVerseBook && chapterNumber && verseNumber) {
                    const verseRef = `${spanningVerseBook} ${chapterNumber}:${verseNumber}`;
                    if (!currentVerseArray.includes(verseRef)) {
                        currentVerseArray.push(verseRef);
                    }
                    updateChapterRange(chapterNumber);
                    hasEncounteredVerses = true;
                }
                continue;
            }

            // --- From here on, this is a non-verse paragraph ---

            // Only intro/* note styles become editable cells; skip meta running headers, TOC, etc.
            // Front/back matter has no note styles to speak of, so it takes any paragraph that
            // carries text and only drops the auto-generated running heads.
            if (includeAllTextStyles) {
                if (isBiblicaRunningHeadStyle(paragraphStyle)) {
                    continue;
                }
            } else if (!isBiblicaNoteSectionStyle(paragraphStyle)) {
                continue;
            }

            const { segments: contentSegments, breakBefore: contentSegmentBreakBefore } =
                extractContentSegmentStructureFromParagraph(paragraph);

            if (isStructuralOnlyContent(contentSegments)) {
                continue;
            }

            const allSegmentStyles =
                paragraph.contentSegmentStyles?.length === contentSegments.length
                    ? paragraph.contentSegmentStyles
                    : getSegmentCharacterStylesForParagraph(paragraph, contentSegments.length);
            // Study notes hide the "source serif" apostrophe slots so a translator's own
            // punctuation replaces them. Front/back matter is prose-heavy English where those
            // slots are ordinary possessives and contractions ("Jacobʼs", "didnʼt"), so they
            // stay visible and are written back untouched.
            const structuralApostropheIndexes = includeAllTextStyles
                ? []
                : getStructuralApostropheSegmentIndexes(contentSegments, allSegmentStyles);
            // Hidden in the editor, but only the apostrophes are cleared on export;
            // verse markers must survive untouched, so they stay out of the metadata list.
            const hiddenSegmentIndexes = mergeSegmentIndexes(
                structuralApostropheIndexes,
                getVerseMarkerSegmentIndexes(contentSegments, allSegmentStyles)
            );
            const visibleContentSegments = omitSegmentsAtIndexes(
                contentSegments,
                hiddenSegmentIndexes
            );

            const hasText = visibleContentSegments.some((segment) => segment.trim().length > 0);
            if (!hasText) {
                continue;
            }

            // Flattened heading text used to derive milestone labels. A paragraph broken over
            // several IDML lines needs a space at each break, or the words run together.
            const hiddenSegmentIndexSet = new Set(hiddenSegmentIndexes);
            const contentWithoutBreaks = contentSegments
                .map((segment, index) => {
                    if (hiddenSegmentIndexSet.has(index)) {
                        return "";
                    }
                    const needsSpace = index > 0 && contentSegmentBreakBefore[index];
                    return needsSpace ? ` ${segment}` : segment;
                })
                .join("")
                .replace(/[\r\n]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            // A division heading (intro:imt2) opens a section describing a group of books.
            // It gets its own milestone, titled after the heading, and stays open until the
            // book title that follows it.
            if (isBiblicaDivisionHeadingStyle(paragraphStyle)) {
                const divisionLabel = toDivisionMilestoneLabel(contentWithoutBreaks);
                if (divisionLabel) {
                    currentDivisionLabel = divisionLabel;
                    currentMilestoneLabel = divisionLabel;
                    firstChapterInRange = null;
                    lastChapterInRange = null;
                    currentVerseArray = [];
                }
            } else if (currentDivisionLabel && isBiblicaBookTitleStyle(paragraphStyle)) {
                // Back to book front matter: the next block recomputes a book-scoped label.
                currentDivisionLabel = null;
                currentMilestoneLabel = null;
            }

            // Major section headings (head:ms1) carve front/back matter into milestones — the
            // Bible Dictionary uses one per alphabet letter. The heading still gets its own
            // cell so the letter stays translatable and round-trips.
            if (includeAllTextStyles && isBiblicaMajorSectionHeadingStyle(paragraphStyle)) {
                const sectionLabel = toDivisionMilestoneLabel(contentWithoutBreaks);
                if (sectionLabel) {
                    currentMilestoneLabel = sectionLabel;
                }
            }

            // Chapter label headings (head:cl) like "Psalm 2" introduce a new
            // chapter. Force a new milestone so the heading and any following
            // descriptions (head:d_h) are grouped with the upcoming chapter,
            // not the previous one.
            const isChapterHeading =
                paragraphStyle.includes("head%3acl") || paragraphStyle.includes("head:cl");
            if (isChapterHeading) {
                const chapterMatch = contentWithoutBreaks.match(/(\d+)\s*$/);
                if (chapterMatch) {
                    currentMilestoneLabel = chapterMatch[1];
                    firstChapterInRange = null;
                    lastChapterInRange = null;
                    currentVerseArray = [];
                }
            }

            // First note paragraph after a verse section: compute the milestone label
            // for this note group and freeze it until the next verse section.
            // Front/back matter has no chapters to range over: paragraphs ahead of the first
            // heading stay unlabelled and land on the notebook's opening milestone.
            if (currentMilestoneLabel === null && !includeAllTextStyles) {
                currentMilestoneLabel = computeChapterRangeLabel(
                    firstChapterInRange,
                    lastChapterInRange,
                    hasEncounteredVerses
                );
                // Reset range tracking so the next verse section starts fresh.
                firstChapterInRange = null;
                lastChapterInRange = null;
                currentVerseArray = [];
            }

            // Division sections describe several books, so they carry no book reference.
            // Leaving it off also keeps the milestone titled by the heading alone rather
            // than "<Book> <heading>".
            const noteGlobalReferences: string[] =
                !includeAllTextStyles && !currentDivisionLabel && currentBook
                    ? [currentBook]
                    : [];
            const lineGroups = splitSegmentsAtLineBreaks(
                contentSegments,
                contentSegmentBreakBefore
            );
            const totalLineGroups = lineGroups.length;

            for (let segmentIndex = 0; segmentIndex < lineGroups.length; segmentIndex++) {
                const group = lineGroups[segmentIndex];
                const groupStyles = allSegmentStyles.slice(
                    group.startIndex,
                    group.startIndex + group.segments.length
                );
                const isLastSegment = segmentIndex === totalLineGroups - 1;
                const visibleSegments = omitSegmentsAtIndexes(
                    group.segments,
                    hiddenSegmentIndexes
                        .filter(
                            (idx) =>
                                idx >= group.startIndex &&
                                idx < group.startIndex + group.segments.length
                        )
                        .map((idx) => idx - group.startIndex)
                );
                if (!visibleSegments.some((segment) => segment.trim().length > 0)) {
                    continue;
                }
                const cellOriginalContent = joinContentSegments(visibleSegments);

                const { cellId, metadata: cellMetadata } = createNoteCellMetadata({
                    cellLabel: undefined,
                    storyId: story.id,
                    paragraphId: paragraph.id,
                    appliedParagraphStyle: paragraphStyle,
                    paragraph,
                    globalReferences: noteGlobalReferences,
                    sourceFileName,
                    originalHash: htmlRepresentation.originalHash ?? "",
                    stories,
                    paragraphOrder: i,
                    chapterNumber: currentMilestoneLabel ?? undefined,
                    segmentIndex,
                    totalSegments: totalLineGroups,
                    isLastSegment,
                    cellOriginalContent,
                    structuralApostropheSegmentIndexes: structuralApostropheIndexes,
                });

                const htmlContent = buildSegmentedParagraphHtml(
                    group.segments,
                    paragraphStyle,
                    story.id ?? "",
                    groupStyles,
                    group.breakBefore,
                    {
                        segmentIndexOffset: group.startIndex,
                        totalSegmentCount: contentSegments.length,
                        skipSegmentIndexes: hiddenSegmentIndexes,
                    }
                );

                const cell = createProcessedCell(
                    cellId,
                    htmlContent,
                    cellMetadata as CustomNotebookCellData["metadata"]
                );
                const images = await extractImagesFromHtml(htmlContent);
                cell.images = images;
                cells.push(cell);
            }
        }
    }
    return cells;
}
