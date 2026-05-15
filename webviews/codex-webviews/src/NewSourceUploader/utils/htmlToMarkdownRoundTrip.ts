import TurndownService from "turndown";

let turndown: TurndownService | undefined;

function getTurndown(): TurndownService {
    if (!turndown) {
        turndown = new TurndownService({
            headingStyle: "atx",
            hr: "---",
            // Match common source markdown (`*` bullets) for round-trip fidelity
            bulletListMarker: "*",
            codeBlockStyle: "fenced",
            emDelimiter: "*",
            strongDelimiter: "**",
            br: "  ",
        });
    }
    return turndown;
}

/**
 * Turndown escapes `N. ` at the start of heading inner text as `N\. ` so it is not parsed as
 * an ordered list. In ATX headings (`# …`) that is unnecessary and breaks headings like `# 1. Title`.
 */
export function normalizeExportedMarkdown(md: string): string {
    return md.replace(/^(#{1,6})\s+(\d+)\\\.\s+/gm, "$1 $2. ");
}

/**
 * Heal missing blank line before a list when a sentence ends with `).` and the next `-` / `*`
 * list marker was glued on (common when HTML lost block boundaries).
 */
export function normalizeListBoundaryAfterClosingParen(md: string): string {
    // `...email).-   **OUT**` → insert blank line before the list marker
    return md.replace(/\)(\.\s*)\s*([-*+])\s*(\*\*)/g, ")$1\n\n$2   $3");
}

function stripHtmlFallback(html: string): string {
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim();
}

/**
 * Converts translated cell HTML (Quill / Codex editor) into Markdown for round-trip export.
 * Preserves common inline styles (bold, italic, links, code) instead of flattening to plain text.
 */
export function htmlTranslationToMarkdownForRoundTrip(html: string): string {
    const raw = (html ?? "").trim();
    if (!raw) {
        return "";
    }
    if (!/<[a-z][\s\S]*>/i.test(raw)) {
        return raw;
    }
    try {
        const md = normalizeListBoundaryAfterClosingParen(
            normalizeExportedMarkdown(
                getTurndown()
                    .turndown(raw)
                    .replace(/\n+$/g, "")
                    .trim()
            )
        );
        return md || stripHtmlFallback(raw);
    } catch {
        return stripHtmlFallback(raw);
    }
}
