import { EXTENSION_PIN_POLICY } from "./extensionPinFeatureFlag";
import { clearMetadataPins } from "./extensionPinPolicy";

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

function insertProperty(content: string, tokens: Token[], start: number, entries: Property[], text: string): string {
    const last = entries[entries.length - 1];
    const offset = last ? tokens[last.valueEnd - 1].end : tokens[start].end;
    return content.slice(0, offset) + (last ? "," : "") + text + content.slice(offset);
}

/**
 * Change only the value at meta.pinnedExtensions, preserving every other byte
 * (including whitespace, escaped strings, property order and number spelling).
 * Missing keys are inserted; malformed/ambiguous metadata is never rewritten.
 */
export function clearMetadataPinsInText(content: string): string {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return content; }
    const metadata: unknown = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
    const changed = clearMetadataPins(metadata);
    const tokens: Token[] = Array.from(content.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g), match => ({
        text: match[0], start: match.index!, end: match.index! + match[0].length,
    }));
    const root = properties(tokens, 0);
    const meta = findProperty(root, "meta");
    if (!meta) {
        return insertProperty(content, tokens, 0, root, '"meta":{"pinnedExtensions":{}}');
    }
    const entries = properties(tokens, meta.valueStart);
    const pins = findProperty(entries, "pinnedExtensions");
    if (!changed) { return content; }
    if (!pins) {
        return insertProperty(content, tokens, meta.valueStart, entries, '"pinnedExtensions":{}');
    }
    return content.slice(0, tokens[pins.valueStart].start) + "{}" + content.slice(tokens[pins.valueEnd - 1].end);
}
