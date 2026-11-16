import type { PinDecisions } from "./pinDecisions";
import { EXTENSION_PIN_POLICY } from "./extensionPinFeatureFlag";

interface Token { text: string; start: number; end: number; }
interface Property { key: string; valueStart: number; valueEnd: number; }

/** Skip a complete JSON value. The input has already passed JSON.parse. */
function valueEnd(tokens: Token[], start: number): number {
    if (tokens[start].text !== "{" && tokens[start].text !== "[") { return start + 1; }
    let depth = 0;
    for (let index = start; index < tokens.length; index++) {
        const text = tokens[index].text;
        if (text === "{" || text === "[") { depth++; }
        if (text === "}" || text === "]") { depth--; }
        if (depth === 0) { return index + 1; }
    }
    throw new Error("Unterminated metadata JSON value");
}

function properties(tokens: Token[], start: number): Property[] {
    const result: Property[] = [];
    let index = start + 1;
    while (tokens[index].text !== "}") {
        const key: string = JSON.parse(tokens[index].text);
        const valueStart = index + 2;
        const end = valueEnd(tokens, valueStart);
        result.push({ key, valueStart, valueEnd: end });
        index = tokens[end].text === "," ? end + 1 : end;
    }
    return result;
}

function findProperty(entries: Property[], key: string): Property | undefined {
    const matches = entries.filter(entry => entry.key === key);
    if (matches.length > 1) { throw new Error(`Cannot safely edit duplicate metadata key: ${key}`); }
    return matches[0];
}

function lineIndent(content: string, offset: number): string {
    return /^[\t ]*/.exec(content.slice(content.lastIndexOf("\n", offset - 1) + 1, offset))![0];
}

function formatValue(content: string, value: unknown, indent: string): string {
    if (!content.includes("\n")) { return JSON.stringify(value); }
    const indents = Array.from(content.matchAll(/^[\t ]+(?=")/gm), match => match[0]);
    const unit = indents.sort((a, b) => a.length - b.length)[0] || "    ";
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    return JSON.stringify(value, null, unit).replace(/\n/g, newline + indent);
}

function insertProperty(content: string, tokens: Token[], start: number, entries: Property[], key: string, value: unknown): string {
    const last = entries[entries.length - 1];
    const offset = last ? tokens[last.valueEnd - 1].end : tokens[start].end;
    const multiline = content.includes("\n");
    const indents = Array.from(content.matchAll(/^[\t ]+(?=")/gm), match => match[0]);
    const unit = indents.sort((a, b) => a.length - b.length)[0] || "    ";
    const indent = lineIndent(content, tokens[start].start) + unit;
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const text = (multiline ? newline + indent : "") + JSON.stringify(key) + (multiline ? ": " : ":") + formatValue(content, value, indent);
    const close = tokens[valueEnd(tokens, start) - 1].start;
    const closingLine = multiline && !content.slice(offset, close).includes("\n") ? newline + lineIndent(content, tokens[start].start) : "";
    return content.slice(0, offset) + (last ? "," : "") + text + closingLine + content.slice(offset);
}

/**
 * Change only the value at meta.pinnedExtensions, preserving every other byte
 * (including whitespace, escaped strings, property order and number spelling).
 * Missing keys are inserted; malformed/ambiguous metadata is never rewritten.
 */
export function clearMetadataPinsInText(content: string): string {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return content; }
    return replaceMetadataPinsInText(content, {});
}

export function replaceMetadataPinsInText(content: string, pins: PinDecisions): string {
    const metadata = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || (metadata.meta !== undefined && (!metadata.meta || typeof metadata.meta !== "object" || Array.isArray(metadata.meta)))) {
        throw new Error("Invalid project metadata");
    }
    const replacement = JSON.stringify(pins);
    const tokens: Token[] = Array.from(content.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g), match => ({
        text: match[0], start: match.index!, end: match.index! + match[0].length,
    }));
    const root = properties(tokens, 0);
    const meta = findProperty(root, "meta");
    if (!meta) { return insertProperty(content, tokens, 0, root, "meta", { pinnedExtensions: pins }); }
    const entries = properties(tokens, meta.valueStart);
    const existing = findProperty(entries, "pinnedExtensions");
    if (!existing) { return insertProperty(content, tokens, meta.valueStart, entries, "pinnedExtensions", pins); }
    if (JSON.stringify(metadata.meta.pinnedExtensions) === replacement) { return content; }
    const offset = tokens[existing.valueStart].start;
    return content.slice(0, offset) + formatValue(content, pins, lineIndent(content, offset)) + content.slice(tokens[existing.valueEnd - 1].end);
}
