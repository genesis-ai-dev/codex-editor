import { describe, it, expect } from 'vitest';
import { usfmCellAligner } from './usfmCellAligner';

/**
 * Simulates the ID resolution logic from handleWriteTranslation.
 * This is the fix for issue #429: use the matched target cell's ID
 * (from the aligner) instead of the imported content's new UUID.
 */
function resolveTargetId(alignedCell: { notebookCell: any; importedContent: { id: string } }) {
    return alignedCell.notebookCell?.metadata?.id
        || alignedCell.notebookCell?.id
        || alignedCell.importedContent.id;
}

describe('usfmCellAligner', () => {
    it('matches imported content to target cells by cellLabel', async () => {
        // Simulate existing target cells (from .codex file, created during source import)
        const targetCells = [
            { id: 'uuid-target-1', value: '', metadata: { id: 'uuid-target-1', cellLabel: 'GEN 1:1' } },
            { id: 'uuid-target-2', value: '', metadata: { id: 'uuid-target-2', cellLabel: 'GEN 1:2' } },
            { id: 'uuid-target-3', value: '', metadata: { id: 'uuid-target-3', cellLabel: 'GEN 1:3' } },
        ];

        // Simulate imported content (from re-parsing the same file — NEW UUIDs)
        const importedContent = [
            { id: 'uuid-new-1', content: 'In the beginning...', cellLabel: 'GEN 1:1' },
            { id: 'uuid-new-2', content: 'And the earth was...', cellLabel: 'GEN 1:2' },
            { id: 'uuid-new-3', content: 'And God said...', cellLabel: 'GEN 1:3' },
        ];

        const aligned = await usfmCellAligner(targetCells, [], importedContent);

        // All 3 should be matched
        const matchedCells = aligned.filter(a => a.importedContent.content.trim() !== '');
        expect(matchedCells).toHaveLength(3);

        // Each aligned cell's notebookCell should be the EXISTING target cell
        for (const cell of matchedCells) {
            expect(cell.notebookCell).toBeDefined();
            expect(cell.notebookCell.metadata.id).toMatch(/^uuid-target-/);
        }

        // The imported content still has the new UUIDs
        for (const cell of matchedCells) {
            expect(cell.importedContent.id).toMatch(/^uuid-new-/);
        }
    });

    it('resolves target ID from matched notebook cell, not imported content (issue #429 fix)', async () => {
        const targetCells = [
            { id: 'uuid-target-1', value: '', metadata: { id: 'uuid-target-1', cellLabel: 'GEN 1:1' } },
            { id: 'uuid-target-2', value: '', metadata: { id: 'uuid-target-2', cellLabel: 'GEN 1:2' } },
        ];

        const importedContent = [
            { id: 'uuid-new-1', content: 'In the beginning...', cellLabel: 'GEN 1:1' },
            { id: 'uuid-new-2', content: 'And the earth was...', cellLabel: 'GEN 1:2' },
        ];

        const aligned = await usfmCellAligner(targetCells, [], importedContent);
        const matchedCells = aligned.filter(a => a.importedContent.content.trim() !== '');

        // Simulate the handleWriteTranslation ID resolution (the fix)
        for (let i = 0; i < matchedCells.length; i++) {
            const targetId = resolveTargetId(matchedCells[i]);
            // The resolved ID should be the EXISTING target cell's UUID, not the imported one
            expect(targetId).toBe(`uuid-target-${i + 1}`);
            expect(targetId).not.toBe(`uuid-new-${i + 1}`);
        }
    });

    it('preserves unmatched target cells (paratext, headers)', async () => {
        const targetCells = [
            { id: 'uuid-header', value: 'Genesis', metadata: { id: 'uuid-header', cellLabel: 'GEN 0:\\id:0' } },
            { id: 'uuid-target-1', value: '', metadata: { id: 'uuid-target-1', cellLabel: 'GEN 1:1' } },
        ];

        // Only verse content imported (versesOnly mode)
        const importedContent = [
            { id: 'uuid-new-1', content: 'In the beginning...', cellLabel: 'GEN 1:1' },
        ];

        const aligned = await usfmCellAligner(targetCells, [], importedContent);

        // Should have 2 cells: 1 matched verse + 1 preserved header
        expect(aligned).toHaveLength(2);

        // The header cell should be preserved with its original ID
        const headerCell = aligned.find(a =>
            (a.notebookCell?.metadata?.id || a.importedContent.id) === 'uuid-header'
        );
        expect(headerCell).toBeDefined();
    });

    it('handles case-insensitive cellLabel matching', async () => {
        const targetCells = [
            { id: 'uuid-target-1', value: '', metadata: { id: 'uuid-target-1', cellLabel: 'gen 1:1' } },
        ];

        const importedContent = [
            { id: 'uuid-new-1', content: 'In the beginning...', cellLabel: 'GEN 1:1' },
        ];

        const aligned = await usfmCellAligner(targetCells, [], importedContent);
        const matchedCells = aligned.filter(a => a.importedContent.content === 'In the beginning...');

        expect(matchedCells).toHaveLength(1);
        expect(matchedCells[0].notebookCell.metadata.id).toBe('uuid-target-1');
    });
});
