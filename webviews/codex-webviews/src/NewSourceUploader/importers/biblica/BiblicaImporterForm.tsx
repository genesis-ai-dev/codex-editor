/**
 * Biblica Importer Form — study Bible notes from InDesign IDML (custom IDML parsing).
 */

import React, { useCallback } from "react";
import { BookOpen } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import { ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { CustomNotebookCellData } from "types";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { IDMLParser } from "./biblicaParser";
import { HTMLMapper } from "./htmlMapper";
import {
    createProcessedCell,
    sanitizeFileName,
    addMilestoneCellsToNotebookPair,
    createCodexCellsFromSource,
} from "../../utils/workflowHelpers";
import { extractImagesFromHtml } from "../../utils/imageProcessor";
import { createNoteCellMetadata } from "./cellMetadata";

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
}

function buildInlineHTMLFromRanges(
    ranges: { appliedCharacterStyle?: string; content?: string }[]
): string {
    if (!Array.isArray(ranges) || ranges.length === 0) return "";

    return ranges
        .map((r) => {
            const style = (r?.appliedCharacterStyle || "").toString();
            const content = (r?.content || "").toString();
            const text = content.replace(/\n/g, "<br />");
            const safeStyle = escapeHtml(style);
            const safeText = text
                .split("<br />")
                .map((part: string) => escapeHtml(part))
                .join("<br />");
            return `<span class="idml-char" data-character-style="${safeStyle}">${safeText}</span>`;
        })
        .join("");
}

/**
 * Create cells from Study Bible stories (source notes only; verses inform globalReferences).
 */
/**
 * Compute the chapter-range milestone label for a note section.
 * - "Preface" if no verses have been scanned in this book yet.
 * - "3" if only chapter 3 was scanned since the last note section.
 * - "1-2" if chapters 1 through 2 were scanned since the last note section.
 */
function computeChapterRangeLabel(
    firstChapter: string | null,
    lastChapter: string | null,
    hasEncounteredVerses: boolean
): string {
    if (!hasEncounteredVerses || !firstChapter) return "Preface";
    if (!lastChapter || firstChapter === lastChapter) return firstChapter;
    return `${firstChapter}-${lastChapter}`;
}

async function createCellsFromStories(
    stories: unknown[],
    htmlRepresentation: { stories?: { id: string }[]; originalHash?: string },
    sourceFileName: string
): Promise<CustomNotebookCellData[]> {
    const cells: CustomNotebookCellData[] = [];
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

    const updateChapterRange = (chapter: string) => {
        if (!firstChapterInRange) {
            firstChapterInRange = chapter;
        }
        lastChapterInRange = chapter;
    };

    for (const story of stories as Array<{
        id: string;
        paragraphs: Array<{
            id: string;
            metadata?: Record<string, unknown>;
            paragraphStyleRange: {
                appliedParagraphStyle: string;
                content: string;
                dataAfter?: string;
            };
            characterStyleRanges?: Array<{ appliedCharacterStyle?: string; content?: string }>;
        }>;
    }>) {
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
                }
            }

            // --- Update currentChapter from paragraph metadata ---
            if (paragraph.metadata?.lastChapterNumber) {
                currentChapter = paragraph.metadata.lastChapterNumber as string;
            }

            // --- Fallback book detection from paragraph content ---
            if (!currentBook) {
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

            // --- From here on, this is a non-verse paragraph (note / intro / meta) ---

            const content = paragraph.paragraphStyleRange.content;
            const ranges = paragraph.characterStyleRanges || [];
            let combinedContent = content;
            if (ranges.length > 0) {
                combinedContent = ranges.map((r) => r.content || "").join("");
            }

            const contentWithoutBreaks = combinedContent
                .replace(/[\r\n]+/g, "")
                .replace(/\s+/g, " ")
                .trim();

            if (!contentWithoutBreaks || contentWithoutBreaks.length === 0) {
                continue;
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
            if (currentMilestoneLabel === null) {
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

            const contentWithBreaks = combinedContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const segments = contentWithBreaks.split("\n");
            let rangeSegments: Array<{ ranges: typeof ranges; content: string }> = [];

            if (ranges.length > 0) {
                let currentSegment: { ranges: typeof ranges; content: string } = {
                    ranges: [],
                    content: "",
                };

                for (const range of ranges) {
                    const rangeContent = range.content || "";
                    if (rangeContent.includes("\n")) {
                        const rangeParts = rangeContent.split("\n");
                        for (let j = 0; j < rangeParts.length; j++) {
                            const part = rangeParts[j];
                            if (part) {
                                currentSegment.ranges.push({ ...range, content: part });
                                currentSegment.content += part;
                            }
                            if (j < rangeParts.length - 1) {
                                rangeSegments.push({ ...currentSegment });
                                currentSegment = { ranges: [], content: "" };
                            }
                        }
                    } else {
                        currentSegment.ranges.push(range);
                        currentSegment.content += rangeContent;
                    }
                }

                if (currentSegment.content || currentSegment.ranges.length > 0) {
                    rangeSegments.push(currentSegment);
                }
                if (rangeSegments.length === 0) {
                    rangeSegments = [{ ranges, content: contentWithBreaks }];
                }
            } else {
                rangeSegments = segments.map((seg: string) => ({ ranges: [], content: seg }));
            }

            const finalSegments: Array<{ ranges: typeof ranges; content: string }> =
                rangeSegments.length > 0
                    ? rangeSegments
                    : segments.map((seg: string) => ({ ranges: [], content: seg }));

            for (let segmentIndex = 0; segmentIndex < finalSegments.length; segmentIndex++) {
                const segment = finalSegments[segmentIndex];
                const cleanText = segment.content
                    .replace(/[\r\n]+/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                if (!cleanText && segmentIndex > 0 && segment.ranges.length === 0) {
                    continue;
                }

                let inlineHTML: string;
                if (segment.ranges.length > 0) {
                    inlineHTML = buildInlineHTMLFromRanges(segment.ranges);
                } else {
                    inlineHTML = escapeHtml(segment.content);
                }

                const isLastSegment = segmentIndex === finalSegments.length - 1;
                const htmlContent = `<p class="biblica-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}" data-segment-index="${segmentIndex}" data-is-last-segment="${isLastSegment}">${inlineHTML}</p>`;

                let noteGlobalReferences: string[] = [];
                if (currentBook) {
                    noteGlobalReferences = [currentBook];
                }

                const { cellId, metadata: cellMetadata } = createNoteCellMetadata({
                    cellLabel: undefined,
                    storyId: story.id,
                    paragraphId: paragraph.id,
                    appliedParagraphStyle: paragraphStyle,
                    originalText: cleanText || segment.content,
                    globalReferences: noteGlobalReferences,
                    sourceFileName,
                    originalHash: htmlRepresentation.originalHash,
                    paragraphDataAfter: paragraph.paragraphStyleRange.dataAfter,
                    storyOrder: stories.indexOf(story),
                    paragraphOrder: i,
                    segmentIndex,
                    totalSegments: finalSegments.length,
                    isLastSegment,
                    chapterNumber: currentMilestoneLabel ?? undefined,
                });

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

async function processBiblicaIdml(
    studyBibleFile: File,
    onProgress: (progress: ImportProgress) => void
): Promise<NotebookPair[]> {
    onProgress({ stage: "Read", message: "Reading IDML file…", progress: 15 });

    const arrayBuffer = await studyBibleFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const firstBytes = Array.from(uint8Array.slice(0, 4))
        .map((b) => String.fromCharCode(b))
        .join("");
    if (firstBytes !== "PK\u0003\u0004") {
        throw new Error(
            "The selected file does not appear to be a valid IDML file. IDML files should be ZIP-compressed starting with PK"
        );
    }

    onProgress({ stage: "Parse", message: "Parsing Study Bible IDML…", progress: 35 });
    const parser = new IDMLParser({
        preserveAllFormatting: true,
        preserveObjectIds: true,
        validateRoundTrip: false,
        strictMode: false,
    });

    let document: Awaited<ReturnType<IDMLParser["parseIDML"]>>;
    try {
        document = await parser.parseIDML(arrayBuffer);
    } catch (parseError) {
        throw parseError instanceof Error ? parseError : new Error(String(parseError));
    }

    if (document.stories.length === 0) {
        throw new Error(
            "No stories found in the Study Bible IDML file. The file may be corrupted or empty."
        );
    }

    let totalParagraphs = 0;
    for (const story of document.stories) {
        totalParagraphs += story.paragraphs.length;
    }
    if (totalParagraphs === 0) {
        throw new Error(
            "No paragraphs found in the Study Bible IDML file. The file may be corrupted or empty."
        );
    }

    onProgress({ stage: "Convert", message: "Converting to HTML representation…", progress: 55 });
    const htmlMapper = new HTMLMapper();
    const htmlRepresentation = htmlMapper.convertToHTML(document);

    onProgress({
        stage: "Cells",
        message: "Creating notebook cells from study notes…",
        progress: 75,
    });
    const allCells = await createCellsFromStories(
        document.stories,
        htmlRepresentation,
        studyBibleFile.name
    );

    if (allCells.length === 0) {
        throw new Error(
            "No cells were created from the parsed content. Check the cell creation logic."
        );
    }

    const noteCells = allCells;

    onProgress({ stage: "Finalize", message: "Building notebook pair…", progress: 90 });

    const simplifiedNoteCells = noteCells.map((cell) => ({
        id: cell.id,
        content: cell.content,
        images: cell.images,
        metadata: cell.metadata,
    }));

    const rawBaseName = studyBibleFile.name.replace(/\.idml$/i, "");
    const cleanBaseName = rawBaseName.replace(/[-_]?notes$/i, "");
    const baseName = sanitizeFileName(cleanBaseName);
    const originalFileName = studyBibleFile.name;

    const notebookPairs: NotebookPair[] = [];

    if (simplifiedNoteCells.length > 0) {
        notebookPairs.push({
            source: {
                name: baseName,
                cells: simplifiedNoteCells,
                metadata: {
                    id: uuidv4(),
                    originalFileName,
                    sourceFile: originalFileName,
                    originalFileData: arrayBuffer,
                    importerType: "biblica",
                    createdAt: new Date().toISOString(),
                    importContext: {
                        importerType: "biblica",
                        fileName: originalFileName,
                        originalFileName,
                        originalHash: document.originalHash,
                        documentId: document.id,
                        importTimestamp: new Date().toISOString(),
                        contentType: "notes",
                    },
                    documentId: document.id,
                    storyCount: document.stories.length,
                    originalHash: document.originalHash,
                    totalCells: simplifiedNoteCells.length,
                    fileType: "biblica",
                    contentType: "notes",
                },
            },
            codex: {
                name: baseName,
                cells: createCodexCellsFromSource(simplifiedNoteCells),
                metadata: {
                    id: uuidv4(),
                    originalFileName,
                    sourceFile: originalFileName,
                    importerType: "biblica",
                    createdAt: new Date().toISOString(),
                    importContext: {
                        importerType: "biblica",
                        fileName: originalFileName,
                        originalFileName,
                        originalHash: document.originalHash,
                        documentId: document.id,
                        importTimestamp: new Date().toISOString(),
                        contentType: "notes",
                    },
                    documentId: document.id,
                    storyCount: document.stories.length,
                    originalHash: document.originalHash,
                    totalCells: simplifiedNoteCells.length,
                    fileType: "biblica",
                    isCodex: true,
                    contentType: "notes",
                },
            },
        });
    }

    const notebookPairsWithMilestones = notebookPairs.map((pair) =>
        addMilestoneCellsToNotebookPair(pair)
    );

    onProgress({ stage: "Complete", message: "Import ready", progress: 100 });

    return notebookPairsWithMilestones;
}

async function analyzeBiblicaFiles(files: File[]): Promise<FileAnalysisStat[]> {
    const file = files[0];
    if (!file) {
        return [];
    }
    return [
        { label: "File name", value: file.name },
        { label: "Size", value: `${(file.size / 1024 / 1024).toFixed(2)} MB` },
    ];
}

export const BiblicaImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair[]> => {
            const studyBibleFile = files[0];
            if (!studyBibleFile) {
                throw new Error("No file selected");
            }
            if (!studyBibleFile.name.toLowerCase().endsWith(".idml")) {
                throw new Error("Please select a valid IDML file (.idml extension)");
            }
            return processBiblicaIdml(studyBibleFile, onProgress);
        },
        []
    );

    const isTranslationImport = props.wizardContext?.intent === "target";

    return (
        <UnifiedImporterForm
            title="Biblica Importer"
            description={
                isTranslationImport
                    ? "Import Biblica study Bible notes from IDML for alignment with an existing source notebook."
                    : "Import Biblica study Bible notes from InDesign IDML. Verse references are detected for note metadata; add translated scripture later with Bible Swapper."
            }
            icon={BookOpen}
            accept=".idml"
            extensionBadges={[".idml"]}
            showPreview={false}
            analyzeFiles={analyzeBiblicaFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={sequentialCellAligner}
            showEnforceStructure
        />
    );
};
