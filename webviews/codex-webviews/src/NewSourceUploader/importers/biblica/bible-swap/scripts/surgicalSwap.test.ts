import { describe, it, expect } from "vitest";
import {
    buildBibleVerseIndex,
    applySurgicalSwapToStudyXml,
    verseKey,
} from "../index";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function bookPara(book: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${book}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function chapterPara(chapter: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

/** Two prose lines in one CSR (Numbers 26:49-style list). */
function listVerse49(studyLine1: string, studyLine2: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>49</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}">
    <Content>${studyLine1}</Content>
    <Content>	${studyLine2}</Content>
  </CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>49</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function minimalStory(body: string): string {
    return `<?xml version="1.0"?><Story>${bookPara("NUM")}${chapterPara("26")}${body}</Story>`;
}

function psalmStory(body: string): string {
    return `<?xml version="1.0"?><Story>${bookPara("PSA")}${body}</Story>`;
}

function englishPsalmSubheader(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function psalmVerseLine(
    chapter: string,
    verse: string,
    text: string,
    options?: { paraStyle?: string; includeChapterMarker?: boolean }
): string {
    const paraStyle = options?.paraStyle ?? "ParagraphStyle/text%3aq1";
    const chapterMarker =
        options?.includeChapterMarker ?? verse === "1"
            ? `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>`
            : "";
    return `<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av_sp"><Content> </Content></CharacterStyleRange>
  ${chapterMarker}
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function biblePsalmSubheaderVerse(chapter: string, text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

describe("bibleSwap multi-line verses", () => {
    it("maps Bible segments 1:1 onto Study prose slots (does not clear second line)", () => {
        const study = minimalStory(
            listVerse49("The Jezerite family came from Jezer.", "The Shillemite family came from Shillem.")
        );
        const bible = minimalStory(
            listVerse49("de Jezer, o clã jezerita;", "de Silém, o clã silemita.")
        );

        const index = buildBibleVerseIndex(bible);
        const entry = index.get(verseKey("NUM", "26", "49"));
        expect(entry?.segments).toHaveLength(2);
        expect(entry?.segments[0]).toBe("de Jezer, o clã jezerita;");
        expect(entry?.segments[1]).toContain("de Silém, o clã silemita.");

        const { xml } = applySurgicalSwapToStudyXml(study, index);
        expect(xml).toContain("de Jezer, o clã jezerita;");
        expect(xml).toContain("de Silém, o clã silemita.");
        expect(xml).not.toMatch(/<Content><\/Content>\s*<Content>\s*<\/Content>/);
        expect(xml).not.toContain("The Jezerite family");
        expect(xml).not.toContain("The Shillemite family");
    });

    it("preserves tab prefix on the second list line", () => {
        const study = minimalStory(
            listVerse49("Line A.", "Line B.")
        );
        const bible = minimalStory(listVerse49("Linha A.", "Linha B."));

        const index = buildBibleVerseIndex(bible);
        const { xml } = applySurgicalSwapToStudyXml(study, index);
        expect(xml).toMatch(/<Content>\tLinha B\.<\/Content>/);
    });

    it("does not duplicate text when Bible verse has redundant Content segments", () => {
        const verseText =
            "Ó cidade da Babilônia, destinada à destruição, bem-aventurado aquele que lhe retribuir o mal que você nos fez!";
        const study = minimalStory(
            listVerse49(
                "People of Babylon, you are sentenced to be destroyed.",
                "Happy is the person who pays you back."
            )
        );
        const bible = minimalStory(listVerse49(verseText, verseText));

        const index = buildBibleVerseIndex(bible);
        expect(index.get(verseKey("NUM", "26", "49"))?.segments).toHaveLength(2);

        const { xml } = applySurgicalSwapToStudyXml(study, index);

        expect(xml).toContain("Ó cidade da Babilônia");
        expect(xml).toContain("lhe retribuir o mal que você nos fez!");
        expect(xml).not.toContain(`${verseText}${verseText}`);
        expect(xml).not.toContain("People of Babylon");
    });

    it("does not duplicate text when Study has one prose slot and Bible has redundant segments", () => {
        const verseText = "Ó cidade da Babilônia, destinada à destruição.";
        const singleLineVerse = (verse: string, text: string) =>
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}">
    <Content>${text}</Content>
  </CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
        const study = minimalStory(
            singleLineVerse("8", "People of Babylon, you are sentenced to be destroyed.")
        );
        const bible = minimalStory(
            listVerse49(verseText, verseText).replace(/49/g, "8")
        );

        const { xml } = applySurgicalSwapToStudyXml(study, buildBibleVerseIndex(bible));

        expect(xml).toContain(verseText);
        expect(xml).not.toContain(`${verseText}${verseText}`);
    });

    it("splits one Bible segment across multiple Study lines by weight", () => {
        const study = minimalStory(
            listVerse49("Short.", "A much longer second line in the study.")
        );
        const bibleBody = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>49</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}">
    <Content>Um texto português único que deve ser repartido.</Content>
  </CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>49</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
        const bible = minimalStory(bibleBody);

        const index = buildBibleVerseIndex(bible);
        expect(index.get(verseKey("NUM", "26", "49"))?.segments).toHaveLength(1);
        const { xml } = applySurgicalSwapToStudyXml(study, index);
        expect(xml).toContain("Um");
        expect(xml).toContain("texto português");
        expect(xml).not.toMatch(/<Content><\/Content>/);
    });
});

describe("bibleSwap Psalms", () => {
    it("keeps English head:d_h subheader and maps study v1 to bible v1 (Portuguese)", () => {
        const study = psalmStory(
            englishPsalmSubheader("A psalm of David when he ran away from his son Absalom.") +
                psalmVerseLine("3", "1", "Lord, I have many enemies!") +
                psalmVerseLine("3", "2", "Many are saying about me, 'God will not save him.'", {
                    includeChapterMarker: false,
                })
        );
        const bible = psalmStory(
            psalmVerseLine("3", "1", "Senhor, quantos são os meus adversários!") +
                psalmVerseLine("3", "2", "São muitos os que dizem de mim:", {
                    includeChapterMarker: false,
                })
        );

        const index = buildBibleVerseIndex(bible);
        const { xml, stats } = applySurgicalSwapToStudyXml(study, index);

        expect(xml).toContain("A psalm of David when he ran away");
        expect(xml).toContain("Senhor, quantos são os meus adversários!");
        expect(xml).toContain("São muitos os que dizem de mim:");
        expect(xml).not.toContain("Lord, I have many enemies!");
        expect(stats.psalmSubheaderOffsets).toBe(0);
    });

    it("applies +1 subheader offset when Bible v1 is head:d_h (French pattern)", () => {
        const study = psalmStory(
            englishPsalmSubheader("A psalm of David when he ran away from his son Absalom.") +
                psalmVerseLine("3", "1", "Lord, I have many enemies!") +
                psalmVerseLine("3", "2", "Many are saying about me.", {
                    includeChapterMarker: false,
                })
        );
        const bible = psalmStory(
            biblePsalmSubheaderVerse("3", "Psaume de David, quand il fuyait Absalom.") +
                psalmVerseLine("3", "2", "Seigneur, que mes ennemis sont nombreux!", {
                    includeChapterMarker: false,
                }) +
                psalmVerseLine("3", "3", "Beaucoup disent à mon sujet:", {
                    includeChapterMarker: false,
                })
        );

        const index = buildBibleVerseIndex(bible);
        expect(index.get(verseKey("PSA", "3", "1"))?.isSubheader).toBe(true);

        const { xml, stats } = applySurgicalSwapToStudyXml(study, index);

        expect(xml).toContain("A psalm of David when he ran away");
        expect(xml).toContain("Seigneur, que mes ennemis sont nombreux!");
        expect(xml).toContain("Beaucoup disent à mon sujet:");
        expect(xml).not.toContain("Psaume de David");
        expect(xml).not.toContain("Lord, I have many enemies!");
        expect(stats.psalmSubheaderOffsets).toBe(1);
    });

    it("inserts extra Bible verses at chapter end when offset leaves one unmatched", () => {
        const study = psalmStory(
            englishPsalmSubheader("A psalm of David.") +
                psalmVerseLine("3", "1", "Verse one English.") +
                psalmVerseLine("3", "2", "Verse two English.", { includeChapterMarker: false })
        );
        const bible = psalmStory(
            biblePsalmSubheaderVerse("3", "Psaume de David.") +
                psalmVerseLine("3", "2", "Vers un.", { includeChapterMarker: false }) +
                psalmVerseLine("3", "3", "Vers deux.", { includeChapterMarker: false }) +
                psalmVerseLine("3", "4", "Vers trois bonus.", { includeChapterMarker: false })
        );

        const index = buildBibleVerseIndex(bible);
        const { xml, stats } = applySurgicalSwapToStudyXml(study, index);

        expect(xml).toContain("Vers un.");
        expect(xml).toContain("Vers deux.");
        expect(xml).toContain("Vers trois bonus.");
        expect(stats.psalmVersesInserted).toBe(1);
        expect(xml).toMatch(/cv%3av[\s\S]*?<Content>4<\/Content>/);
    });

    it("does not corrupt XML tags when inserting extra verses after content swaps", () => {
        const study = psalmStory(
            englishPsalmSubheader("A psalm of David.") +
                psalmVerseLine("3", "1", "Verse one English.") +
                psalmVerseLine("3", "2", "Verse two English.", { includeChapterMarker: false })
        );
        const bible = psalmStory(
            biblePsalmSubheaderVerse("3", "Psaume de David.") +
                psalmVerseLine("3", "2", "Vers un.", { includeChapterMarker: false }) +
                psalmVerseLine("3", "3", "Vers deux.", { includeChapterMarker: false }) +
                psalmVerseLine("3", "4", "Vers trois bonus.", { includeChapterMarker: false })
        );

        const index = buildBibleVerseIndex(bible);
        const { xml } = applySurgicalSwapToStudyXml(study, index);

        expect(xml).not.toMatch(/<\/Paragraph</);
        expect(xml).not.toMatch(/Paragraph<Paragraph/);
        const openPara = (xml.match(/<ParagraphStyleRange/g) ?? []).length;
        const closePara = (xml.match(/<\/ParagraphStyleRange>/g) ?? []).length;
        expect(openPara).toBe(closePara);
    });
});
