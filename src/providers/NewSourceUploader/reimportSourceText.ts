import type { ReimportCell } from "./reimportMerge";
import { extractPlainTextFromHtml } from "../../../sharedUtils/htmlStructureUtils";

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

/** DOCX inline runs can split words; only block/line boundaries introduce spaces. */
function docxHtmlText(html: string): string {
    const entities: Record<string, string> = {
        amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    };
    return normalizeWhitespace(html
        .replace(/<(?:br\b[^>]*|\/(?:p|div|li|td|th|tr|h[1-6]))\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
            if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? entity;
            const hex = code[1].toLowerCase() === "x";
            const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
            return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
                ? String.fromCodePoint(point) : entity;
        }));
}

export function getReimportSourceText(cell: ReimportCell, docx: boolean): string {
    // Read current source content, not potentially stale originalText metadata:
    // user source corrections must still affect which translations can match.
    return docx ? docxHtmlText(cell.value ?? "") : extractPlainTextFromHtml(cell.value ?? "");
}
