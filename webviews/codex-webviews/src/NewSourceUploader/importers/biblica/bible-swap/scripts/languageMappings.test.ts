/**
 * Language mappings: deserialization of shipped versification mapping files
 * back into the runtime VersificationPlan, plus per-language strategies.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    ANY_BIBLE_SWAP_LANGUAGE,
    BIBLE_SWAP_LANGUAGES,
    deserializeVersificationPlan,
    getBibleSwapLanguageStrategy,
    isMappedBibleSwapLanguage,
    isUsableMappingPlan,
    resolveSwapModeForLanguage,
    studyVolumeFromFileName,
    type BibleSwapMappingDocument,
} from "../language-mappings";
import { chapterBlockKey, verseKey } from "../types";

const mappingsRoot = path.join(__dirname, "..", "language-mappings");

function loadMapping(language: string, volume: string): BibleSwapMappingDocument {
    const file = path.join(mappingsRoot, language, `${volume}.mapping.json`);
    return JSON.parse(fs.readFileSync(file, "utf-8")) as BibleSwapMappingDocument;
}

describe("language registry", () => {
    it("offers Any plus all mapped languages", () => {
        const ids = BIBLE_SWAP_LANGUAGES.map((l) => l.id);
        expect(ids).toEqual([
            ANY_BIBLE_SWAP_LANGUAGE,
            "portuguese",
            "russian",
            "french",
            "hindi",
            "marathi",
            "ukrainian",
        ]);
        expect(isMappedBibleSwapLanguage("french")).toBe(true);
        expect(isMappedBibleSwapLanguage("hindi")).toBe(true);
        expect(isMappedBibleSwapLanguage("marathi")).toBe(true);
        expect(isMappedBibleSwapLanguage("ukrainian")).toBe(true);
        expect(isMappedBibleSwapLanguage(ANY_BIBLE_SWAP_LANGUAGE)).toBe(false);
    });

    it("derives study volume from file names", () => {
        expect(studyVolumeFromFileName("JOS-EST.idml")).toBe("JOS-EST");
        expect(studyVolumeFromFileName("jos-est.codex")).toBe("JOS-EST");
        expect(studyVolumeFromFileName("C:\\files\\MAT-JOHN.idml")).toBe("MAT-JOHN");
    });
});

describe("per-language strategies", () => {
    it("forces Structure on Russian JOB-SNG and French/Hindi/Marathi ACT-REV", () => {
        expect(
            resolveSwapModeForLanguage(
                getBibleSwapLanguageStrategy("russian"),
                "JOB-SNG",
                "surgical"
            )
        ).toBe("structure");
        expect(
            resolveSwapModeForLanguage(
                getBibleSwapLanguageStrategy("french"),
                "ACT-REV",
                "surgical"
            )
        ).toBe("structure");
        expect(
            resolveSwapModeForLanguage(
                getBibleSwapLanguageStrategy("hindi"),
                "ACT-REV",
                "surgical"
            )
        ).toBe("structure");
        expect(
            resolveSwapModeForLanguage(
                getBibleSwapLanguageStrategy("marathi"),
                "JOB-SNG",
                "surgical"
            )
        ).toBe("structure");
        expect(
            resolveSwapModeForLanguage(
                getBibleSwapLanguageStrategy("portuguese"),
                "JOS-EST",
                "surgical"
            )
        ).toBe("surgical");
    });

    it("rejects Ukrainian NT mappings as unusable (0% projected match)", () => {
        const strategy = getBibleSwapLanguageStrategy("ukrainian");
        const doc = loadMapping("ukrainian", "ACT-REV");
        expect(
            isUsableMappingPlan(
                strategy,
                "ACT-REV",
                doc.plan,
                doc.versificationSummary?.projectedVerseMatchPercent
            )
        ).toBe(false);
    });

    it("accepts Portuguese JOS-EST mapping as usable", () => {
        const strategy = getBibleSwapLanguageStrategy("portuguese");
        const doc = loadMapping("portuguese", "JOS-EST");
        expect(
            isUsableMappingPlan(
                strategy,
                "JOS-EST",
                doc.plan,
                doc.versificationSummary?.projectedVerseMatchPercent
            )
        ).toBe(true);
    });
});

describe("mapping files on disk", () => {
    it("has mapping JSON for every strategy availableVolume", () => {
        for (const lang of BIBLE_SWAP_LANGUAGES.filter((l) => l.hasMappings)) {
            const strategy = getBibleSwapLanguageStrategy(lang.id);
            for (const volume of strategy.availableVolumes) {
                const file = path.join(mappingsRoot, lang.id, `${volume}.mapping.json`);
                expect(fs.existsSync(file), `${lang.id}/${volume}`).toBe(true);
            }
        }
    });
});

describe("deserializeVersificationPlan (portuguese JOS-EST)", () => {
    const doc = loadMapping("portuguese", "JOS-EST");
    const plan = deserializeVersificationPlan(doc.plan);

    it("rebuilds the verse map with the same entry count", () => {
        expect(plan.verseMap.size).toBe(doc.plan.verseMappings.length);
        const first = plan.verseMap.get(verseKey("1CH", "1", "1"));
        expect(first).toEqual({
            action: "replace",
            bible: { book: "1CH", chapter: "1", verse: "1" },
        });
    });

    it("rebuilds chapter inserts (RUT 4:22 bible-only verse)", () => {
        const rut4 = plan.chapterInserts.get(chapterBlockKey("RUT", "4"));
        expect(rut4).toBeDefined();
        expect(rut4).toContainEqual({ book: "RUT", chapter: "4", verse: "22" });
    });

    it("rebuilds structure chapters keyed by book|chapter", () => {
        expect(plan.structureChapters.size).toBe(doc.plan.structureChapters.length);
        const jos1 = plan.structureChapters.get(chapterBlockKey("JOS", "1"));
        expect(jos1).toMatchObject({
            studyBook: "JOS",
            studyChapter: "1",
            insertOnly: false,
        });
    });
});

describe("deserializeVersificationPlan (french JOB-SNG sample)", () => {
    it("loads french JOB-SNG plan with inserts", () => {
        const doc = loadMapping("french", "JOB-SNG");
        const plan = deserializeVersificationPlan(doc.plan);
        expect(plan.verseMap.size).toBe(doc.plan.verseMappings.length);
        expect(plan.stats.versesInserted).toBeGreaterThan(0);
    });
});
