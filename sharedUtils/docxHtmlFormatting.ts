import { matchFullWrapper, peelWrapperChain } from "./htmlWrapperUtils";

export interface HtmlStructureOptions {
    importerType?: string;
    corpusMarker?: string;
}

export const isDocxFormattingContext = (options?: HtmlStructureOptions): boolean =>
    options?.importerType === "docx" ||
    (!options?.importerType && options?.corpusMarker === "docx");

const SIMPLE_FORMAT = /^<(?:u|strong|em|b|i|s|sup|sub)>$/i;
const WRAPPER = /^<(?:p|span|u|strong|em|b|i|s|sup|sub)\b/i;

/** Only quoted, well-formed attributes are eligible for deterministic repair. */
function attributes(openTag: string): Map<string, string> | null {
    const rest = openTag.replace(/^<[\w]+/, "").replace(/>$/, "");
    const result = new Map<string, string>();
    const attribute = /\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/gy;
    let cursor = 0;
    while (cursor < rest.length) {
        if (!rest.slice(cursor).trim()) break;
        attribute.lastIndex = cursor;
        const match = attribute.exec(rest);
        if (!match) return null;
        const name = match[1].toLowerCase();
        if (result.has(name)) return null;
        result.set(name, match[2].slice(1, -1));
        cursor = attribute.lastIndex;
    }
    return result;
}

/**
 * Legacy Word imports stored arbitrary run boundaries, sometimes mid-word.
 * Collapse only uniformly styled spans covering a whole paragraph. Keep every
 * inter-span character; never coalesce semantic spans or mixed formatting.
 */
export function collapseAdjacentEquivalentStyledSpans(html: string): string {
    const paragraph = matchFullWrapper(html);
    if (!paragraph || paragraph.tagName !== "p") return html;
    const span = /(<span\b[^>]*>)([\s\S]*?)<\/span>/giy;
    let cursor = 0;
    let count = 0;
    let firstOpen = "";
    let firstFormatting = "";
    let firstClosing = "";
    let text = "";
    while (cursor < paragraph.inner.length) {
        const gap = /^\s*/.exec(paragraph.inner.slice(cursor))![0];
        text += gap;
        cursor += gap.length;
        if (cursor === paragraph.inner.length) break;
        span.lastIndex = cursor;
        const match = span.exec(paragraph.inner);
        if (!match) return html;
        const attrs = attributes(match[1]);
        if (!attrs || attrs.size !== 1 || !attrs.has("style")) return html;
        const formatting = peelWrapperChain(match[2], (tag) => SIMPLE_FORMAT.test(tag));
        if (/<[^>]*>/.test(formatting.inner)) return html;
        const open = formatting.openTags.join("");
        const close = formatting.closeTags.join("");
        if (count && (match[1] !== firstOpen || open !== firstFormatting || close !== firstClosing)) {
            return html;
        }
        firstOpen = match[1];
        firstFormatting = open;
        firstClosing = close;
        text += formatting.inner;
        count++;
        cursor = span.lastIndex;
    }
    if (count < 2) return html;
    return `${paragraph.openTag}${firstOpen}${firstFormatting}${text}${firstClosing}</span></p>`;
}

// These are the presentation properties emitted by the DOCX importer. Never
// copy arbitrary CSS, links, language/direction, or semantic data attributes.
const PRESENTATION_PROPERTIES = new Set([
    "font-family", "font-size", "color", "background-color", "text-align",
    "margin-left", "margin-right", "margin-top", "margin-bottom", "text-indent", "line-height",
]);
const ALL_PRESENTATION_CONTROLS = [
    ...PRESENTATION_PROPERTIES, "font-weight", "font-style", "text-decoration", "vertical-align",
];

function styles(value: string): Map<string, string> | null {
    const result = new Map<string, string>();
    for (const declaration of value.split(";")) {
        if (!declaration.trim()) continue;
        const match = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(declaration);
        if (!match) return null;
        result.set(match[1].toLowerCase(), match[2]);
    }
    return result;
}

const escapeAttribute = (value: string): string => value.replace(/"/g, "&quot;");

function presentationControls(attrs: Map<string, string>): Set<string> {
    const controls = new Set(styles(attrs.get("style") ?? "")?.keys());
    if (controls.has("font")) {
        ["font-family", "font-size", "font-weight", "font-style", "line-height"].forEach((key) => controls.add(key));
    }
    if (controls.has("margin")) {
        ["margin-left", "margin-right", "margin-top", "margin-bottom"].forEach((key) => controls.add(key));
    }
    if (controls.has("background")) controls.add("background-color");
    if (controls.has("text-decoration-line")) controls.add("text-decoration");
    if (attrs.has("align") || attrs.has("data-alignment")) controls.add("text-align");
    if (controls.has("all")) {
        ALL_PRESENTATION_CONTROLS.forEach((key) => controls.add(key));
    }
    if (attrs.has("dir") || attrs.has("lang")) {
        PRESENTATION_PROPERTIES.forEach((key) => controls.add(key));
    }
    for (const token of (attrs.get("class") ?? "").split(/\s+/).filter(Boolean)) {
        if (token.startsWith("ql-align-")) controls.add("text-align");
        else if (token.startsWith("ql-font-")) controls.add("font-family");
        else if (token.startsWith("ql-size-")) controls.add("font-size");
        else ALL_PRESENTATION_CONTROLS.forEach((key) => controls.add(key));
    }
    return controls;
}

/** Add missing source defaults without replacing any existing target attribute. */
function restoreOpeningTag(sourceTag: string, targetTag: string, ancestorControls: Set<string>): string | null {
    const source = attributes(sourceTag);
    const target = attributes(targetTag);
    if (!source || !target) return null;
    if ([...source.keys()].some((key) => !["style", "data-style-id", "data-alignment"].includes(key))) {
        return null;
    }
    let result = targetTag;
    const additions: string[] = [];
    const controls = new Set([...ancestorControls, ...presentationControls(target)]);
    const targetStyles = styles(target.get("style") ?? "");
    const sourceStyles = styles(source.get("style") ?? "");
    if (!targetStyles || !sourceStyles) return null;
    const missing: string[] = [];
    for (const [key, value] of sourceStyles) {
        if (!PRESENTATION_PROPERTIES.has(key) || /[<>\\()]/.test(value)) return null;
        if (!controls.has(key)) missing.push(`${key}: ${value}`);
    }
    if (missing.length) {
        const value = [target.get("style")?.replace(/;\s*$/, ""), ...missing].filter(Boolean).join("; ");
        if (target.has("style")) {
            result = result.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, () => ` style="${escapeAttribute(value)}"`);
        } else {
            additions.push(`style="${escapeAttribute(value)}"`);
        }
    }
    for (const key of ["data-style-id", "data-alignment"]) {
        if (!source.has(key) || target.has(key)) continue;
        if (key === "data-alignment" && controls.has("text-align")) continue;
        additions.push(`${key}="${escapeAttribute(source.get(key)!)}"`);
    }
    return additions.length ? result.replace(/>$/, () => ` ${additions.join(" ")}>`) : result;
}

/**
 * Propose a DOCX-only repair. The caller must still verify structure equality.
 * Only full-coverage presentation wrappers can be inserted. Existing target
 * wrappers and innermost HTML (including links and whitespace) stay intact.
 */
export function restoreDocxFormatting(sourceHtml: string, targetHtml: string): string | null {
    const source = peelWrapperChain(collapseAdjacentEquivalentStyledSpans(sourceHtml), (tag) => WRAPPER.test(tag));
    const target = peelWrapperChain(targetHtml, (tag) => WRAPPER.test(tag));
    if (!source.openTags.length || !target.inner.trim()) return null;
    const tagName = (tag: string) => /^<(\w+)/.exec(tag)![1].toLowerCase();
    const openTags: string[] = [];
    const ancestorControls = new Set<string>();
    let targetIndex = 0;
    for (const sourceTag of source.openTags) {
        const name = tagName(sourceTag);
        const targetTag = target.openTags[targetIndex];
        const matching = targetTag !== undefined && tagName(targetTag) === name;
        if (!matching && /<[^>]*>/.test(source.inner)) return null;
        const emphasisProperty: Record<string, string> = {
            strong: "font-weight", b: "font-weight", em: "font-style", i: "font-style",
            u: "text-decoration", s: "text-decoration", sup: "vertical-align", sub: "vertical-align",
        };
        if (!matching && ancestorControls.has(emphasisProperty[name])) return null;
        const restored = restoreOpeningTag(sourceTag, matching ? targetTag : `<${name}>`, ancestorControls);
        if (restored === null) return null;
        openTags.push(restored);
        if (matching) {
            presentationControls(attributes(targetTag)!).forEach((key) => ancestorControls.add(key));
            targetIndex++;
        }
    }
    if (targetIndex !== target.openTags.length) return null;
    const closing = [...openTags].reverse().map((tag) => `</${tagName(tag)}>`).join("");
    const restored = openTags.join("") + target.inner + closing;
    if (restored.replace(/<[^>]*>/g, "") !== targetHtml.replace(/<[^>]*>/g, "")) return null;
    return restored === targetHtml ? null : restored;
}
