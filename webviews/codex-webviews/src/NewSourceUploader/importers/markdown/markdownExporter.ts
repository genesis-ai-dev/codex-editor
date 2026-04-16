/**
 * Generic Markdown round-trip export: rebuilds .md from per-cell originalMarkdown + codex translations.
 * (OBS uses obsExporter + obsStory; do not route generic .md through that path.)
 */

export interface MarkdownRoundtripCell {
    kind: number;
    value: string;
    metadata: {
        type?: string;
        segmentIndex?: number;
        originalMarkdown?: string;
        elementType?: string;
        headingLevel?: number;
        data?: { originalText?: string };
    };
}

function stripHtmlTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim();
}

function isMilestoneCell(meta: MarkdownRoundtripCell["metadata"] | undefined): boolean {
    if (!meta?.type) return false;
    return meta.type === "milestone";
}

/**
 * One exported line/block per markdown segment cell.
 */
function segmentToMarkdownLine(meta: MarkdownRoundtripCell["metadata"], cellValue: string): string {
    const original =
        (typeof meta?.originalMarkdown === "string" ? meta.originalMarkdown : "") ||
        (typeof meta?.data?.originalText === "string" ? meta.data.originalText : "");
    const translated = stripHtmlTags(cellValue).trim();

    if (!translated) {
        return original;
    }

    const elementType = meta?.elementType;

    if (elementType === "heading") {
        const m = original.trim().match(/^(#{1,6})\s+/);
        if (m) {
            return `${m[1]} ${translated}`;
        }
        const level = typeof meta?.headingLevel === "number" ? Math.min(6, Math.max(1, meta.headingLevel)) : 1;
        return `${"#".repeat(level)} ${translated}`;
    }

    if (elementType === "list-item") {
        const prefixMatch = original.match(/^(\s*(?:[-*+]|\d+\.)\s)/);
        const prefix = prefixMatch ? prefixMatch[1] : "";
        return `${prefix}${translated}`;
    }

    return translated;
}

/**
 * @param codexCells — active codex cells (milestones skipped); same shape as OBS exporter input
 */
export function exportMarkdownImporterRoundtrip(codexCells: MarkdownRoundtripCell[]): string {
    const segments = codexCells.filter((cell) => {
        if (cell.kind !== 2) return false;
        const meta = cell.metadata;
        if (isMilestoneCell(meta)) return false;
        const om = meta?.originalMarkdown ?? meta?.data?.originalText;
        return typeof om === "string" && om.length > 0;
    });

    segments.sort((a, b) => {
        const ia = a.metadata?.segmentIndex ?? 0;
        const ib = b.metadata?.segmentIndex ?? 0;
        return ia - ib;
    });

    const lines = segments.map((cell) => segmentToMarkdownLine(cell.metadata, cell.value));
    return lines.join("\n\n");
}
