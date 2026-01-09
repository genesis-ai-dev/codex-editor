/**
 * Custom USFM Cell Aligner
 * Matches verses by verse number and chapter (cell ID format: "BOOK CHAPTER:VERSE")
 * rather than sequentially, ensuring verses end up in the correct cells even if
 * the target file is shorter or not well-structured.
 */

import { CellAligner, AlignedCell, ImportedContent } from '../../../types/plugin';

/**
 * USFM cell aligner that matches verses by their cell ID (book chapter:verse)
 * Falls back to exact ID matching for non-verse content
 */
export const usfmCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];

    // Create maps for efficient lookup
    // Map by exact cell ID (for verses: "BOOK CHAPTER:VERSE", for others: "BOOK CHAPTER:MARKER:INDEX")
    const targetCellsById = new Map<string, any>();

    // Map by verse reference (for verse matching: "CHAPTER:VERSE")
    const targetVersesByRef = new Map<string, any>();

    // Map by cell label (for fallback matching)
    const targetCellsByLabel = new Map<string, any>();

    // Build lookup maps from target cells
    targetCells.forEach((cell) => {
        const cellId = cell.metadata?.id || cell.id;
        if (cellId) {
            const normalizedId = String(cellId).trim().toUpperCase();
            targetCellsById.set(normalizedId, cell);
            // Also store original case for exact matching
            targetCellsById.set(String(cellId).trim(), cell);

            // Extract verse reference if it's a verse cell
            // Verse cell IDs are in format: "BOOK CHAPTER:VERSE" (e.g., "GEN 1:1", "1PE 1:1")
            // Match pattern: book code (2+ chars), space(s), chapter number, colon, verse number
            const verseMatch = String(cellId).match(/^([A-Z0-9]{2,})\s+(\d+):(\d+[a-z]?)$/i);
            if (verseMatch) {
                const [, bookCode, chapter, verse] = verseMatch;
                const normalizedBookCode = bookCode.toUpperCase();
                // Create verse reference with book code: "BOOK CHAPTER:VERSE" for more precise matching
                const verseRefWithBook = `${normalizedBookCode} ${chapter}:${verse}`;
                // Also create reference without book: "CHAPTER:VERSE" for fallback matching
                const verseRef = `${chapter}:${verse}`;
                targetVersesByRef.set(verseRefWithBook, cell);
                // Only set verseRef if not already set (prefer book-specific match)
                if (!targetVersesByRef.has(verseRef)) {
                    targetVersesByRef.set(verseRef, cell);
                }
            }
        }

        // Also index by cellLabel for fallback
        const cellLabel = cell.metadata?.cellLabel;
        if (cellLabel) {
            const normalizedLabel = String(cellLabel).trim().toUpperCase();
            targetCellsByLabel.set(normalizedLabel, cell);
            // Also store original case
            targetCellsByLabel.set(String(cellLabel).trim(), cell);
        }
    });

    let exactMatches = 0;
    let verseMatches = 0;
    let labelMatches = 0;
    let unmatched = 0;

    // Track which target cells have been matched
    const matchedTargetCells = new Set<any>();

    // Process each imported content item
    // Only match verses to existing target cells - don't create new cells
    for (const importedItem of importedContent) {
        if (!importedItem.content.trim()) {
            continue; // Skip empty content
        }

        const importedId = importedItem.id;
        let matchedCell: any | null = null;
        let alignmentMethod: AlignedCell['alignmentMethod'] = 'custom';
        let confidence = 0.0;

        // Strategy 1: PRIORITIZE cellLabel matching (most reliable for verse matching)
        // Check both importedItem.cellLabel and importedItem.metadata?.cellLabel
        const cellLabel = importedItem.cellLabel || (importedItem as any).metadata?.cellLabel;
        if (cellLabel) {
            const labelStr = String(cellLabel).trim();
            const normalizedLabel = labelStr.toUpperCase();

            if (targetCellsByLabel.has(labelStr)) {
                matchedCell = targetCellsByLabel.get(labelStr);
                alignmentMethod = 'custom';
                confidence = 0.95; // High confidence for label matching
                labelMatches++;
            } else if (targetCellsByLabel.has(normalizedLabel)) {
                matchedCell = targetCellsByLabel.get(normalizedLabel);
                alignmentMethod = 'custom';
                confidence = 0.95; // High confidence for label matching
                labelMatches++;
            }
        }

        // Strategy 2: Try exact ID match (fallback)
        // Try both original case and uppercase
        if (!matchedCell && importedId) {
            const normalizedId = String(importedId).trim().toUpperCase();
            const originalId = String(importedId).trim();

            if (targetCellsById.has(originalId)) {
                matchedCell = targetCellsById.get(originalId);
                alignmentMethod = 'exact-id';
                confidence = 1.0;
                exactMatches++;
            } else if (targetCellsById.has(normalizedId)) {
                matchedCell = targetCellsById.get(normalizedId);
                alignmentMethod = 'exact-id';
                confidence = 1.0;
                exactMatches++;
            }
        }

        // Strategy 3: Try verse reference matching (for verses) - last resort
        // First try with book code for precise matching, then fallback to chapter:verse
        if (!matchedCell && importedId) {
            // Match pattern: book code (2+ chars), space(s), chapter number, colon, verse number
            const verseMatch = String(importedId).match(/^([A-Z0-9]{2,})\s+(\d+):(\d+[a-z]?)$/i);
            if (verseMatch) {
                const [, bookCode, chapter, verse] = verseMatch;
                const normalizedBookCode = bookCode.toUpperCase();
                // Try matching with normalized book code first (more precise)
                const verseRefWithBook = `${normalizedBookCode} ${chapter}:${verse}`;
                if (targetVersesByRef.has(verseRefWithBook)) {
                    matchedCell = targetVersesByRef.get(verseRefWithBook);
                    alignmentMethod = 'custom';
                    confidence = 0.9; // High confidence for book-specific verse matching
                    verseMatches++;
                } else {
                    // Fallback to chapter:verse matching (in case book codes differ slightly)
                    const verseRef = `${chapter}:${verse}`;
                    if (targetVersesByRef.has(verseRef)) {
                        matchedCell = targetVersesByRef.get(verseRef);
                        alignmentMethod = 'custom';
                        confidence = 0.85; // Medium-high confidence for verse matching
                        verseMatches++;
                    }
                }
            }
        }

        // Only add aligned cell if we found a match
        // Skip unmatched verses - don't create new cells for them
        if (matchedCell) {
            matchedTargetCells.add(matchedCell);
            alignedCells.push({
                notebookCell: matchedCell,
                importedContent: importedItem,
                alignmentMethod,
                confidence,
            });
        } else {
            // No match found - skip this verse (don't create new cells)
            // Log for debugging but don't add to alignedCells
            console.warn(`[USFM Aligner] No match found for verse: ${importedId || 'unknown'}`);
            unmatched++;
        }
    }

    // IMPORTANT: Preserve all existing target cells that weren't matched
    // This ensures preface cells (chapter 0), headers, and other non-verse cells are kept
    for (const targetCell of targetCells) {
        if (!matchedTargetCells.has(targetCell)) {
            // This cell wasn't matched - preserve it with its original content
            alignedCells.push({
                notebookCell: targetCell,
                importedContent: {
                    id: (targetCell.metadata?.id || targetCell.id) || '',
                    content: targetCell.value || targetCell.content || '',
                    cellLabel: targetCell.metadata?.cellLabel,
                    metadata: targetCell.metadata || {},
                },
                alignmentMethod: 'custom', // Preserved existing cell
                confidence: 1.0,
            });
        }
    }

    const preservedCount = targetCells.length - matchedTargetCells.size;
    console.log(
        `USFM aligner: ${labelMatches} label matches, ${exactMatches} exact matches, ${verseMatches} verse matches, ` +
        `${unmatched} unmatched imported verses (skipped), ${preservedCount} existing cells preserved`
    );

    // Debug: Log sample target cell labels and imported labels for troubleshooting
    if (unmatched > 0 || labelMatches === 0) {
        const sampleTargetLabels = Array.from(targetCellsByLabel.keys()).slice(0, 10);
        const sampleImportedLabels = importedContent.slice(0, 10).map(item =>
            item.cellLabel || (item as any).metadata?.cellLabel || item.id
        );
        console.log(`[USFM Aligner] Sample target cell labels:`, sampleTargetLabels);
        console.log(`[USFM Aligner] Sample imported labels/IDs:`, sampleImportedLabels);
    }

    return alignedCells;
};

