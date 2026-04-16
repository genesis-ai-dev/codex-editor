/**
 * Custom USFM Cell Aligner
 * Matches verses by verse number and chapter (cell ID format: "BOOK CHAPTER:VERSE")
 * rather than sequentially, ensuring verses end up in the correct cells even if
 * the target file is shorter or not well-structured.
 *
 * Preserves original target cell ordering: iterates target cells in their existing
 * order and looks up matching imported content, keeping preface/header cells in place.
 */

import { CellAligner, AlignedCell, ImportedContent } from '../../../types/plugin';
import type { CustomNotebookCellData } from 'types';

type MatchResult = {
    importedItem: ImportedContent;
    alignmentMethod: AlignedCell['alignmentMethod'];
    confidence: number;
};

const VERSE_PATTERN = /^([A-Z0-9]{2,})\s+(\d+):(\d+[a-z]?)$/i;

/**
 * Build lookup indexes from imported content for multi-strategy matching.
 */
const buildImportedIndexes = (importedContent: ImportedContent[]) => {
    const byId = new Map<string, ImportedContent[]>();
    const byLabel = new Map<string, ImportedContent[]>();
    const byVerseRef = new Map<string, ImportedContent[]>();
    const byVerseRefWithBook = new Map<string, ImportedContent[]>();

    const appendToMap = (map: Map<string, ImportedContent[]>, key: string, item: ImportedContent) => {
        const list = map.get(key) || [];
        list.push(item);
        map.set(key, list);
    };

    for (const item of importedContent) {
        if (!item.content.trim()) continue;

        const id = String(item.id ?? '').trim();
        if (id) {
            appendToMap(byId, id, item);
            appendToMap(byId, id.toUpperCase(), item);
        }

        const cellLabel = item.cellLabel || (item as Record<string, unknown>).metadata?.cellLabel;
        if (cellLabel) {
            const label = String(cellLabel).trim();
            appendToMap(byLabel, label, item);
            appendToMap(byLabel, label.toUpperCase(), item);
        }

        if (id) {
            const verseMatch = id.match(VERSE_PATTERN);
            if (verseMatch) {
                const [, bookCode, chapter, verse] = verseMatch;
                appendToMap(byVerseRefWithBook, `${bookCode.toUpperCase()} ${chapter}:${verse}`, item);
                appendToMap(byVerseRef, `${chapter}:${verse}`, item);
            }
        }
    }

    return { byId, byLabel, byVerseRef, byVerseRefWithBook };
};

/**
 * Try to match a target cell against the imported content using multiple strategies.
 * Consumes the first match from the relevant list to avoid double-matching.
 */
const findMatchForTargetCell = (
    cell: CustomNotebookCellData,
    indexes: ReturnType<typeof buildImportedIndexes>,
    usedImported: Set<ImportedContent>,
): MatchResult | null => {
    const { byId, byLabel, byVerseRef, byVerseRefWithBook } = indexes;

    const takeFirst = (map: Map<string, ImportedContent[]>, key: string): ImportedContent | null => {
        const list = map.get(key);
        if (!list) return null;
        while (list.length > 0) {
            const candidate = list.shift()!;
            if (!usedImported.has(candidate)) return candidate;
        }
        return null;
    };

    const cellId = String(cell.metadata?.id || (cell as any).id || '').trim();
    const cellLabel = String(cell.metadata?.cellLabel || '').trim();

    // Strategy 1: cellLabel matching (most reliable for verse matching)
    if (cellLabel) {
        const item = takeFirst(byLabel, cellLabel) || takeFirst(byLabel, cellLabel.toUpperCase());
        if (item) return { importedItem: item, alignmentMethod: 'custom', confidence: 0.95 };
    }

    // Strategy 2: exact ID matching
    if (cellId) {
        const item = takeFirst(byId, cellId) || takeFirst(byId, cellId.toUpperCase());
        if (item) return { importedItem: item, alignmentMethod: 'exact-id', confidence: 1.0 };
    }

    // Strategy 3: verse reference matching
    if (cellId) {
        const verseMatch = cellId.match(VERSE_PATTERN);
        if (verseMatch) {
            const [, bookCode, chapter, verse] = verseMatch;
            const refWithBook = `${bookCode.toUpperCase()} ${chapter}:${verse}`;
            const item = takeFirst(byVerseRefWithBook, refWithBook)
                || takeFirst(byVerseRef, `${chapter}:${verse}`);
            if (item) return { importedItem: item, alignmentMethod: 'custom', confidence: 0.9 };
        }
    }

    return null;
};

/**
 * USFM cell aligner that matches verses by their cell ID (book chapter:verse).
 * Iterates target cells in their original order to preserve notebook structure.
 */
export const usfmCellAligner: CellAligner = async (
    targetCells: CustomNotebookCellData[],
    _sourceCells: CustomNotebookCellData[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];
    const usedImported = new Set<ImportedContent>();
    const indexes = buildImportedIndexes(importedContent);

    let labelMatches = 0;
    let exactMatches = 0;
    let verseMatches = 0;

    // Iterate target cells in their existing order
    for (const targetCell of targetCells) {
        const targetId = String(targetCell.metadata?.id || (targetCell as any).id || '').trim();
        const match = findMatchForTargetCell(targetCell, indexes, usedImported);

        if (match) {
            usedImported.add(match.importedItem);

            if (match.alignmentMethod === 'exact-id') exactMatches++;
            else if (match.confidence >= 0.95) labelMatches++;
            else verseMatches++;

            alignedCells.push({
                notebookCell: targetCell,
                importedContent: {
                    ...match.importedItem,
                    id: targetId || match.importedItem.id,
                },
                alignmentMethod: match.alignmentMethod,
                confidence: match.confidence,
            });
        } else {
            // No match — preserve existing cell content in its original position
            alignedCells.push({
                notebookCell: targetCell,
                importedContent: {
                    id: targetId,
                    content: targetCell.value || '',
                    cellLabel: targetCell.metadata?.cellLabel,
                    metadata: targetCell.metadata || {},
                },
                alignmentMethod: 'custom',
                confidence: 1.0,
            });
        }
    }

    const unmatched = importedContent.filter(
        (item) => item.content.trim() && !usedImported.has(item)
    ).length;
    const preservedCount = targetCells.length - usedImported.size;

    console.log(
        `USFM aligner: ${labelMatches} label, ${exactMatches} exact-id, ${verseMatches} verse matches, ` +
        `${unmatched} unmatched imported (skipped), ${preservedCount} existing cells preserved`
    );

    if (unmatched > 0 || labelMatches === 0) {
        const sampleTargetLabels = targetCells.slice(0, 10).map(
            (c) => c.metadata?.cellLabel || c.metadata?.id || '(no id)'
        );
        const sampleImportedLabels = importedContent.slice(0, 10).map(
            (item) => item.cellLabel || (item as Record<string, unknown>).metadata?.cellLabel || item.id
        );
        console.log(`[USFM Aligner] Sample target labels:`, sampleTargetLabels);
        console.log(`[USFM Aligner] Sample imported labels/IDs:`, sampleImportedLabels);
    }

    return alignedCells;
};

