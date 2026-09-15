/**
 * Proves the fast tag-scanner in `validatorHarness.ts` produces the same verse
 * map as the external validator's DOM walk. If this drifts, every conclusion
 * drawn from the harness is suspect.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { parseValidatorStory, type ValidatorStory } from "./validatorHarness";

const BIBLE_DIR =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Portuguese Full Bible";
/** Prose-heavy gospels plus poetry-heavy wisdom books. */
const SAMPLES = [
    path.join(BIBLE_DIR, "40MAT-43JHN_portuguese.idml"),
    path.join(BIBLE_DIR, "18JOB-22SNG_portuguese.idml"),
];

async function loadMainStory(idmlPath: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

function extractBookCode(rawText: string): string {
    if (!rawText) return "";
    const trimmed = rawText.replace(/\s+/g, " ").trim();
    const m = trimmed.match(/\b(?:[1-3][A-Z]{2}|[A-Z]{3})\b/);
    return m ? m[0] : trimmed;
}

/** Verbatim copy of the external app's DOM implementation. */
function parseStoryXmlWithDom(xmlText: string): ValidatorStory {
    const dom = new JSDOM("");
    const parser = new dom.window.DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const allPSRs = doc.getElementsByTagName("ParagraphStyleRange");
    let book: string | null = null;
    let chapter: string | null = null;
    let verse: string | null = null;
    let inVerse = false;
    let skipAtom = false;
    let atomText = "";
    let atomParaStyle = "";
    const verses: ValidatorStory["verses"] = {};

    for (let pi = 0; pi < allPSRs.length; pi++) {
        const psr = allPSRs[pi];
        const ps = (psr.getAttribute("AppliedParagraphStyle") || "").replace(
            "ParagraphStyle/",
            ""
        );
        const isPoetryQ1 = ps.includes("text%3aq1");
        const isPoetryQ2 = ps.includes("text%3aq2");
        const isPackedProse = ps.startsWith("text%3ap");
        const isIntro = ps.includes("intro%3a");
        let pendingCv: string | null = null;

        const openVerse = (vNum: string, psStyle: string): void => {
            if (!chapter) chapter = "1";
            verse = vNum;
            inVerse = true;
            const key = `${book}_${chapter}:${verse}`;
            skipAtom = Boolean(verses[key] && verses[key].text.trim());
            atomText = "";
            atomParaStyle = psStyle;
        };
        const closeVerse = (): void => {
            if (!skipAtom && verse && book && chapter && atomText.trim()) {
                verses[`${book}_${chapter}:${verse}`] = {
                    book: book!,
                    chapter: chapter!,
                    verse: verse!,
                    text: atomText,
                    paraStyle: atomParaStyle,
                    isSubheader: false,
                };
            }
            inVerse = false;
            atomText = "";
            skipAtom = false;
        };

        const csrs = psr.getElementsByTagName("CharacterStyleRange");
        for (let ci = 0; ci < csrs.length; ci++) {
            const csr = csrs[ci];
            if (csr.parentNode !== psr) continue;
            const cs = (csr.getAttribute("AppliedCharacterStyle") || "").replace(
                "CharacterStyle/",
                ""
            );
            let content = "";
            const contentEls = csr.getElementsByTagName("Content");
            for (let i = 0; i < contentEls.length; i++) {
                if (contentEls[i].parentNode === csr) {
                    content += contentEls[i].textContent || "";
                }
            }
            if (ps.includes("meta%3abk") && content.trim()) {
                book = extractBookCode(content);
                chapter = null;
                inVerse = false;
                skipAtom = false;
                atomText = "";
                pendingCv = null;
            }
            if (cs.includes("meta%3ac") && content.trim()) {
                chapter = content.trim().replace(/[^0-9]/g, "");
            }
            if (isPoetryQ1 && cs.startsWith("cv%3av") && content.trim()) pendingCv = content.trim();
            if (isPackedProse && cs.startsWith("cv%3av") && content.trim()) pendingCv = content.trim();
            if (cs.includes("meta%3av") && content.trim() && !isIntro) {
                const v = content.trim();
                if (isPackedProse) {
                    if (pendingCv) {
                        openVerse(pendingCv, ps);
                        pendingCv = null;
                    } else if (inVerse) closeVerse();
                    else openVerse(v, ps);
                } else if (isPoetryQ2) {
                    if (inVerse) closeVerse();
                } else if (isPoetryQ1 && pendingCv) {
                    openVerse(pendingCv, ps);
                    pendingCv = null;
                } else if (!inVerse) openVerse(v, ps);
                else closeVerse();
            }
            if (
                cs === "$ID/[No character style]" &&
                inVerse &&
                !skipAtom &&
                verse &&
                book &&
                chapter
            ) {
                atomText += content;
            }
        }
        if (ps.includes("head%3ad")) {
            for (const k in verses) {
                if (verses[k].paraStyle === ps) verses[k].isSubheader = true;
            }
        }
    }
    for (const k in verses) verses[k].text = verses[k].text.trim();
    const books = [...new Set(Object.values(verses).map((v) => v.book))].filter(Boolean);
    return { verses, books };
}

describe("validator harness fidelity", () => {
    for (const sample of SAMPLES) {
        it(`matches the DOM implementation verse-for-verse: ${path.basename(sample)}`, async () => {
            if (!fs.existsSync(sample)) return;
            const xml = await loadMainStory(sample);

            const fast = parseValidatorStory(xml);
            const dom = parseStoryXmlWithDom(xml);

            const fastKeys = Object.keys(fast.verses).sort();
            const domKeys = Object.keys(dom.verses).sort();
            expect(fastKeys).toEqual(domKeys);
            expect(fast.books).toEqual(dom.books);

            const mismatches = domKeys.filter(
                (k) =>
                    fast.verses[k].text !== dom.verses[k].text ||
                    fast.verses[k].isSubheader !== dom.verses[k].isSubheader ||
                    fast.verses[k].paraStyle !== dom.verses[k].paraStyle
            );
            expect(mismatches.slice(0, 10)).toEqual([]);
        }, 600000);
    }
});
