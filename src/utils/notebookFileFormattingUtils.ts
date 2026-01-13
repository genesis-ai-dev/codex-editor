/**
 * Shared formatting helpers for `.codex` and `.source` notebook files.
 *
 * Goals:
 * - Consistent indentation across all writers
 * - Normalize line endings for deterministic diffs
 * - Ensure exactly one trailing newline at EOF
 */

export type JsonIndent = number;

export function normalizeNewlines(text: string): string {
    // Convert Windows CRLF -> LF for deterministic whitespace on disk
    return text.replace(/\r\n/g, "\n");
}

export function ensureSingleTrailingNewline(text: string): string {
    const withoutTrailing = text.replace(/\s*$/, "");
    return `${withoutTrailing}\n`;
}

export function formatJsonForNotebookFile(value: unknown, indent: JsonIndent = 2): string {
    const json = JSON.stringify(value, null, indent);
    return ensureSingleTrailingNewline(normalizeNewlines(json));
}

export function normalizeNotebookFileText(text: string): string {
    // Used when we already have JSON text (e.g., merge outputs)
    return ensureSingleTrailingNewline(normalizeNewlines(text));
}

