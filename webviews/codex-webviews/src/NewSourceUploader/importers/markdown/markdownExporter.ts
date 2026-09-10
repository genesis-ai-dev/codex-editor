/**
 * Markdown round-trip export: splice translated UTF-16 spans into the canonical source string.
 */

import { htmlTranslationToMarkdownForRoundTrip } from "../../utils/htmlToMarkdownRoundTrip";

export interface MarkdownExportCell {
    kind: number;
    value?: string;
    /** Webview / import DTO cells use `content`; persisted codex JSON often uses `value`. */
    content?: string;
    metadata?: {
        id?: string;
        segmentIndex?: number;
        sourceSpan?: { start: number; end: number; };
        segmentType?: string;
        originalMarkdown?: string;
        type?: string;
        data?: {
            originalText?: string;
            merged?: boolean;
            deleted?: boolean;
            hidden?: boolean;
        };
    };
}

export interface ExportMarkdownWithTranslationsOptions {
    /** When true, skip splice if translated markdown is empty. */
    skipEmptyTranslations?: boolean;
}

/**
 * Apply translations to `canonicalSource` by replacing each cell's `sourceSpan`
 * with Markdown converted from translated HTML when the cell has content.
 * Replacements run from last span to first so indices stay valid.
 */
export function exportMarkdownWithTranslations(
    canonicalSource: string,
    cells: MarkdownExportCell[],
    options: ExportMarkdownWithTranslationsOptions = {}
): string {
    const skipEmpty = options.skipEmptyTranslations !== false;

    type Replacement = { start: number; end: number; text: string; };
    const replacements: Replacement[] = [];

    for (const cell of cells) {
        if (cell.kind !== 2) {
            continue;
        }
        const data = cell.metadata?.data;
        if (data?.merged || data?.deleted || data?.hidden || cell.metadata?.type === "milestone") {
            continue;
        }
        const span = cell.metadata?.sourceSpan;
        if (!span || typeof span.start !== "number" || typeof span.end !== "number") {
            continue;
        }
        if (span.start < 0 || span.end > canonicalSource.length || span.start >= span.end) {
            console.warn(
                `[markdownExporter] Skipping invalid sourceSpan start=${span.start} end=${span.end} (source length ${canonicalSource.length})`
            );
            continue;
        }

        const sourceWitness = cell.metadata?.originalMarkdown ?? data?.originalText;
        if (sourceWitness !== undefined) {
            const normalize = (value: string) => value.replace(/\r\n/g, "\n").trimEnd();
            const actualSource = canonicalSource.slice(span.start, span.end);
            if (normalize(actualSource) !== normalize(sourceWitness)) {
                throw new Error(
                    `Cannot safely export Markdown cell ${cell.metadata?.id ?? "unknown"}: ` +
                    `its sourceSpan no longer matches the imported source text.`
                );
            }
        }
        const htmlSource = cell.value ?? cell.content ?? "";
        const translated = htmlTranslationToMarkdownForRoundTrip(htmlSource);
        if (skipEmpty && !translated) {
            continue;
        }

        // Preserve trailing newline from the original span so line breaks between
        // adjacent segments (e.g. consecutive list items) are not collapsed.
        const originalEndsWithNewline =
            span.end <= canonicalSource.length && canonicalSource[span.end - 1] === "\n";
        const text =
            originalEndsWithNewline && translated && !translated.endsWith("\n")
                ? translated + "\n"
                : translated;

        replacements.push({ start: span.start, end: span.end, text });
    }

    replacements.sort((a, b) => a.start - b.start);
    for (let index = 1; index < replacements.length; index++) {
        if (replacements[index].start < replacements[index - 1].end) {
            throw new Error("Cannot safely export Markdown: active source spans overlap.");
        }
    }
    replacements.reverse();

    let out = canonicalSource;
    for (const { start, end, text } of replacements) {
        out = out.slice(0, start) + text + out.slice(end);
    }

    return out;
}
