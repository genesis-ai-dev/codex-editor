/**
 * Tests for Bible Swap (hybrid block-swap + content-only fallback).
 */

import { describe, it, expect } from "vitest";
import {
    buildBibleVerseIndex,
    applyBibleSwapToStudyXml,
    verseKey,
} from "./bibleSwap";

const wrapStory = (paragraphsXml: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">` +
    `<Story Self="us1" AppliedTOCStyle="n">` +
    paragraphsXml +
    `</Story></idPkg:Story>`;

const bookMarker = (code: string) =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">` +
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
    `<Content>${code}</Content></CharacterStyleRange></ParagraphStyleRange>`;

const noStyleCsr = (inner: string) =>
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
    `<Content>${inner}</Content></CharacterStyleRange>`;

const verseMarkerCsr = (n: string) =>
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">` +
    `<Content>${n}</Content></CharacterStyleRange>`;

const chapterMarkerCsr = (n: string) =>
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac">` +
    `<Content>${n}:</Content></CharacterStyleRange>`;

const chapterParagraph = (n: string) =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_dc1">` +
    chapterMarkerCsr(n) +
    `</ParagraphStyleRange>`;

const simpleVerseParagraph = (
    style: string,
    chapter: string | null,
    verse: string,
    body: string
) =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}">` +
    (chapter ? chapterMarkerCsr(chapter) : "") +
    verseMarkerCsr(verse) +
    noStyleCsr(body) +
    verseMarkerCsr(verse) +
    `</ParagraphStyleRange>`;

/** Study/Bible share identical CSR skeleton in one paragraph → block swap. */
const identicalSkeletonVerse = (bodyStudy: string, bodyBible: string) => {
    const versePara = (body: string) =>
        `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
        chapterMarkerCsr("1") +
        verseMarkerCsr("1") +
        noStyleCsr(body) +
        verseMarkerCsr("1") +
        `</ParagraphStyleRange>`;
    return {
        study: bookMarker("GEN") + versePara(bodyStudy),
        bible: bookMarker("GEN") + versePara(bodyBible),
    };
};

describe("buildBibleVerseIndex", () => {
    it("indexes verse text and structure signature", () => {
        const xml = wrapStory(
            bookMarker("GEN") + simpleVerseParagraph("text%3ap", "1", "1", "No princípio")
        );
        const idx = buildBibleVerseIndex(xml);
        const v = idx.get(verseKey("GEN", "1", "1"));
        expect(v?.text).toContain("No princípio");
        expect(v?.structureSig).toContain("meta:v");
        expect(v?.blockXml).toContain("No princípio");
    });

    it("extracts book code from polluted meta:bk content", () => {
        const polluted =
            bookMarker("[PT] GEN") + simpleVerseParagraph("text%3ap", "1", "1", "x");
        const idx = buildBibleVerseIndex(wrapStory(polluted));
        expect(idx.get(verseKey("GEN", "1", "1"))).toBeDefined();
    });

    it("concatenates cross-paragraph verse text (GEN 1:3 pattern)", () => {
        const paraOpen =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            verseMarkerCsr("3") +
            noStyleCsr("Deus disse:") +
            `</ParagraphStyleRange>`;
        const paraMid =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_sd">` +
            noStyleCsr("Haja luz.") +
            `</ParagraphStyleRange>`;
        const paraClose =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            noStyleCsr("E houve luz.") +
            verseMarkerCsr("3") +
            `</ParagraphStyleRange>`;
        const xml = wrapStory(bookMarker("GEN") + chapterParagraph("1") + paraOpen + paraMid + paraClose);
        const idx = buildBibleVerseIndex(xml);
        const v = idx.get(verseKey("GEN", "1", "3"))!;
        expect(v.text).toContain("Deus disse:");
        expect(v.text).toContain("Haja luz.");
        expect(v.text).toContain("E houve luz.");
        expect(v.singleParagraph).toBe(false);
    });
});

describe("applyBibleSwapToStudyXml — structure-preserving swap", () => {
    it("replaces verse text when structure signatures match without replacing Study CSRs", () => {
        const { study, bible } = identicalSkeletonVerse("ENGLISH", "PORTUGUÊS");
        const idx = buildBibleVerseIndex(wrapStory(bible));
        const entry = idx.get(verseKey("GEN", "1", "1"));
        expect(entry?.structureSig).toBeTruthy();

        const { xml, stats } = applyBibleSwapToStudyXml(wrapStory(study), idx);

        expect(stats.replacedCount).toBe(1);
        expect(stats.blockSwapCount).toBe(1);
        expect(stats.contentOnlyCount).toBe(0);
        expect(xml).toContain("PORTUGUÊS");
        expect(xml).not.toContain("ENGLISH");
    });

    it("preserves Study CharacterStyleRange attributes such as Tracking", () => {
        const verseWithTracking = (body: string) =>
            bookMarker("GEN") +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            chapterMarkerCsr("2") +
            verseMarkerCsr("10") +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" Tracking="-15">` +
            `<Content>${body}</Content></CharacterStyleRange>` +
            verseMarkerCsr("10") +
            `</ParagraphStyleRange>`;

        const studyXml = wrapStory(verseWithTracking("A river watered the garden."));
        const bibleXml = wrapStory(verseWithTracking("Um rio fluía do Éden."));
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.blockSwapCount).toBe(1);
        expect(xml).toContain('Tracking="-15"');
        expect(xml).toContain("Um rio fluía");
        expect(xml).not.toContain("A river watered");
    });

    it("preserves styled divine-name runs (nd) while swapping text", () => {
        const verseWithNd = (lord: string, rest: string) =>
            bookMarker("GEN") +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            chapterMarkerCsr("2") +
            verseMarkerCsr("15") +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
            `<Content>The </Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/nd">` +
            `<Content>${lord}</Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
            `<Content> ${rest}</Content></CharacterStyleRange>` +
            verseMarkerCsr("15") +
            `</ParagraphStyleRange>`;

        const studyXml = wrapStory(
            verseWithNd("Lord", "God put the man in the Garden of Eden.")
        );
        const bibleXml = wrapStory(
            verseWithNd("SENHOR", "Deus tomou o homem e o colocou no jardim do Éden.")
        );
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(xml).toContain('AppliedCharacterStyle="CharacterStyle/nd"');
        expect(xml).toContain("SENHOR");
        expect(xml).toContain("Deus tomou o homem");
        expect(xml).not.toContain("Lord");
        expect(xml).not.toContain("God put the man");
    });
});

describe("applyBibleSwapToStudyXml — content-only fallback", () => {
    it("uses content-only when Study and Bible verse structures differ", () => {
        // Study: single paragraph, all of verse 3 in one block
        const studyPara =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            verseMarkerCsr("3") +
            noStyleCsr("God said, 'Let there be light.' And there was light.") +
            verseMarkerCsr("3") +
            `</ParagraphStyleRange>`;
        // Bible: three paragraphs (quoted speech split) — different structure
        const bibleParas =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            verseMarkerCsr("3") +
            noStyleCsr("Deus disse:") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_sd">` +
            noStyleCsr("Haja luz.") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            noStyleCsr("E houve luz.") +
            verseMarkerCsr("3") +
            `</ParagraphStyleRange>`;

        const studyXml = wrapStory(bookMarker("GEN") + chapterParagraph("1") + studyPara);
        const bibleXml = wrapStory(bookMarker("GEN") + chapterParagraph("1") + bibleParas);
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.replacedCount).toBe(1);
        expect(stats.blockSwapCount).toBe(0);
        expect(stats.contentOnlyCount).toBe(1);
        expect(xml).toContain("Deus disse:");
        expect(xml).toContain("Haja luz.");
        expect(xml).not.toContain("God said");
        // Study still has a single text%3ap paragraph for verse 3 (Bible's extra paras are not copied)
        const studyVerse3Paras = (xml.match(/ParagraphStyle\/text%3ap">/g) || []).length;
        expect(studyVerse3Paras).toBeGreaterThanOrEqual(1);
    });

    it("distributes multi-line poetry across Study paragraph slots instead of clearing them", () => {
        const poetryVerse = (lines: string[], closingVerse = "23") => {
            const speech = lines[0];
            const poetryLines = lines.slice(1);
            let xml =
                bookMarker("GEN") +
                chapterParagraph("2") +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
                verseMarkerCsr("23") +
                noStyleCsr(speech) +
                `</ParagraphStyleRange>`;
            for (const line of poetryLines) {
                xml +=
                    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
                    noStyleCsr(line) +
                    `</ParagraphStyleRange>`;
            }
            xml +=
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
                verseMarkerCsr(closingVerse) +
                `</ParagraphStyleRange>`;
            return xml;
        };

        const studyLines = [
            "The man said,",
            "\t\t'Her bones and flesh!'",
            "\t\tShe shall be called 'woman',",
            "\t\tfor she was taken out of man.'",
        ];
        const bibleLines = [
            "Então, o homem disse:",
            "\t\t\"Esta, por fim, é osso dos meus ossos",
            "\t\te carne da minha carne! Ela será chamada 'mulher',",
            "\t\tporque do homem foi tirada\".",
        ];

        const studyXml = wrapStory(poetryVerse(studyLines));
        const bibleXml = wrapStory(poetryVerse(bibleLines));
        const idx = buildBibleVerseIndex(bibleXml);
        const entry = idx.get(verseKey("GEN", "2", "23"))!;
        expect(entry.segments.filter((s) => s.trim()).length).toBe(4);

        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.replacedCount).toBe(1);
        expect(xml).toContain("Então, o homem disse:");
        expect(xml).toContain("Esta, por fim");
        expect(xml).toContain("Ela será chamada");
        expect(xml).toContain("porque do homem foi tirada");
        expect(xml).not.toContain("The man said");
        expect(xml).not.toContain("Her bones");

        // Each poetry paragraph should still have prose (no empty ¶ slots).
        const q1Contents = [...xml.matchAll(/text%3aq1">[\s\S]*?<Content>([^<]*)<\/Content>/g)].map(
            (m) => m[1]
        );
        expect(q1Contents.length).toBe(3);
        expect(q1Contents.every((c) => c.trim().length > 0)).toBe(true);
    });

    it("uses paragraph-aligned mapping for multi-paragraph poetry (GEN 3:14 pattern)", () => {
        const poetryVerse14 = (lang: "en" | "pt") => {
            const intro =
                lang === "en"
                    ? "So the Lord God spoke to the snake. He said, 'Because you have done this,"
                    : "Então, o Senhor Deus declarou à serpente:";
            const q1a = lang === "en" ? "\t\t'You are set apart from all livestock" : "\t\t\"Por ter feito isso,";
            const q2a =
                lang === "en"
                    ? "\t\tand all wild animals."
                    : "\t\tmaldita é você entre todos os animais de rebanho";
            const q2b = lang === "en" ? "\t\tI am putting a curse on you." : "\t\te entre todos os animais do campo!";
            const q1b = lang === "en" ? "\t\tYou will crawl on your belly." : "\t\tVocê rastejará sobre o seu ventre";
            const q2c =
                lang === "en" ? "\t\tall the days of your life." : "\t\te comerá pó todos os dias da sua vida.";

            return (
                bookMarker("GEN") +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
                chapterMarkerCsr("3") +
                verseMarkerCsr("14") +
                noStyleCsr(intro) +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b_poetry">` +
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Br /></CharacterStyleRange>` +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
                noStyleCsr(q1a) +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
                noStyleCsr(q2a) +
                noStyleCsr(q2b) +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
                noStyleCsr(q1b) +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
                noStyleCsr(q2c) +
                verseMarkerCsr("14") +
                `</ParagraphStyleRange>`
            );
        };

        const studyXml = wrapStory(poetryVerse14("en"));
        const bibleXml = wrapStory(poetryVerse14("pt"));
        const idx = buildBibleVerseIndex(bibleXml);
        const entry = idx.get(verseKey("GEN", "3", "14"))!;
        expect(entry.paragraphSig).toContain("text:p");
        expect(entry.paragraphSig).toContain("text:q1");
        expect(entry.paragraphChunks.length).toBeGreaterThan(2);

        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);
        expect(stats.blockSwapCount).toBe(1);
        expect(xml).toContain("Então, o Senhor");
        expect(xml).toContain("maldita é você");
        expect(xml).toContain("Você rastejará");
        expect(xml).not.toContain("You are set apart");
        expect(xml).not.toContain("all wild animals");
    });

    it("uses Bible paragraph layout when Study alternates q1/q2 but Bible consolidates lines (GEN 8:22 pattern)", () => {
        const studyVerse22 =
            bookMarker("GEN") +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            chapterMarkerCsr("8") +
            verseMarkerCsr("21") +
            noStyleCsr("Verse twenty-one text.") +
            verseMarkerCsr("21") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b_poetry">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Br /></CharacterStyleRange>` +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
            verseMarkerCsr("22") +
            noStyleCsr("'As long as the earth lasts,") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
            noStyleCsr("\t\tthere will always be a time to plant") +
            noStyleCsr("\t\tand a time to gather the crops.") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
            noStyleCsr("\t\tAs long as the earth lasts,") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
            noStyleCsr("\t\tthere will always be cold and heat.") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
            noStyleCsr("\t\tThere will always be summer and winter,") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
            noStyleCsr("\t\tday and night.'") +
            verseMarkerCsr("22") +
            `</ParagraphStyleRange>`;

        const bibleVerse22 =
            bookMarker("GEN") +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            chapterMarkerCsr("8") +
            verseMarkerCsr("21") +
            noStyleCsr("Versículo vinte e um.") +
            verseMarkerCsr("21") +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b_poetry">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Br /></CharacterStyleRange>` +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
            verseMarkerCsr("22") +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
            `<Content>“Enquanto durar a terra,</Content><Br />` +
            `<Content>\t\tjamais cessarão</Content><Br />` +
            `<Content>\t\tplantio e colheita,</Content><Br />` +
            `<Content>\t\tfrio e calor,</Content><Br />` +
            `<Content>\t\tverão e inverno,</Content><Br />` +
            `<Content>\t\tdia e noite”.</Content>` +
            `</CharacterStyleRange>` +
            verseMarkerCsr("22") +
            `</ParagraphStyleRange>`;

        const studyXml = wrapStory(studyVerse22);
        const bibleXml = wrapStory(bibleVerse22);
        const idx = buildBibleVerseIndex(bibleXml);
        const entry = idx.get(verseKey("GEN", "8", "22"))!;
        expect(entry.paragraphChunks.length).toBeGreaterThanOrEqual(1);

        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);
        expect(stats.replacedCount).toBeGreaterThanOrEqual(1);
        expect(stats.blockSwapCount).toBeGreaterThanOrEqual(1);
        expect(xml).toContain("Enquanto durar a terra");
        expect(xml).toContain("jamais cessarão");
        expect(xml).toContain("plantio e colheita");
        expect(xml).not.toContain("As long as the earth lasts");
        expect(xml).not.toContain("there will always be cold");

        const q2Count = (xml.match(/text%3aq2/g) || []).length;
        expect(q2Count).toBe(0);
    });

    it("handles polluted meta:bk and still swaps verses", () => {
        const studyXml = wrapStory(
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
            `<Content>[PT] GEN</Content></CharacterStyleRange></ParagraphStyleRange>` +
            simpleVerseParagraph("text%3ap", "1", "1", "ENGLISH")
        );
        const bibleXml = wrapStory(
            bookMarker("GEN") + simpleVerseParagraph("text%3ap", "1", "1", "PORTUGUÊS")
        );
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.missingFromBible).toEqual([]);
        expect(stats.replacedCount).toBe(1);
        expect(xml).toContain("PORTUGUÊS");
        expect(xml).not.toContain("ENGLISH");
    });
});

describe("applyBibleSwapToStudyXml — PSA & extras", () => {
    it("does not modify PSA verses", () => {
        const studyXml = wrapStory(
            bookMarker("PSA") + simpleVerseParagraph("text%3ap", "1", "1", "Blessed")
        );
        const bibleXml = wrapStory(
            bookMarker("PSA") + simpleVerseParagraph("text%3ap", "1", "1", "Bem-aventurado")
        );
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.replacedCount).toBe(0);
        expect(stats.skippedPsa).toBeGreaterThan(0);
        expect(xml).toContain("Blessed");
        expect(xml).not.toContain("Bem-aventurado");
    });

    it("appends extra Bible verses at end of chapter", () => {
        const studyXml = wrapStory(
            bookMarker("GEN") +
            simpleVerseParagraph("text%3ap", "1", "1", "verse one")
        );
        const bibleXml = wrapStory(
            bookMarker("GEN") +
            simpleVerseParagraph("text%3ap", "1", "1", "TRANSLATED 1") +
            simpleVerseParagraph("text%3ap", null, "2", "EXTRA 2")
        );
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.extraInBibleAppended.length).toBe(1);
        expect(xml).toContain("EXTRA 2");
    });
});

describe("applyBibleSwapToStudyXml — intro preservation", () => {
    it("does not touch intro paragraphs", () => {
        const studyXml = wrapStory(
            bookMarker("GEN") +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">` +
            noStyleCsr("INTRO TEXT") +
            `</ParagraphStyleRange>` +
            simpleVerseParagraph("text%3ap", "1", "1", "REAL VERSE")
        );
        const bibleXml = wrapStory(
            bookMarker("GEN") + simpleVerseParagraph("text%3ap", "1", "1", "TRADUZIDO")
        );
        const idx = buildBibleVerseIndex(bibleXml);
        const { xml, stats } = applyBibleSwapToStudyXml(studyXml, idx);

        expect(stats.replacedCount).toBe(1);
        expect(xml).toContain("INTRO TEXT");
        expect(xml).toContain("TRADUZIDO");
        expect(xml).not.toContain("REAL VERSE");
    });
});
