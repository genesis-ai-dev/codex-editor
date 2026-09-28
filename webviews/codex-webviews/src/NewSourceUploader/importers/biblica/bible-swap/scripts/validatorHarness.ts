/**
 * Faithful port of the external Biblica validation app's IDML verse reader and
 * issue classifier (`automated_app/public/index.html` → `parseStoryXML`,
 * `normalizeText`, `runAnalysis`).
 *
 * The swap code has its own verse indexer (`surgicalSwap.buildBibleVerseIndex`)
 * tuned for splicing. The validator reads verses differently, so a swap that
 * looks correct to our indexer can still be reported as broken. Reproducing the
 * validator here lets tests assert against the same numbers the report shows.
 *
 * Uses a tag scanner rather than a DOM so full 10 MB stories parse in ~1s.
 */

export interface ValidatorVerse {
    book: string;
    chapter: string;
    verse: string;
    text: string;
    paraStyle: string;
    isSubheader: boolean;
}

export interface ValidatorStory {
    verses: Record<string, ValidatorVerse>;
    books: string[];
}

export type ValidatorStatus =
    | "correct"
    | "unchanged"
    | "wrong-text"
    | "missing-export"
    | "not-removed"
    | "not-added"
    | "removed-ok"
    | "added-ok"
    | "added-wrong"
    | "extra-export"
    | "subheader-skipped";

export interface ValidatorResult {
    key: string;
    book: string;
    chapter: string;
    verse: string;
    status: ValidatorStatus;
    detail: string;
    studyText: string | null;
    bibleText: string | null;
    exportText: string | null;
}

export interface ValidatorAnalysis {
    results: ValidatorResult[];
    issues: ValidatorResult[];
    scorePercent: number;
    issueCount: number;
    verseCounts: { study: number; bible: number; export: number };
}

export const VALIDATOR_ISSUE_STATUSES: readonly ValidatorStatus[] = [
    "unchanged",
    "wrong-text",
    "missing-export",
    "not-removed",
    "not-added",
    "extra-export",
    "added-wrong",
];

export const VALIDATOR_STATUS_LABELS: Record<ValidatorStatus, string> = {
    correct: "Correctly Swapped",
    unchanged: "Unchanged (English)",
    "wrong-text": "Wrong Text",
    "missing-export": "Missing from Export",
    "not-removed": "Should Be Removed",
    "not-added": "Should Be Added",
    "removed-ok": "Correctly Removed",
    "added-ok": "Correctly Added",
    "added-wrong": "Added (Wrong Text)",
    "extra-export": "Extra in Export",
    "subheader-skipped": "Subheader Skipped",
};

// ---------------------------------------------------------------------------
// XML scanning
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

function decodeXmlText(raw: string): string {
    if (!raw.includes("&")) return raw;
    return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body.startsWith("#x") || body.startsWith("#X")) {
            const code = parseInt(body.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        if (body.startsWith("#")) {
            const code = parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[body] ?? whole;
    });
}

function readAttribute(attrs: string, name: string): string {
    const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`);
    const m = attrs.match(re);
    return m ? decodeXmlText(m[1]) : "";
}

/** `Genesis GEN` → `GEN`; falls back to the collapsed text. */
function extractBookCode(rawText: string): string {
    if (!rawText) return "";
    const trimmed = rawText.replace(/\s+/g, " ").trim();
    const m = trimmed.match(/\b(?:[1-3][A-Z]{2}|[A-Z]{3})\b/);
    return m ? m[0] : trimmed;
}

interface TagEvent {
    kind: "start" | "end" | "text";
    name: string;
    attrs: string;
    selfClosing: boolean;
    text: string;
}

/**
 * Streams start/end/text events. Skips prologs, comments, doctypes and CDATA
 * markers (CDATA payload is emitted as text).
 */
function* scanXml(xml: string): Generator<TagEvent> {
    let i = 0;
    const len = xml.length;
    while (i < len) {
        const lt = xml.indexOf("<", i);
        if (lt === -1) {
            if (i < len) yield { kind: "text", name: "", attrs: "", selfClosing: false, text: xml.slice(i) };
            return;
        }
        if (lt > i) {
            yield { kind: "text", name: "", attrs: "", selfClosing: false, text: xml.slice(i, lt) };
        }

        if (xml.startsWith("<!--", lt)) {
            const end = xml.indexOf("-->", lt + 4);
            i = end === -1 ? len : end + 3;
            continue;
        }
        if (xml.startsWith("<![CDATA[", lt)) {
            const end = xml.indexOf("]]>", lt + 9);
            const stop = end === -1 ? len : end;
            yield {
                kind: "text",
                name: "",
                attrs: "",
                selfClosing: false,
                text: xml.slice(lt + 9, stop),
            };
            i = end === -1 ? len : end + 3;
            continue;
        }
        if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
            const end = xml.indexOf(">", lt + 2);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // Find the tag's closing `>`, ignoring `>` inside quoted attribute values.
        let j = lt + 1;
        let quote = "";
        while (j < len) {
            const c = xml[j];
            if (quote) {
                if (c === quote) quote = "";
            } else if (c === '"' || c === "'") {
                quote = c;
            } else if (c === ">") {
                break;
            }
            j++;
        }
        if (j >= len) return;

        const inner = xml.slice(lt + 1, j);
        const isEnd = inner.startsWith("/");
        const body = isEnd ? inner.slice(1) : inner;
        const selfClosing = !isEnd && body.endsWith("/");
        const cleaned = selfClosing ? body.slice(0, -1) : body;
        const nameMatch = cleaned.match(/^([^\s/>]+)/);
        const name = nameMatch ? nameMatch[1] : "";
        const attrs = nameMatch ? cleaned.slice(nameMatch[1].length) : "";

        yield {
            kind: isEnd ? "end" : "start",
            name,
            attrs,
            selfClosing,
            text: "",
        };
        i = j + 1;
    }
}

interface ParagraphRecord {
    ps: string;
    ranges: Array<{ cs: string; content: string }>;
}

/**
 * Collects paragraphs in the same order and shape `getElementsByTagName` yields
 * them: every `ParagraphStyleRange` in start-tag order (including ones nested
 * inside footnotes), each holding only its direct-child `CharacterStyleRange`s.
 */
function collectParagraphRecords(xml: string): ParagraphRecord[] {
    const records: ParagraphRecord[] = [];
    const psrStack: Array<{ depth: number; rec: ParagraphRecord }> = [];
    // A footnote nests a paragraph (and its ranges) inside an outer range, so
    // several ranges can be open at once.
    const csrStack: Array<{
        depth: number;
        rec: ParagraphRecord;
        cs: string;
        content: string;
    }> = [];

    let depth = 0;
    let contentDepth = -1;

    const topPsr = () => (psrStack.length > 0 ? psrStack[psrStack.length - 1] : null);
    const topCsr = () => (csrStack.length > 0 ? csrStack[csrStack.length - 1] : null);

    for (const ev of scanXml(xml)) {
        if (ev.kind === "text") {
            if (contentDepth !== -1) {
                const csr = topCsr();
                if (csr) csr.content += decodeXmlText(ev.text);
            }
            continue;
        }

        if (ev.kind === "start") {
            depth++;
            if (ev.name === "ParagraphStyleRange") {
                const rec: ParagraphRecord = {
                    ps: readAttribute(ev.attrs, "AppliedParagraphStyle").replace(
                        "ParagraphStyle/",
                        ""
                    ),
                    ranges: [],
                };
                records.push(rec);
                psrStack.push({ depth, rec });
            } else if (
                ev.name === "CharacterStyleRange" &&
                topPsr()?.depth === depth - 1
            ) {
                csrStack.push({
                    depth,
                    rec: topPsr()!.rec,
                    cs: readAttribute(ev.attrs, "AppliedCharacterStyle").replace(
                        "CharacterStyle/",
                        ""
                    ),
                    content: "",
                });
            } else if (ev.name === "Content" && topCsr()?.depth === depth - 1) {
                contentDepth = depth;
            }

            if (!ev.selfClosing) continue;
        }

        if (contentDepth === depth) contentDepth = -1;
        if (topCsr()?.depth === depth) {
            const csr = csrStack.pop()!;
            csr.rec.ranges.push({ cs: csr.cs, content: csr.content });
        }
        if (topPsr()?.depth === depth) psrStack.pop();
        depth--;
    }

    return records;
}

/**
 * Builds the validator's verse map: `{BOOK}_{chapter}:{verse}` → verse record.
 * Mirrors the DOM walk, including its quirks: poetry `cv:v` lead-ins, packed
 * prose handling, no flush of a still-open verse at end of story, and footnote
 * paragraphs bleeding their text into whichever verse is open.
 */
export function parseValidatorStory(xml: string): ValidatorStory {
    const verses: Record<string, ValidatorVerse> = {};

    let book: string | null = null;
    let chapter: string | null = null;
    let verse: string | null = null;
    let inVerse = false;
    let skipAtom = false;
    let atomText = "";
    let atomParaStyle = "";

    // Paragraph-scoped state
    let ps = "";
    let isPoetryQ1 = false;
    let isPoetryQ2 = false;
    let isPackedProse = false;
    let isIntro = false;
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
                book,
                chapter,
                verse,
                text: atomText,
                paraStyle: atomParaStyle,
                isSubheader: false,
            };
        }
        inVerse = false;
        atomText = "";
        skipAtom = false;
    };

    const handleCharacterRange = (cs: string, content: string): void => {
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
                } else if (inVerse) {
                    closeVerse();
                } else {
                    openVerse(v, ps);
                }
            } else if (isPoetryQ2) {
                if (inVerse) closeVerse();
            } else if (isPoetryQ1 && pendingCv) {
                openVerse(pendingCv, ps);
                pendingCv = null;
            } else if (!inVerse) {
                openVerse(v, ps);
            } else {
                closeVerse();
            }
        }
        if (cs === "$ID/[No character style]" && inVerse && !skipAtom && verse && book && chapter) {
            atomText += content;
        }
    };

    for (const record of collectParagraphRecords(xml)) {
        ps = record.ps;
        isPoetryQ1 = ps.includes("text%3aq1");
        isPoetryQ2 = ps.includes("text%3aq2");
        isPackedProse = ps.startsWith("text%3ap");
        isIntro = ps.includes("intro%3a");
        pendingCv = null;

        for (const range of record.ranges) {
            handleCharacterRange(range.cs, range.content);
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

export function normalizeValidatorText(t: string | null | undefined): string {
    if (!t) return "";
    return t.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function runValidatorAnalysis(
    study: ValidatorStory,
    bible: ValidatorStory,
    exported: ValidatorStory
): ValidatorAnalysis {
    const S = study.verses;
    const B = bible.verses;
    const E = exported.verses;
    const allKeys = new Set([...Object.keys(S), ...Object.keys(B), ...Object.keys(E)]);
    const results: ValidatorResult[] = [];
    let correct = 0;
    let removedCorrectly = 0;
    let addedCorrectly = 0;

    for (const key of allKeys) {
        const s = S[key] ?? null;
        const b = B[key] ?? null;
        const e = E[key] ?? null;
        const parts = key.split("_");
        const book = parts[0];
        const [ch, v] = parts.slice(1).join("_").split(":");
        let status: ValidatorStatus;
        let detail: string;

        if (s && b && e) {
            if (b.isSubheader) {
                status = "subheader-skipped";
                detail = "Bible verse is subheader";
            } else {
                const en = normalizeValidatorText(e.text);
                const bn = normalizeValidatorText(b.text);
                const sn = normalizeValidatorText(s.text);
                if (en === bn) {
                    status = "correct";
                    correct++;
                    detail = "Bible text correctly swapped";
                } else if (en === sn) {
                    status = "unchanged";
                    detail = "Still has original English text";
                } else {
                    status = "wrong-text";
                    detail = "Text differs from both source and Bible";
                }
            }
        } else if (s && !b && e) {
            if (normalizeValidatorText(e.text) === normalizeValidatorText(s.text)) {
                status = "not-removed";
                detail = "Should have been removed (no Bible counterpart) but still present";
            } else {
                status = "wrong-text";
                detail = "Modified but Bible has no counterpart";
            }
        } else if (s && !b && !e) {
            status = "removed-ok";
            removedCorrectly++;
            detail = "Correctly removed (no Bible counterpart)";
        } else if (!s && b && e) {
            if (b.isSubheader) {
                status = "subheader-skipped";
                detail = "Subheader correctly not added";
            } else if (
                normalizeValidatorText(e.text) !== normalizeValidatorText(b.text)
            ) {
                status = "added-wrong";
                detail = "Added but text doesn't match Bible";
            } else {
                status = "added-ok";
                addedCorrectly++;
                detail = "Correctly added (Bible-only verse)";
            }
        } else if (!s && b && !e) {
            if (b.isSubheader) {
                status = "subheader-skipped";
                detail = "Subheader correctly skipped";
            } else {
                status = "not-added";
                detail = "Bible has this verse but it was NOT added to export";
            }
        } else if (s && b && !e) {
            status = "missing-export";
            detail = "Present in Study and Bible but MISSING from export";
        } else if (!s && !b && e) {
            status = "extra-export";
            detail = "Only in export (unexpected)";
        } else {
            continue;
        }

        results.push({
            key,
            book,
            chapter: ch,
            verse: v,
            status,
            detail,
            studyText: s ? s.text : null,
            bibleText: b ? b.text : null,
            exportText: e ? e.text : null,
        });
    }

    const bookOrder = study.books;
    results.sort((a, b) => {
        const ai = bookOrder.indexOf(a.book);
        const bi = bookOrder.indexOf(b.book);
        if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        if (parseInt(a.chapter, 10) !== parseInt(b.chapter, 10)) {
            return parseInt(a.chapter, 10) - parseInt(b.chapter, 10);
        }
        return parseInt(a.verse, 10) - parseInt(b.verse, 10);
    });

    const total = results.filter((r) => !r.status.startsWith("subheader")).length;
    const issues = results.filter((r) =>
        VALIDATOR_ISSUE_STATUSES.includes(r.status)
    );

    return {
        results,
        issues,
        scorePercent:
            total > 0
                ? Math.round(((correct + removedCorrectly + addedCorrectly) / total) * 100)
                : 0,
        issueCount: issues.length,
        verseCounts: {
            study: Object.keys(S).length,
            bible: Object.keys(B).length,
            export: Object.keys(E).length,
        },
    };
}

/** `### ACT 8:1` + `- Wrong Text: …`, matching the report's issue lines. */
export function formatValidatorIssues(analysis: ValidatorAnalysis): string {
    return analysis.issues
        .map(
            (r) =>
                `${r.book} ${r.chapter}:${r.verse} — ${VALIDATOR_STATUS_LABELS[r.status]}`
        )
        .join("\n");
}
