import { describe, it, expect, beforeEach } from 'vitest';
import { IDMLParser } from './biblicaParser';

// Re-implement the chapter range label logic here for unit testing.
// Mirrors computeChapterRangeLabel in BiblicaImporterForm.tsx.
function computeChapterRangeLabel(
    firstChapter: string | null,
    lastChapter: string | null,
    hasEncounteredVerses: boolean
): string {
    if (!hasEncounteredVerses || !firstChapter) return "Preface";
    if (!lastChapter || firstChapter === lastChapter) return firstChapter;
    return `${firstChapter}-${lastChapter}`;
}

/**
 * Builds a minimal IDML Document XML that the parser can handle via the DOM path.
 * The Document element wraps a Story which contains the paragraph blocks.
 */
const wrapInStory = (paragraphs: string): string =>
    `<?xml version="1.0" encoding="UTF-8"?><Document id="TestDoc"><Story id="story1">${paragraphs}</Story></Document>`;

/**
 * Minimal verse paragraph: contains cv:v (verse number), opening meta:v, text, and closing meta:v.
 */
const verseWithClosingMarker = (
    verseNum: string,
    text: string,
    paraStyle = 'ParagraphStyle/text%3ap'
): string => `
<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av_sp">
        <Content> </Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>${text}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Br />
    </CharacterStyleRange>
</ParagraphStyleRange>`;

/**
 * Verse paragraph WITHOUT closing meta:v marker — triggers the bug scenario.
 */
const verseWithoutClosingMarker = (
    verseNum: string,
    text: string,
    paraStyle = 'ParagraphStyle/text%3ap'
): string => `
<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av_sp">
        <Content> </Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>${text}</Content>
        <Br />
    </CharacterStyleRange>
</ParagraphStyleRange>`;

/**
 * Verse paragraph using meta:c for chapter marker (Psalms style).
 * In Psalms, the first verse of each chapter has meta:c instead of cv:dc.
 */
const verseWithMetaCChapter = (
    chapterNum: string,
    verseNum: string,
    text: string,
    paraStyle = 'ParagraphStyle/text%3aq1'
): string => `
<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content> </Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac">
        <Content>${chapterNum}:</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>${text}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
        <Content>${verseNum}</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Br />
    </CharacterStyleRange>
</ParagraphStyleRange>`;

/** Book marker paragraph (meta:bk). */
const bookMarker = (abbrev: string): string => `
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>${abbrev}</Content>
        <Br />
    </CharacterStyleRange>
</ParagraphStyleRange>`;

/** Note paragraph (intro:ipi style). */
const noteParagraph = (text: string): string => `
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>${text}</Content>
        <Br />
    </CharacterStyleRange>
</ParagraphStyleRange>`;

describe('BiblicaParser – unclosed verse auto-close', () => {
    let parser: IDMLParser;
    const debugMessages: string[] = [];

    beforeEach(() => {
        parser = new IDMLParser({
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateRoundTrip: false,
            strictMode: false,
        });
        debugMessages.length = 0;
        parser.setDebugCallback((msg) => debugMessages.push(msg));
    });

    it('should NOT mark note paragraphs as isPartOfSpanningVerse when the preceding verse has no closing marker', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithClosingMarker('16', 'After all of that happened, Job lived for 140 years.'),
            verseWithoutClosingMarker('17', 'And so Job died. He had lived for a very long time.'),
            noteParagraph('Eliphaz, Bildad and Zophar had said things that were not true about God.'),
            noteParagraph('Prayer: Genesis 4:1 – 5:32.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const story = doc.stories[0];
        const paragraphs = story.paragraphs;

        const noteParas = paragraphs.filter((p) => {
            const style = p.paragraphStyleRange.appliedParagraphStyle;
            return style.includes('intro%3a') || style.includes('intro:');
        });

        expect(noteParas.length).toBe(2);
        for (const notePara of noteParas) {
            const meta = notePara.metadata as Record<string, unknown>;
            expect(meta?.isPartOfSpanningVerse).toBeFalsy();
        }
    });

    it('should NOT mark note paragraphs after a book boundary as isPartOfSpanningVerse', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithoutClosingMarker('17', 'And so Job died.'),
            noteParagraph('Final summary of Job.'),
            bookMarker('PSA'),
            verseWithClosingMarker('1', 'Blessed is the one.'),
            noteParagraph('Psalm 1 commentary.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const story = doc.stories[0];
        const paragraphs = story.paragraphs;

        const noteParas = paragraphs.filter((p) => {
            const style = p.paragraphStyleRange.appliedParagraphStyle;
            return style.includes('intro%3a') || style.includes('intro:');
        });

        expect(noteParas.length).toBe(2);
        for (const notePara of noteParas) {
            const meta = notePara.metadata as Record<string, unknown>;
            expect(meta?.isPartOfSpanningVerse).toBeFalsy();
        }
    });

    it('should still detect verse segments and keep them out of note cells', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithClosingMarker('1', 'In the land of Uz there lived a man.'),
            verseWithoutClosingMarker('2', 'He had seven sons and three daughters.'),
            noteParagraph('This is a commentary note on Job 1:1-2.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const story = doc.stories[0];
        const paragraphs = story.paragraphs;

        const verseParas = paragraphs.filter(
            (p) => ((p.metadata as any)?.biblicaVerseSegments?.length ?? 0) > 0
        );
        const noteParas = paragraphs.filter((p) => {
            const style = p.paragraphStyleRange.appliedParagraphStyle;
            return style.includes('intro%3a') || style.includes('intro:');
        });

        expect(verseParas.length).toBeGreaterThanOrEqual(1);
        expect(noteParas.length).toBe(1);

        // Verse content must NOT appear in note paragraphs
        for (const notePara of noteParas) {
            const noteContent = notePara.paragraphStyleRange.content;
            expect(noteContent).not.toContain('In the land of Uz');
            expect(noteContent).not.toContain('seven sons');
            expect(noteContent).toContain('commentary note');
        }

        // Note paragraph must not be marked as spanning verse
        for (const notePara of noteParas) {
            const meta = notePara.metadata as Record<string, unknown>;
            expect(meta?.isPartOfSpanningVerse).toBeFalsy();
        }
    });

    it('should correctly detect both book markers across books with unclosed verses', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithoutClosingMarker('17', 'And so Job died.'),
            noteParagraph('Summary of Job.'),
            bookMarker('PSA'),
            verseWithoutClosingMarker('1', 'Blessed is the one.'),
            noteParagraph('Psalm 1 commentary.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const story = doc.stories[0];
        const paragraphs = story.paragraphs;

        // Collect book markers
        const bookMarkers = paragraphs
            .filter((p) => {
                const style = p.paragraphStyleRange.appliedParagraphStyle;
                return style.includes('meta%3abk') || style.includes('meta:bk');
            })
            .map((p) => (p.metadata as any)?.bookAbbreviation);

        expect(bookMarkers).toEqual(['JOB', 'PSA']);

        // Verify that note paragraphs exist for both books and none are lost
        const noteParas = paragraphs.filter((p) => {
            const style = p.paragraphStyleRange.appliedParagraphStyle;
            return style.includes('intro%3a') || style.includes('intro:');
        });
        expect(noteParas.length).toBe(2);

        // Verify no note paragraph is marked as spanning verse
        for (const notePara of noteParas) {
            const meta = notePara.metadata as Record<string, unknown>;
            expect(meta?.isPartOfSpanningVerse).toBeFalsy();
        }
    });

    it('should log auto-close messages when verses are closed at boundaries', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithoutClosingMarker('17', 'And so Job died.'),
            noteParagraph('Commentary on Job.'),
        ].join('\n'));

        await parser.parseIDML(xml);

        const autoCloseMessages = debugMessages.filter((m) =>
            m.includes('Auto-closing')
        );
        expect(autoCloseMessages.length).toBeGreaterThan(0);
    });
});

describe('computeChapterRangeLabel', () => {
    it('returns "Preface" when no verses have been encountered', () => {
        expect(computeChapterRangeLabel(null, null, false)).toBe('Preface');
    });

    it('returns "Preface" when hasEncounteredVerses is true but firstChapter is null', () => {
        expect(computeChapterRangeLabel(null, null, true)).toBe('Preface');
    });

    it('returns the single chapter when first and last are the same', () => {
        expect(computeChapterRangeLabel('1', '1', true)).toBe('1');
    });

    it('returns a range when first and last differ', () => {
        expect(computeChapterRangeLabel('1', '2', true)).toBe('1-2');
    });

    it('handles large chapter ranges', () => {
        expect(computeChapterRangeLabel('4', '31', true)).toBe('4-31');
    });

    it('returns firstChapter when lastChapter is null', () => {
        expect(computeChapterRangeLabel('5', null, true)).toBe('5');
    });
});

describe('BiblicaParser – chapter-range milestone metadata', () => {
    let parser: IDMLParser;

    beforeEach(() => {
        parser = new IDMLParser({
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateRoundTrip: false,
            strictMode: false,
        });
    });

    it('should mark preface notes before any verses with bookAbbreviation only', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            noteParagraph('Introduction to Job.'),
            noteParagraph('Job is a wisdom book.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const paragraphs = doc.stories[0].paragraphs;

        // Both book marker and note paragraphs should exist
        const bookParas = paragraphs.filter(
            (p) => (p.metadata as any)?.bookAbbreviation === 'JOB'
        );
        expect(bookParas.length).toBe(1);

        const noteParas = paragraphs.filter((p) =>
            p.paragraphStyleRange.appliedParagraphStyle.includes('intro%3a')
        );
        expect(noteParas.length).toBe(2);

        // Note paragraphs should NOT have verse segments
        for (const note of noteParas) {
            const segs = (note.metadata as any)?.biblicaVerseSegments || [];
            expect(segs.length).toBe(0);
        }
    });

    it('should produce verse segments for verse paragraphs and none for note paragraphs', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithClosingMarker('1', 'There was a man in Uz.'),
            verseWithClosingMarker('2', 'He had seven sons.'),
            noteParagraph('Commentary on 1:1-2.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const paragraphs = doc.stories[0].paragraphs;

        const verseParas = paragraphs.filter(
            (p) => ((p.metadata as any)?.biblicaVerseSegments?.length ?? 0) > 0
        );
        const noteParas = paragraphs.filter((p) =>
            p.paragraphStyleRange.appliedParagraphStyle.includes('intro%3a')
        );

        expect(verseParas.length).toBeGreaterThanOrEqual(1);
        expect(noteParas.length).toBe(1);

        // No verse text in note content
        const noteContent = noteParas[0].paragraphStyleRange.content;
        expect(noteContent).not.toContain('There was a man in Uz');
        expect(noteContent).not.toContain('seven sons');
        expect(noteContent).toContain('Commentary');
    });

    it('should preserve note paragraphs across book boundaries with unclosed verses', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithoutClosingMarker('17', 'Job died.'),
            noteParagraph('End of Job notes.'),
            bookMarker('PSA'),
            noteParagraph('Psalms preface.'),
            verseWithClosingMarker('1', 'Blessed is the one.'),
            noteParagraph('Psalm 1 notes.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const paragraphs = doc.stories[0].paragraphs;

        const noteParas = paragraphs.filter((p) =>
            p.paragraphStyleRange.appliedParagraphStyle.includes('intro%3a')
        );

        // All 3 note paragraphs must survive
        expect(noteParas.length).toBe(3);

        // None should be marked as spanning verse
        for (const note of noteParas) {
            expect((note.metadata as any)?.isPartOfSpanningVerse).toBeFalsy();
        }
    });

    it('should use meta:c chapter markers for verse segment chapterNumber (Psalms style)', async () => {
        const xml = wrapInStory([
            bookMarker('PSA'),
            verseWithMetaCChapter('1', '1', 'Blessed is the one who obeys.'),
            verseWithClosingMarker('2', 'Instead the law gives them joy.'),
            noteParagraph('Psalm 1 commentary.'),
            verseWithMetaCChapter('2', '1', 'Why do the nations conspire?'),
            noteParagraph('Psalm 2 commentary.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const paragraphs = doc.stories[0].paragraphs;

        const verseParas = paragraphs.filter(
            (p) => ((p.metadata as any)?.biblicaVerseSegments?.length ?? 0) > 0
        );

        // Psalm 1 verse should have chapterNumber "1"
        const psalm1Verses = verseParas.filter((p) => {
            const segs = (p.metadata as any)?.biblicaVerseSegments || [];
            return segs.some((s: any) => s.chapterNumber === '1');
        });
        expect(psalm1Verses.length).toBeGreaterThanOrEqual(1);

        // Psalm 2 verse should have chapterNumber "2" (not "1" or any stale value)
        const psalm2Verses = verseParas.filter((p) => {
            const segs = (p.metadata as any)?.biblicaVerseSegments || [];
            return segs.some((s: any) => s.chapterNumber === '2');
        });
        expect(psalm2Verses.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT carry JOB chapter 42 into PSA verse segments when using meta:c', async () => {
        const xml = wrapInStory([
            bookMarker('JOB'),
            verseWithoutClosingMarker('17', 'And so Job died.'),
            noteParagraph('End of Job notes.'),
            bookMarker('PSA'),
            noteParagraph('Psalms preface.'),
            verseWithMetaCChapter('1', '1', 'Blessed is the one.'),
            noteParagraph('Psalm 1 notes.'),
        ].join('\n'));

        const doc = await parser.parseIDML(xml);
        const paragraphs = doc.stories[0].paragraphs;

        const verseParas = paragraphs.filter(
            (p) => ((p.metadata as any)?.biblicaVerseSegments?.length ?? 0) > 0
        );

        // No verse segment should have chapter "42" — that's JOB's last chapter
        for (const vp of verseParas) {
            const segs = (vp.metadata as any)?.biblicaVerseSegments || [];
            for (const seg of segs) {
                if (seg.bookAbbreviation === 'PSA') {
                    expect(seg.chapterNumber).not.toBe('42');
                    expect(seg.chapterNumber).toBe('1');
                }
            }
        }
    });
});

describe('BiblicaParser – content segments', () => {
    let parser: IDMLParser;

    beforeEach(() => {
        parser = new IDMLParser({
            preserveAllFormatting: true,
            preserveObjectIds: true,
            validateRoundTrip: false,
            strictMode: false,
        });
    });

    it('should extract contentSegments from note paragraphs matching Content nodes', async () => {
        const xml = wrapInStory(`
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>First</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Second</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`);

        const doc = await parser.parseIDML(xml);
        const para = doc.stories[0].paragraphs[0];

        expect(para.contentSegments).toEqual(['First', 'Second']);
        expect(para.contentSegmentBreakBefore).toEqual([false, false]);
    });

    it('should track breakBefore when Br separates Content nodes', async () => {
        const xml = wrapInStory(`
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Line one</Content>
        <Br />
        <Content>Line two</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`);

        const doc = await parser.parseIDML(xml);
        const para = doc.stories[0].paragraphs[0];

        expect(para.contentSegments).toEqual(['Line one', 'Line two']);
        expect(para.contentSegmentBreakBefore).toEqual([false, true]);
    });
});
