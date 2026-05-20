/**
 * Shared audio-attachment helpers used by both the export pipeline
 * (`audioExporter.ts`) and the export view's pre-flight scan
 * (`projectManager/utils/exportViewUtils.ts`).
 *
 * Centralizing the predicate guarantees the Step 1 inline counts can never
 * disagree with the actual export behavior, since both paths consult the same
 * function.
 */

export interface AudioAttachmentCandidate {
    id: string;
    url: string;
    updatedAt?: number;
    start?: number;
    end?: number;
}

export interface AudioPick {
    id: string;
    url: string;
    start?: number;
    end?: number;
}

export type CellAudioState = "ready" | "selection-lost" | "none";

export interface AudioPickOutcome {
    /**
     * `ready` — there is an audio take to export (either `selectedAudioId`
     *           matched a candidate, or no selection was set and we picked
     *           the most-recent recording).
     * `selection-lost` — `selectedAudioId` was set but the referenced
     *           attachment is gone. We deliberately do NOT fall back to a
     *           different take, because that take wasn't approved by the
     *           user. The cell needs to be revisited.
     * `none` — the cell has no usable audio attachments at all.
     */
    state: CellAudioState;
    /** Populated only when `state === "ready"`. */
    pick?: AudioPick;
}

/**
 * Walks a cell's audio attachments and decides whether an exportable take
 * exists. We refuse to silently fall back to a different recording when the
 * user's selected take is missing — that would export audio they never
 * validated.
 */
export function pickAudioAttachment(cell: unknown): AudioPickOutcome {
    const meta = (cell as { metadata?: Record<string, unknown> } | undefined)?.metadata;
    if (!meta || typeof meta !== "object") return { state: "none" };

    const attachments = (meta as { attachments?: Record<string, unknown> }).attachments;
    if (!attachments || typeof attachments !== "object") return { state: "none" };

    const selectedId =
        typeof (meta as { selectedAudioId?: unknown }).selectedAudioId === "string"
            ? ((meta as { selectedAudioId?: string }).selectedAudioId as string)
            : undefined;

    const candidates: AudioAttachmentCandidate[] = [];
    for (const [attId, attVal] of Object.entries(attachments)) {
        if (!attVal || typeof attVal !== "object") continue;
        const att = attVal as {
            type?: string;
            isDeleted?: boolean;
            isMissing?: boolean;
            url?: string;
            updatedAt?: number;
            startTime?: number;
            endTime?: number;
        };
        if (att.type !== "audio") continue;
        if (att.isDeleted) continue;
        if (att.isMissing) continue;
        if (!att.url || typeof att.url !== "string") continue;
        candidates.push({
            id: attId,
            url: att.url,
            updatedAt: att.updatedAt,
            start: att.startTime,
            end: att.endTime,
        });
    }

    if (candidates.length === 0) return { state: "none" };

    if (selectedId) {
        const selected = candidates.find((c) => c.id === selectedId);
        if (selected) {
            return {
                state: "ready",
                pick: {
                    id: selected.id,
                    url: selected.url,
                    start: selected.start,
                    end: selected.end,
                },
            };
        }
        // selectedAudioId set but the referenced take is gone — surface as
        // selection-lost rather than silently substituting an unapproved take.
        return { state: "selection-lost" };
    }

    // No explicit selection — most-recent take is the implicit choice.
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const top = candidates[0];
    return {
        state: "ready",
        pick: {
            id: top.id,
            url: top.url,
            start: top.start,
            end: top.end,
        },
    };
}

/**
 * Quick categorical state for a cell's audio readiness. Used by the Step 1
 * pre-flight to count cells without doing the full attachment pick.
 */
export function getCellAudioState(cell: unknown): CellAudioState {
    return pickAudioAttachment(cell).state;
}

/**
 * Returns true when a cell is an audio recording target. Mirrors the predicate
 * used by `computeDialogueLineNumbers` in `audioExporter.ts` so chapter-start
 * milestones and paratext (book intros, headings, etc.) are never counted as
 * "missing audio" — users don't record audio for those.
 */
export function isExportableCell(cell: unknown): boolean {
    const c = cell as {
        kind?: number;
        metadata?: {
            type?: string;
            data?: { merged?: boolean; deleted?: boolean; };
        };
    } | undefined;
    if (!c) return false;
    if (c.kind !== 2 && c.kind !== 1) return false;
    const data = c.metadata?.data;
    if (data?.merged) return false;
    if (data?.deleted) return false;
    const type = c.metadata?.type;
    if (type === "paratext" || type === "milestone") return false;
    return true;
}

/**
 * Returns true when we can produce a meaningful, human-readable identifier
 * for this cell in the export progress UI — either via globalReferences
 * (Bible), a user-set cellLabel, or non-empty text content. Cells that fail
 * this check are omitted from missing-audio reporting because the user has
 * no way to act on a row labelled with an opaque UUID or line number.
 */
export function isLabelableCell(cell: unknown): boolean {
    const c = cell as {
        value?: unknown;
        metadata?: {
            cellLabel?: unknown;
            data?: { globalReferences?: unknown };
        };
    } | undefined;
    if (!c) return false;

    const globalRefs = c.metadata?.data?.globalReferences;
    if (Array.isArray(globalRefs) && globalRefs.length > 0) {
        const first = globalRefs[0];
        if (typeof first === "string" && first.trim()) return true;
    }

    const cellLabel = c.metadata?.cellLabel;
    if (typeof cellLabel === "string" && cellLabel.trim()) return true;

    const raw = typeof c.value === "string" ? c.value : "";
    if (raw && raw.replace(/<[^>]+>/g, "").trim()) return true;

    return false;
}
