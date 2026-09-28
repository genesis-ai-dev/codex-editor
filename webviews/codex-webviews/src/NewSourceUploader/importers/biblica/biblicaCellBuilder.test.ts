import { describe, it, expect } from "vitest";
import { createCellsFromStories } from "./biblicaCellBuilder";
import { addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
import type { IDMLParagraph, IDMLStory } from "./types";
import type { NotebookPair, ProcessedCell } from "../../types/common";

/** Build a paragraph from explicit (character style, text) slots. */
const styledParagraph = (
    style: string,
    slots: Array<{ style: string; text: string; }>,
    metadata: Record<string, any> = {}
): IDMLParagraph => ({
    id: `p-${style}-${slots.map((s) => s.text).join("").slice(0, 12)}`,
    paragraphStyleRange: {
        appliedParagraphStyle: `ParagraphStyle/${style}`,
        properties: {},
        content: slots.map((s) => s.text).join(""),
    },
    characterStyleRanges: slots.map((slot, index) => ({
        appliedCharacterStyle: `CharacterStyle/${slot.style}`,
        properties: {},
        content: slot.text,
        startIndex: index,
        endIndex: index + slot.text.length,
    })),
    contentSegments: slots.map((s) => s.text),
    contentSegmentBreakBefore: slots.map(() => false),
    contentSegmentStyles: slots.map((s) => `CharacterStyle/${s.style}`),
    metadata: { biblicaVerseSegments: [], ...metadata },
});

const paragraph = (
    style: string,
    text: string,
    metadata: Record<string, any> = {}
): IDMLParagraph => ({
    id: `p-${style}-${text.slice(0, 12)}`,
    paragraphStyleRange: {
        appliedParagraphStyle: `ParagraphStyle/${style}`,
        properties: {},
        content: text,
    },
    characterStyleRanges: [
        {
            appliedCharacterStyle: "CharacterStyle/$ID/[No character style]",
            properties: {},
            content: text,
            startIndex: 0,
            endIndex: text.length,
        },
    ],
    contentSegments: [text],
    contentSegmentBreakBefore: [false],
    contentSegmentStyles: ["CharacterStyle/$ID/[No character style]"],
    metadata: { biblicaVerseSegments: [], ...metadata },
});

const bookMarker = (abbr: string): IDMLParagraph =>
    paragraph("meta%3abk", abbr, { bookAbbreviation: abbr });

const verse = (book: string, chapter: string, verseNumber: string): IDMLParagraph =>
    paragraph("text%3ap", `verse ${chapter}:${verseNumber}`, {
        biblicaVerseSegments: [
            { bookAbbreviation: book, chapterNumber: chapter, verseNumber },
        ],
    });

const story = (paragraphs: IDMLParagraph[]): IDMLStory => ({
    id: "u363",
    paragraphs,
});

const build = (paragraphs: IDMLParagraph[]) =>
    createCellsFromStories([story(paragraphs)], { originalHash: "hash" }, "TEST.idml");

/** Import in front/back matter mode, where every text-bearing style becomes a cell. */
const buildFrontBack = (paragraphs: IDMLParagraph[]) =>
    createCellsFromStories([story(paragraphs)], { originalHash: "hash" }, "TEST.idml", {
        includeAllTextStyles: true,
    });

/** Milestone titles in order, as they appear in the imported notebook. */
const milestoneTitles = (cells: ProcessedCell[]): string[] => {
    const pair = {
        source: {
            name: "TEST",
            cells,
            metadata: { importerType: "biblica" },
        },
        codex: {
            name: "TEST",
            cells,
            metadata: { importerType: "biblica", isCodex: true },
        },
    } as unknown as NotebookPair;

    return (addMilestoneCellsToNotebookPair(pair).source.cells || [])
        .filter((cell) => cell.metadata?.type === "milestone")
        .map((cell) => cell.content);
};

const cellText = (cell: ProcessedCell): string =>
    cell.content.replace(/<[^>]*>/g, "").replace(/\u00ad/g, "").trim();

/** Locate a cell by its rendered text, failing the test if it was not imported. */
const cellByText = (
    cells: ProcessedCell[],
    predicate: (text: string) => boolean
): { chapterNumber: string; globalReferences: string[]; } => {
    const cell = cells.find((candidate) => predicate(cellText(candidate)));
    if (!cell) {
        throw new Error("No imported cell matched the expected text");
    }
    return {
        chapterNumber: cell.metadata?.chapterNumber,
        globalReferences: cell.metadata?.data?.globalReferences,
    };
};

describe("createCellsFromStories — division sections", () => {
    // Mirrors the head of MAT-JOHN.idml: the "Stories about Jesus" division heading sits
    // inside Matthew's front matter but introduces the whole Gospels group.
    const matJohnHead = [
        paragraph("meta%3aid", "MAT - New International Readers Version"),
        bookMarker("MAT"),
        paragraph("meta%3ah", "Matthew"),
        paragraph("meta%3atoc1", "Matthew"),
        paragraph("intro%3aimt2", "Sto\u00adries about Jesus"),
        paragraph("intro%3aip", "The books from Matthew to Acts are stories about Jesus."),
        paragraph("intro%3aimt1", "The Gospel of Matthew"),
        paragraph("intro%3ais1", "What is the book of Matthew?"),
        verse("MAT", "1", "1"),
        paragraph("intro%3aipi", "1:1-17 Note on the family line."),
    ];

    it("puts the division heading and its body on their own milestone", async () => {
        const cells = await build(matJohnHead);

        const heading = cellByText(cells, (text) => text === "Stories about Jesus");
        const body = cellByText(cells, (text) => text.startsWith("The books from Matthew"));

        expect(heading.chapterNumber).toBe("Stories about Jesus");
        expect(body.chapterNumber).toBe("Stories about Jesus");
    });

    it("leaves division cells unattached to a book so the milestone is titled by the heading", async () => {
        const cells = await build(matJohnHead);
        const heading = cellByText(cells, (text) => text === "Stories about Jesus");

        expect(heading.globalReferences).toEqual([]);
        expect(milestoneTitles(cells)).toEqual([
            "Stories about Jesus",
            "Matthew Preface",
            "Matthew 1",
        ]);
    });

    it("returns to book-scoped labelling at the book title that follows", async () => {
        const cells = await build(matJohnHead);
        const bookTitle = cellByText(cells, (text) => text === "The Gospel of Matthew");

        expect(bookTitle.chapterNumber).toBe("Preface");
        expect(bookTitle.globalReferences).toEqual(["MAT"]);
    });

    // Mirrors ACT-REV.idml, where "Letters and messages" appears after the whole book of
    // Acts, inside Romans' front matter.
    it("handles a division that opens mid-file after a completed book", async () => {
        const cells = await build([
            bookMarker("ACT"),
            paragraph("intro%3aimt1", "The book of Acts"),
            verse("ACT", "28", "31"),
            bookMarker("ROM"),
            paragraph("meta%3atoc1", "Romans"),
            paragraph("intro%3aimt2", "Letters and messages"),
            paragraph("intro%3aip", "The books from Romans to Revelation are letters."),
            paragraph("intro%3aimt1", "Romans"),
            paragraph("intro%3ais1", "What is the book of Romans?"),
        ]);

        const heading = cellByText(cells, (text) => text === "Letters and messages");
        const romansTitle = cellByText(cells, (text) => text === "Romans");

        expect(heading.chapterNumber).toBe("Letters and messages");
        expect(heading.globalReferences).toEqual([]);
        expect(romansTitle.chapterNumber).toBe("Preface");
        expect(romansTitle.globalReferences).toEqual(["ROM"]);
        expect(milestoneTitles(cells)).toEqual([
            "Acts Preface",
            "Letters and messages",
            "Romans Preface",
        ]);
    });

    it("keeps prefaces untouched for books with no division heading", async () => {
        const cells = await build([
            bookMarker("MRK"),
            paragraph("intro%3aimt1", "The Gospel of Mark"),
            paragraph("intro%3ais1", "What is the book of Mark?"),
            verse("MRK", "1", "1"),
            paragraph("intro%3aipi", "1:1 Note."),
        ]);

        expect(cells.map((cell) => cell.metadata?.chapterNumber)).toEqual([
            "Preface",
            "Preface",
            "1",
        ]);
        expect(milestoneTitles(cells)).toEqual(["Mark Preface", "Mark 1"]);
    });
});

describe("createCellsFromStories — chapter/verse marker bleed-through", () => {
    // InDesign flushes the closing markers of a book's last verse into the next paragraph
    // of the text flow, which is the following book's intro:ie. In MAT-JOHN that put
    // Matthew's "28:20" at the end of Mark's preface.
    const introEnd = (chapter: string, verseNumber: string) =>
        styledParagraph("intro%3aie", [
            { style: "meta%3ac", text: `${chapter}:` },
            { style: "meta%3av", text: verseNumber },
        ]);

    it("drops the marker-only intro:ie paragraph instead of emitting a cell", async () => {
        const cells = await build([
            bookMarker("MRK"),
            paragraph("intro%3aimt1", "The Gospel of Mark"),
            paragraph("intro%3aio1", "Jesus resurrection and final instructions (16)."),
            introEnd("28", "20"),
        ]);

        expect(cells.map(cellText)).toEqual([
            "The Gospel of Mark",
            "Jesus resurrection and final instructions (16).",
        ]);
    });

    it("strips a trailing verse marker without losing the note it is attached to", async () => {
        const cells = await build([
            bookMarker("REV"),
            styledParagraph("intro%3aipi", [
                { style: "bd", text: "21:9–21" },
                { style: "$ID/[No character style]", text: " The fourth vision John wrote about." },
                { style: "meta%3av", text: "21" },
            ]),
        ]);

        expect(cells).toHaveLength(1);
        expect(cellText(cells[0])).toBe("21:9–21 The fourth vision John wrote about.");
    });

    it("keeps the marker slot in the HTML index space so export can restore it", async () => {
        const cells = await build([
            bookMarker("REV"),
            styledParagraph("intro%3aipi", [
                { style: "bd", text: "Note text." },
                { style: "meta%3av", text: "21" },
            ]),
        ]);

        // Segment 1 is omitted from the editor HTML but still counted, so the exporter
        // maps the remaining spans onto the right <Content> slots and leaves 1 untouched.
        expect(cells[0].content).toContain('data-segment-index="0"');
        expect(cells[0].content).not.toContain('data-segment-index="1"');
        expect(cells[0].content).toContain('data-segment-count="2"');
        // Verse markers are never force-cleared on export, unlike structural apostrophes.
        expect(
            cells[0].metadata?.data?.idmlStructure?.structuralApostropheSegmentIndexes
        ).toBeUndefined();
    });
});

describe("createCellsFromStories — scripture headings", () => {
    // Mirrors the Psalter in JOB-SNG.idml. The verses themselves come from the Bible
    // translation, but everything the layout sets around them — the five-book headings,
    // the chapter labels and the superscriptions — is translated here.
    const psalter = [
        bookMarker("PSA"),
        paragraph("intro%3aimt1", "Psalms"),
        paragraph("head%3ams", "Book I"),
        paragraph("head%3amr_h", "Psalms 1\u201441"),
        paragraph("head%3acl", "Psalm 1"),
        verse("PSA", "1", "1"),
        paragraph("head%3acl", "Psalm 3"),
        paragraph("head%3ad_h", "A psalm of David."),
        paragraph("text%3aq1", "Lord, I have so many enemies!"),
        verse("PSA", "3", "1"),
        paragraph("intro%3aimi", "3:1-8 Note about Psalm 3."),
    ];

    it("imports the headings but leaves the verse lines to the Bible text", async () => {
        expect((await build(psalter)).map(cellText)).toEqual([
            "Psalms",
            "Book I",
            "Psalms 1\u201441",
            "Psalm 1",
            "Psalm 3",
            "A psalm of David.",
            "3:1-8 Note about Psalm 3.",
        ]);
    });

    it("opens a milestone per psalm and groups the superscription with it", async () => {
        const cells = await build(psalter);

        expect(cellByText(cells, (text) => text === "Psalm 3").chapterNumber).toBe("3");
        expect(cellByText(cells, (text) => text === "A psalm of David.").chapterNumber).toBe("3");
        expect(milestoneTitles(cells)).toEqual(["Psalms Preface", "Psalms 1", "Psalms 3"]);
    });

    it("keeps headings attached to their book", async () => {
        const cells = await build(psalter);

        expect(cellByText(cells, (text) => text === "Psalm 1").globalReferences).toEqual(["PSA"]);
    });

    it("imports speaker lines and acrostic letters", async () => {
        const cells = await build([
            bookMarker("PSA"),
            paragraph("head%3acl", "Psalm 119"),
            paragraph("head%3aqa", "Aleph"),
            verse("PSA", "119", "1"),
            bookMarker("SNG"),
            paragraph("head%3asp", "She says"),
            verse("SNG", "1", "2"),
        ]);

        expect(cells.map(cellText)).toEqual(["Psalm 119", "Aleph", "She says"]);
    });
});

describe("createCellsFromStories — front/back matter volumes", () => {
    it("imports layout styles that the study-notes pass skips", async () => {
        const paragraphs = [
            paragraph("intro%3aimt2", "Bible Dictionary"),
            paragraph("text%3ap", "12 tribes: Genesis 32:1 – 35:29. Page 51"),
            paragraph("text%3am", "Jacob had 12 sons."),
            paragraph("toc%3aTOC body text", "Genesis\t6"),
            paragraph("title%3amt1", "HOLY BIBLE"),
        ];

        // The notes pass only recognises intro/* styles.
        expect((await build(paragraphs)).map(cellText)).toEqual(["Bible Dictionary"]);

        expect((await buildFrontBack(paragraphs)).map(cellText)).toEqual([
            "Bible Dictionary",
            "12 tribes: Genesis 32:1 – 35:29. Page 51",
            "Jacob had 12 sons.",
            "Genesis\t6",
            "HOLY BIBLE",
        ]);
    });

    it("skips auto-generated running heads", async () => {
        const cells = await buildFrontBack([
            paragraph("meta%3arh", "\tRunning head"),
            paragraph("text%3am", "Real text."),
        ]);

        expect(cells.map(cellText)).toEqual(["Real text."]);
    });

    it("turns each head:ms1 heading into its own milestone", async () => {
        const cells = await buildFrontBack([
            paragraph("intro%3aimt2", "Bible Dictionary"),
            paragraph("text%3am", "Front note."),
            paragraph("head%3ams1", "A"),
            paragraph("text%3ap", "Aaron:"),
            paragraph("text%3am", "Brother of Moses."),
            paragraph("head%3ams1", "B"),
            paragraph("text%3ap", "Baal:"),
        ]);

        expect(milestoneTitles(cells)).toEqual(["Bible Dictionary", "A", "B"]);
        // The letter stays a cell of its own so it is translatable and round-trips.
        expect(cells.map(cellText)).toContain("A");
        expect(cellByText(cells, (text) => text === "Baal:").chapterNumber).toBe("B");
    });

    it("labels milestones without a book prefix", async () => {
        const cells = await buildFrontBack([
            paragraph("head%3ams1", "A"),
            paragraph("text%3am", "An entry."),
        ]);

        expect(cellByText(cells, (text) => text === "An entry.").globalReferences).toEqual([]);
        expect(milestoneTitles(cells)).toEqual(["A"]);
    });

    it("keeps apostrophe slots visible and out of the force-clear list", async () => {
        const cells = await buildFrontBack([
            styledParagraph("text%3am", [
                { style: "$ID/[No character style]", text: "Jacob" },
                { style: "source serif", text: "\u02BC" },
                { style: "$ID/[No character style]", text: "s sons" },
            ]),
        ]);

        expect(cells).toHaveLength(1);
        expect(cellText(cells[0])).toBe("Jacob\u02BCs sons");
        expect(
            cells[0].metadata?.data?.idmlStructure?.structuralApostropheSegmentIndexes
        ).toBeUndefined();
    });

    it("still hides apostrophe slots for study notes", async () => {
        const cells = await build([
            styledParagraph("intro%3aipi", [
                { style: "$ID/[No character style]", text: "Jacob" },
                { style: "source serif", text: "\u02BC" },
                { style: "$ID/[No character style]", text: "s sons" },
            ]),
        ]);

        expect(cellText(cells[0])).toBe("Jacobs sons");
        expect(
            cells[0].metadata?.data?.idmlStructure?.structuralApostropheSegmentIndexes
        ).toEqual([1]);
    });

    it("joins a heading split across lines with a space", async () => {
        const heading: IDMLParagraph = {
            ...paragraph("intro%3aimt2", "placeholder"),
            contentSegments: ["The Drama Of The Bible:", "a visual chronology"],
            contentSegmentBreakBefore: [false, true],
            contentSegmentStyles: [
                "CharacterStyle/$ID/[No character style]",
                "CharacterStyle/$ID/[No character style]",
            ],
        };

        const cells = await buildFrontBack([heading, paragraph("text%3am", "Body.")]);

        expect(milestoneTitles(cells)).toEqual([
            "The Drama Of The Bible: a visual chronology",
        ]);
    });
});
