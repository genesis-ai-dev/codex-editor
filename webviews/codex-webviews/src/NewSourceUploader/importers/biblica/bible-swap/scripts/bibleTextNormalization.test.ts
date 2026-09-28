import { describe, it, expect } from "vitest";
import { normalizeBibleStoryXmlGlyphs } from "../bibleTextNormalization";

const NO_STYLE = 'CharacterStyle/$ID/[No character style]';
const content = (text: string) =>
    `<CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>`;

describe("normalizeBibleStoryXmlGlyphs", () => {
    it("replaces the quotation dash with an em dash in Bible text", () => {
        const xml = content("\u2015Vinde a mim\u2015 disse Jesus.");
        expect(normalizeBibleStoryXmlGlyphs(xml)).toBe(
            content("\u2014Vinde a mim\u2014 disse Jesus.")
        );
    });

    it("leaves the other long dashes alone", () => {
        const xml = content("Gênesis 1:1 \u2013 2:25 \u2014 uma introdu\u00e7\u00e3o");
        expect(normalizeBibleStoryXmlGlyphs(xml)).toBe(xml);
    });

    it("returns the input untouched when no quotation dash is present", () => {
        const xml = content("No princ\u00edpio Deus criou os c\u00e9us e a terra.");
        expect(normalizeBibleStoryXmlGlyphs(xml)).toBe(xml);
    });

    it("never rewrites markup outside Content", () => {
        const xml =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text\u2015odd">` +
            content("\u2015 fala") +
            `</ParagraphStyleRange>`;
        const result = normalizeBibleStoryXmlGlyphs(xml);
        expect(result).toContain('ParagraphStyle/text\u2015odd');
        expect(result).toContain("<Content>\u2014 fala</Content>");
    });

    it("is idempotent", () => {
        const once = normalizeBibleStoryXmlGlyphs(content("\u2015 fala"));
        expect(normalizeBibleStoryXmlGlyphs(once)).toBe(once);
    });
});
