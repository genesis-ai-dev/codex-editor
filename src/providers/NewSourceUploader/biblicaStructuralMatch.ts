/**
 * Structural cell matching for Biblica (IDML) re-imports.
 *
 * The generic re-import merge matches cells by their normalized source text.
 * That breaks for the exact case Biblica projects keep hitting: when the
 * importer's handling of character-style runs changes, a cell's source content
 * changes too, so it no longer matches any old cell by text. The old cell gets
 * tombstoned and a fresh empty cell takes its place — the translation is still
 * in the file but orphaned and invisible.
 *
 * Biblica cells carry IDML locators that are independent of their content:
 * `metadata.storyId` (the story's `Self` id), `metadata.paragraphId` (the
 * paragraph's `Self` id) and `metadata.data.relationships.segmentIndex` (which
 * line-group slice of that paragraph the cell represents). Matching on those
 * survives any content change, which both preserves the translation and lets
 * us report precisely which cells changed.
 *
 * `indesign` imports share this metadata shape and could opt in later; the
 * gate is deliberately a single predicate.
 */

import type { ReimportCell, ReimportNotebook } from "./reimportMerge";

/** Locator that identifies one Biblica cell independent of its content. */
export interface BiblicaStructuralKey {
    storyId: string;
    /**
     * Every identity this paragraph answers to, most specific first: its IDML
     * `Self` id when the document has one, and its positional fallback
     * (`order:<n>`) — the same addressing the exporter uses.
     *
     * Both are recorded rather than just the best one because the two sides of
     * a re-import are written by different importer builds. IDML
     * `ParagraphStyleRange` elements carry no `Self` attribute, so most
     * documents only ever have the positional key; but if one side records an
     * id and the other does not, keying strictly on the richer locator would
     * make the two sides intersect on nothing and blank out every translation
     * in the file.
     */
    paragraphKeys: string[];
    /** Which line-group slice of the paragraph this cell holds. */
    segmentIndex: number;
}

/** Groups every cell produced by one IDML paragraph. */
export type BiblicaParagraphGroupKey = string;

/**
 * Notebooks written by older importer builds may only carry the importer type
 * inside `importContext`, so both locations are checked: missing this gate
 * silently disables structural matching, which loses every translation in the
 * file rather than degrading gracefully.
 */
export const isBiblicaImportContext = (
    metadata: Record<string, unknown> | undefined,
): boolean => {
    const importContext = metadata?.importContext as Record<string, unknown> | undefined;
    return [metadata?.importerType, importContext?.importerType].some(
        (value) => typeof value === "string" && value.toLowerCase().trim() === "biblica",
    );
};

const readString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * Derive the structural locator for a cell, or null when the cell predates the
 * locator metadata (those fall through to the text-based passes).
 */
export const getBiblicaStructuralKey = (cell: ReimportCell): BiblicaStructuralKey | null => {
    const metadata = cell.metadata;
    if (!metadata) return null;
    const data = metadata.data as Record<string, unknown> | undefined;
    const idmlStructure = data?.idmlStructure as Record<string, unknown> | undefined;
    const relationships = data?.relationships as Record<string, unknown> | undefined;

    const storyId =
        readString(metadata.storyId) ??
        readString(idmlStructure?.storyId) ??
        readString(relationships?.parentStory);
    if (!storyId) return null;

    const paragraphId =
        readString(metadata.paragraphId) ?? readString(idmlStructure?.paragraphId);
    const paragraphOrder = relationships?.paragraphOrder;
    const paragraphKeys = [
        paragraphId ? `self:${paragraphId}` : undefined,
        typeof paragraphOrder === "number" ? `order:${paragraphOrder}` : undefined,
    ].filter((key): key is string => key !== undefined);
    if (paragraphKeys.length === 0) return null;

    const segmentIndex = relationships?.segmentIndex;
    return {
        storyId,
        paragraphKeys,
        // Paragraphs that produce a single cell may omit the index entirely.
        segmentIndex: typeof segmentIndex === "number" ? segmentIndex : 0,
    };
};

/** Every group key this cell's paragraph answers to, most specific first. */
export const toParagraphGroupKeys = (key: BiblicaStructuralKey): BiblicaParagraphGroupKey[] =>
    key.paragraphKeys.map((paragraphKey) => `${key.storyId}\u0000${paragraphKey}`);

export interface BiblicaParagraphMember<T> {
    key: BiblicaStructuralKey;
    item: T;
    /** Position in the source array, used to break segment-index ties. */
    order: number;
}

export interface BiblicaParagraphGroup<T> {
    /** Every key this group can be found by. */
    groupKeys: BiblicaParagraphGroupKey[];
    /** Members ordered by `segmentIndex`, then by their position in the file. */
    members: Array<BiblicaParagraphMember<T>>;
}

export interface BiblicaParagraphIndex<T> {
    /** Groups in first-appearance order; each group appears exactly once. */
    groups: Array<BiblicaParagraphGroup<T>>;
    /** Lookup by any one of a group's keys. */
    byKey: Map<BiblicaParagraphGroupKey, BiblicaParagraphGroup<T>>;
}

/**
 * Bucket items by the IDML paragraph they came from, keeping each bucket in
 * segment order so old and new slices of the same paragraph can be aligned
 * positionally when their counts differ.
 *
 * Cells are grouped by their most specific key only, so two paragraphs are
 * never merged. Each group is then made findable by all of its keys, which is
 * what lets a group written with one locator match a group that only knows the
 * other. A key shared by more than one group is dropped as ambiguous rather
 * than resolved arbitrarily — it would otherwise attach translations to the
 * wrong paragraph, which is worse than falling through to text matching.
 */
export const indexByBiblicaParagraph = <T>(
    items: readonly T[],
    getCell: (item: T) => ReimportCell,
): BiblicaParagraphIndex<T> => {
    const index: BiblicaParagraphIndex<T> = { groups: [], byKey: new Map() };
    const byPrimaryKey = new Map<BiblicaParagraphGroupKey, BiblicaParagraphGroup<T>>();

    items.forEach((item, order) => {
        const key = getBiblicaStructuralKey(getCell(item));
        if (!key) return;
        const groupKeys = toParagraphGroupKeys(key);
        const member: BiblicaParagraphMember<T> = { key, item, order };
        const group = byPrimaryKey.get(groupKeys[0]);
        if (group) {
            group.members.push(member);
            for (const groupKey of groupKeys) {
                if (!group.groupKeys.includes(groupKey)) group.groupKeys.push(groupKey);
            }
            return;
        }
        const created: BiblicaParagraphGroup<T> = { groupKeys: [...groupKeys], members: [member] };
        byPrimaryKey.set(groupKeys[0], created);
        index.groups.push(created);
    });

    const ambiguous = new Set<BiblicaParagraphGroupKey>();
    for (const group of index.groups) {
        group.members.sort(
            (a, b) => a.key.segmentIndex - b.key.segmentIndex || a.order - b.order,
        );
        for (const groupKey of group.groupKeys) {
            if (index.byKey.get(groupKey) === group) continue;
            if (index.byKey.has(groupKey)) {
                ambiguous.add(groupKey);
            } else {
                index.byKey.set(groupKey, group);
            }
        }
    }
    for (const groupKey of ambiguous) {
        index.byKey.delete(groupKey);
    }
    return index;
};

/** Find the group in `index` that corresponds to `group`, by any shared key. */
export const findMatchingParagraphGroup = <T, U>(
    index: BiblicaParagraphIndex<T>,
    group: BiblicaParagraphGroup<U>,
): BiblicaParagraphGroup<T> | undefined => {
    for (const groupKey of group.groupKeys) {
        const match = index.byKey.get(groupKey);
        if (match) return match;
    }
    return undefined;
};

/**
 * True when the fresh parse of this notebook pair can be structurally matched
 * against the existing pair. Requires both sides to be Biblica imports and the
 * fresh parse to actually carry locators (a parser regression that dropped
 * them must fall back to text matching rather than mis-align everything).
 */
export const canStructurallyMatchBiblica = (
    existingSource: ReimportNotebook,
    newSource: ReimportNotebook,
): boolean => {
    if (!isBiblicaImportContext(existingSource.metadata)) return false;
    if (!isBiblicaImportContext(newSource.metadata)) return false;
    const hasKeys = (notebook: ReimportNotebook): boolean =>
        (notebook.cells ?? []).some((cell) => getBiblicaStructuralKey(cell) !== null);
    return hasKeys(existingSource) && hasKeys(newSource);
};
