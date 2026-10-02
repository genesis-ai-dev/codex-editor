export interface FootnoteListNote {
    cellId: string;
    verseNumber: string;
    content: string;
}

export interface FootnoteListMilestone {
    label: string;
    notes: FootnoteListNote[];
}

export interface FootnoteListCell {
    value?: string;
    metadata?: {
        id?: string;
        type?: string;
        cellLabel?: string;
        data?: {
            deleted?: boolean;
            merged?: boolean;
            hidden?: boolean;
        };
    };
}

const FOOTNOTE_SUP = /<sup\b([^>]*\bfootnote-marker\b[^>]*)>/gi;

function decodeHtmlAttribute(value: string): string {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function footnoteContents(html: string): string[] {
    const contents: string[] = [];
    FOOTNOTE_SUP.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FOOTNOTE_SUP.exec(html)) !== null) {
        const attrs = match[1];
        const attrMatch = attrs.match(/data-footnote\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        contents.push(decodeHtmlAttribute(attrMatch?.[1] ?? attrMatch?.[2] ?? ""));
    }
    return contents;
}

function verseNumber(cellId: string, cellLabel?: string): string {
    const bible = cellId.match(/\s+\d+:(\d+)/);
    if (bible) {
        return bible[1];
    }
    if (cellLabel) {
        return cellLabel;
    }
    return cellId || "•";
}

/**
 * Group a notebook's footnotes by milestone, in document order.
 * Milestones with no footnotes are omitted.
 */
export function collectMilestonesWithFootnotes(cells: FootnoteListCell[]): FootnoteListMilestone[] {
    const groups: FootnoteListMilestone[] = [];
    let current: FootnoteListMilestone | null = null;

    for (const cell of cells) {
        const data = cell.metadata?.data;
        if (data?.deleted || data?.merged || data?.hidden) {
            continue;
        }

        if (cell.metadata?.type === "milestone") {
            current = { label: (cell.value || "").trim() || "Section", notes: [] };
            groups.push(current);
            continue;
        }

        const html = cell.value || "";
        if (!html.includes("footnote-marker")) {
            continue;
        }

        const notes = footnoteContents(html);
        if (notes.length === 0) {
            continue;
        }

        if (!current) {
            current = { label: "Section", notes: [] };
            groups.push(current);
        }

        const cellId = cell.metadata?.id || "";
        for (const content of notes) {
            current.notes.push({
                cellId,
                verseNumber: verseNumber(cellId, cell.metadata?.cellLabel),
                content,
            });
        }
    }

    return groups.filter((group) => group.notes.length > 0);
}
