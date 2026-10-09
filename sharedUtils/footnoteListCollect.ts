export interface FootnoteListNote {
    cellId: string;
    /** Verse number, cell label, or editor line number shown beside the note. */
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
        parentId?: string;
        data?: {
            deleted?: boolean;
            merged?: boolean;
            hidden?: boolean;
            parentId?: string;
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

function isSkipped(cell: FootnoteListCell): boolean {
    const data = cell.metadata?.data;
    return Boolean(data?.deleted || data?.merged || data?.hidden);
}

function parentIdOf(cell: FootnoteListCell): string | undefined {
    const parentId = cell.metadata?.parentId ?? cell.metadata?.data?.parentId;
    if (parentId) {
        return parentId;
    }
    // Legacy paratext ids carry the parent id before ":paratext-".
    const id = cell.metadata?.id || "";
    const paratextIndex = id.indexOf(":paratext-");
    return paratextIndex > 0 ? id.slice(0, paratextIndex) : undefined;
}

/**
 * Line numbers as the editor shows them: visible root cells are numbered
 * through the whole document (milestones, paratext, children, and deleted,
 * merged, or hidden cells are not counted); a child cell is numbered after its
 * parent as "parent.n"; a paratext cell borrows its parent's number.
 */
function buildLineNumbers(cells: FootnoteListCell[]): Map<string, string> {
    const lines = new Map<string, string>();
    const dependents: FootnoteListCell[] = [];
    let line = 0;

    for (const cell of cells) {
        const id = cell.metadata?.id;
        if (!id || cell.metadata?.type === "milestone" || isSkipped(cell)) {
            continue;
        }
        if (cell.metadata?.type === "paratext" || parentIdOf(cell)) {
            dependents.push(cell);
            continue;
        }
        line += 1;
        lines.set(id, String(line));
    }

    const childCounts = new Map<string, number>();
    for (const cell of dependents) {
        const id = cell.metadata?.id as string;
        const parentId = parentIdOf(cell);
        const parentLine = parentId ? lines.get(parentId) : undefined;
        if (!parentLine) {
            continue;
        }
        if (cell.metadata?.type === "paratext") {
            lines.set(id, parentLine);
            continue;
        }
        const childIndex = (childCounts.get(parentId as string) ?? 0) + 1;
        childCounts.set(parentId as string, childIndex);
        lines.set(id, `${parentLine}.${childIndex}`);
    }

    return lines;
}

function verseNumber(cellId: string, cellLabel?: string, lineNumber?: string): string {
    const bible = cellId.match(/\s+\d+:(\d+)/);
    if (bible) {
        return bible[1];
    }
    if (cellLabel) {
        return cellLabel;
    }
    return lineNumber || "•";
}

/**
 * Group a notebook's footnotes by milestone, in document order.
 * Milestones with no footnotes are omitted.
 */
export function collectMilestonesWithFootnotes(cells: FootnoteListCell[]): FootnoteListMilestone[] {
    const groups: FootnoteListMilestone[] = [];
    const lineNumbers = buildLineNumbers(cells);
    let current: FootnoteListMilestone | null = null;

    for (const cell of cells) {
        if (isSkipped(cell)) {
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
                verseNumber: verseNumber(cellId, cell.metadata?.cellLabel, lineNumbers.get(cellId)),
                content,
            });
        }
    }

    return groups.filter((group) => group.notes.length > 0);
}
