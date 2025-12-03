import { describe, it, expect } from 'vitest';
import { addMilestoneCellsToNotebookPair } from './workflowHelpers';
import { NotebookPair, ProcessedCell, ProcessedNotebook } from '../types/common';
import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

describe('addMilestoneCellsToNotebookPair', () => {
    const createMockCell = (
        id: string,
        content: string,
        metadata?: Record<string, any>
    ): ProcessedCell => ({
        id,
        content,
        images: [],
        metadata,
    });

    const createMockNotebook = (
        name: string,
        cells: ProcessedCell[],
        importerType?: string
    ): ProcessedNotebook => ({
        name,
        cells,
        metadata: {
            id: uuidv4(),
            originalFileName: `${name}.txt`,
            importerType: importerType || 'plaintext',
            createdAt: new Date().toISOString(),
        },
    });

    const createMockNotebookPair = (
        sourceCells: ProcessedCell[],
        codexCells: ProcessedCell[],
        importerType?: string
    ): NotebookPair => ({
        source: createMockNotebook('source', sourceCells, importerType),
        codex: createMockNotebook('codex', codexCells, importerType),
    });

    describe('Empty notebook handling', () => {
        it('should return unchanged notebook pair when source cells are empty', () => {
            const notebookPair = createMockNotebookPair([], []);
            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result).toEqual(notebookPair);
            expect(result.source.cells).toHaveLength(0);
            expect(result.codex.cells).toHaveLength(0);
        });
    });

    describe('Idempotent behavior', () => {
        it('should return unchanged notebook pair when milestone cells already exist', () => {
            const existingMilestone = createMockCell('milestone-1', '1', {
                type: CodexCellTypes.MILESTONE,
                id: 'milestone-1',
                edits: [],
            });
            const regularCell = createMockCell('GEN 1:1', 'In the beginning');
            const notebookPair = createMockNotebookPair(
                [existingMilestone, regularCell],
                [existingMilestone, regularCell],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result).toEqual(notebookPair);
            expect(result.source.cells).toHaveLength(2);
            expect(result.codex.cells).toHaveLength(2);
        });
    });

    describe('Non-Bible importers', () => {
        it('should add a single milestone cell with value "1" for plaintext importer', () => {
            const cell1 = createMockCell('cell-1', 'First paragraph');
            const cell2 = createMockCell('cell-2', 'Second paragraph');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'plaintext'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells).toHaveLength(3);
            expect(result.codex.cells).toHaveLength(3);

            const milestone = result.source.cells[0];
            expect(milestone.metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(milestone.content).toBe('1');
            expect(milestone.metadata?.id).toBeDefined();
            expect(milestone.metadata?.edits).toEqual([]);

            // Verify same UUID is used in both source and codex
            expect(result.source.cells[0].id).toBe(result.codex.cells[0].id);
            expect(result.source.cells[0].metadata?.id).toBe(
                result.codex.cells[0].metadata?.id
            );

            // Verify original cells are preserved
            expect(result.source.cells[1]).toEqual(cell1);
            expect(result.source.cells[2]).toEqual(cell2);
        });

        it('should add milestone for markdown importer', () => {
            const cell = createMockCell('cell-1', '# Heading');
            const notebookPair = createMockNotebookPair([cell], [cell], 'markdown');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells).toHaveLength(2);
            expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(result.source.cells[0].content).toBe('1');
        });

        it('should add milestone for docx importer', () => {
            const cell = createMockCell('cell-1', 'Document content');
            const notebookPair = createMockNotebookPair([cell], [cell], 'docx');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells).toHaveLength(2);
            expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
        });
    });

    describe('Bible-type importers', () => {
        it('should add milestone at beginning for single chapter', () => {
            const cell1 = createMockCell('GEN 1:1', 'In the beginning');
            const cell2 = createMockCell('GEN 1:2', 'The earth was formless');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells).toHaveLength(3);
            expect(result.codex.cells).toHaveLength(3);

            const milestone = result.source.cells[0];
            expect(milestone.metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(milestone.content).toBe('1'); // Chapter 1
            expect(result.source.cells[0].id).toBe(result.codex.cells[0].id);
        });

        it('should add milestones at beginning and before each new chapter', () => {
            const cell1 = createMockCell('GEN 1:1', 'In the beginning');
            const cell2 = createMockCell('GEN 1:2', 'The earth was formless');
            const cell3 = createMockCell('GEN 2:1', 'Thus the heavens');
            const cell4 = createMockCell('GEN 2:2', 'And on the seventh day');
            const cell5 = createMockCell('GEN 3:1', 'Now the serpent');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2, cell3, cell4, cell5],
                [cell1, cell2, cell3, cell4, cell5],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should have: milestone(1), cell1, cell2, milestone(2), cell3, cell4, milestone(3), cell5
            expect(result.source.cells).toHaveLength(8);
            expect(result.codex.cells).toHaveLength(8);

            // First milestone (chapter 1)
            expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(result.source.cells[0].content).toBe('1');

            // Original cells
            expect(result.source.cells[1]).toEqual(cell1);
            expect(result.source.cells[2]).toEqual(cell2);

            // Second milestone (chapter 2)
            expect(result.source.cells[3].metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(result.source.cells[3].content).toBe('2');

            // Original cells
            expect(result.source.cells[4]).toEqual(cell3);
            expect(result.source.cells[5]).toEqual(cell4);

            // Third milestone (chapter 3)
            expect(result.source.cells[6].metadata?.type).toBe(CodexCellTypes.MILESTONE);
            expect(result.source.cells[6].content).toBe('3');

            // Original cell
            expect(result.source.cells[7]).toEqual(cell5);

            // Verify UUIDs match between source and codex
            expect(result.source.cells[0].id).toBe(result.codex.cells[0].id);
            expect(result.source.cells[3].id).toBe(result.codex.cells[3].id);
            expect(result.source.cells[6].id).toBe(result.codex.cells[6].id);
        });

        it('should handle cells without chapter numbers in ID', () => {
            const cell1 = createMockCell('cell-1', 'Content', { chapterNumber: 1 });
            const cell2 = createMockCell('cell-2', 'Content', { chapterNumber: 2 });
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // When cell IDs don't have chapter numbers, only one milestone is added at the beginning
            // The milestone value uses metadata.chapterNumber, but no new milestone is added for cell2
            // because chapter detection only checks cell IDs, not metadata
            expect(result.source.cells).toHaveLength(3);
            expect(result.source.cells[0].content).toBe('1'); // Uses metadata.chapterNumber from first cell
            expect(result.source.cells[1]).toEqual(cell1);
            expect(result.source.cells[2]).toEqual(cell2);
        });

        it('should use metadata.chapter if available', () => {
            const cell1 = createMockCell('cell-1', 'Content', { chapter: 5 });
            const cell2 = createMockCell('cell-2', 'Content', { chapter: 6 });
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'usfm'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // When cell IDs don't have chapter numbers, only one milestone is added at the beginning
            // The milestone value uses metadata.chapter, but no new milestone is added for cell2
            // because chapter detection only checks cell IDs, not metadata
            expect(result.source.cells).toHaveLength(3);
            expect(result.source.cells[0].content).toBe('5'); // Uses metadata.chapter from first cell
            expect(result.source.cells[1]).toEqual(cell1);
            expect(result.source.cells[2]).toEqual(cell2);
        });

        it('should use metadata.data.chapter as fallback', () => {
            const cell1 = createMockCell('cell-1', 'Content', {
                data: { chapter: 10 },
            });
            const cell2 = createMockCell('cell-2', 'Content', {
                data: { chapter: 11 },
            });
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // When cell IDs don't have chapter numbers, only one milestone is added at the beginning
            // The milestone value uses metadata.data.chapter, but no new milestone is added for cell2
            // because chapter detection only checks cell IDs, not metadata
            expect(result.source.cells).toHaveLength(3);
            expect(result.source.cells[0].content).toBe('10'); // Uses metadata.data.chapter from first cell
            expect(result.source.cells[1]).toEqual(cell1);
            expect(result.source.cells[2]).toEqual(cell2);
        });

        it('should use milestoneIndex as final fallback when no chapter info available', () => {
            const cell1 = createMockCell('cell-1', 'Content');
            const cell2 = createMockCell('cell-2', 'Content');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells).toHaveLength(3);
            // First milestone should use index 1
            expect(result.source.cells[0].content).toBe('1');
        });

        it('should handle different Bible importer types', () => {
            const bibleTypes = ['usfm', 'paratext', 'ebibleCorpus', 'ebible', 'maculaBible', 'macula', 'biblica', 'obs', 'pdf', 'indesign'];

            bibleTypes.forEach((importerType) => {
                const cell1 = createMockCell('GEN 1:1', 'Content');
                const cell2 = createMockCell('GEN 2:1', 'Content');
                const notebookPair = createMockNotebookPair(
                    [cell1, cell2],
                    [cell1, cell2],
                    importerType
                );

                const result = addMilestoneCellsToNotebookPair(notebookPair);

                // Should add milestones (Bible-type behavior)
                expect(result.source.cells.length).toBeGreaterThan(2);
                expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
            });
        });
    });

    describe('UUID consistency', () => {
        it('should use same UUID for milestone cells in source and codex', () => {
            const cell1 = createMockCell('GEN 1:1', 'Content');
            const cell2 = createMockCell('GEN 2:1', 'Content');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [cell1, cell2],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // All milestone cells should have matching UUIDs
            const sourceMilestones = result.source.cells.filter(
                (c) => c.metadata?.type === CodexCellTypes.MILESTONE
            );
            const codexMilestones = result.codex.cells.filter(
                (c) => c.metadata?.type === CodexCellTypes.MILESTONE
            );

            expect(sourceMilestones.length).toBe(codexMilestones.length);
            sourceMilestones.forEach((sourceMilestone, index) => {
                expect(sourceMilestone.id).toBe(codexMilestones[index].id);
                expect(sourceMilestone.metadata?.id).toBe(
                    codexMilestones[index].metadata?.id
                );
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle missing codex cells gracefully', () => {
            const cell1 = createMockCell('GEN 1:1', 'Content');
            const cell2 = createMockCell('GEN 2:1', 'Content');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2],
                [], // Empty codex cells
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should still create milestones, using source cells as fallback
            expect(result.source.cells.length).toBeGreaterThan(2);
            expect(result.codex.cells.length).toBeGreaterThan(0);
            expect(result.codex.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
        });

        it('should handle mismatched source and codex cell counts', () => {
            const sourceCell1 = createMockCell('GEN 1:1', 'Source 1');
            const sourceCell2 = createMockCell('GEN 2:1', 'Source 2');
            const codexCell1 = createMockCell('GEN 1:1', 'Codex 1');
            // Missing codex cell 2

            const notebookPair = createMockNotebookPair(
                [sourceCell1, sourceCell2],
                [codexCell1],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should handle gracefully
            expect(result.source.cells.length).toBeGreaterThan(2);
            expect(result.codex.cells.length).toBeGreaterThan(1);
        });

        it('should handle cells with same chapter appearing multiple times', () => {
            const cell1 = createMockCell('GEN 1:1', 'Content');
            const cell2 = createMockCell('GEN 1:2', 'Content');
            const cell3 = createMockCell('GEN 1:3', 'Content');
            const cell4 = createMockCell('GEN 1:4', 'Content');
            const notebookPair = createMockNotebookPair(
                [cell1, cell2, cell3, cell4],
                [cell1, cell2, cell3, cell4],
                'biblica'
            );

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should only have one milestone for chapter 1 (at the beginning)
            const milestones = result.source.cells.filter(
                (c) => c.metadata?.type === CodexCellTypes.MILESTONE
            );
            expect(milestones).toHaveLength(1);
            expect(milestones[0].content).toBe('1');
        });

        it('should handle importerType with different casing', () => {
            const cell = createMockCell('GEN 1:1', 'Content');
            const notebookPair = createMockNotebookPair([cell], [cell], 'BIBLICA');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should treat as Bible-type (case-insensitive)
            expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
        });

        it('should handle importerType with whitespace', () => {
            const cell = createMockCell('GEN 1:1', 'Content');
            const notebookPair = createMockNotebookPair([cell], [cell], '  biblica  ');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            // Should treat as Bible-type (trimmed)
            expect(result.source.cells[0].metadata?.type).toBe(CodexCellTypes.MILESTONE);
        });
    });

    describe('Chapter extraction priority', () => {
        it('should prioritize metadata.chapterNumber over metadata.chapter', () => {
            const cell = createMockCell('GEN 1:1', 'Content', {
                chapterNumber: 5,
                chapter: 1,
            });
            const notebookPair = createMockNotebookPair([cell], [cell], 'biblica');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells[0].content).toBe('5');
        });

        it('should prioritize metadata.chapter over metadata.data.chapter', () => {
            const cell = createMockCell('GEN 1:1', 'Content', {
                chapter: 3,
                data: { chapter: 1 },
            });
            const notebookPair = createMockNotebookPair([cell], [cell], 'usfm');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells[0].content).toBe('3');
        });

        it('should prioritize metadata.data.chapter over cellId extraction', () => {
            const cell = createMockCell('GEN 1:1', 'Content', {
                data: { chapter: 7 },
            });
            const notebookPair = createMockNotebookPair([cell], [cell], 'biblica');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells[0].content).toBe('7');
        });

        it('should use cellId extraction when metadata is not available', () => {
            const cell = createMockCell('GEN 5:10', 'Content');
            const notebookPair = createMockNotebookPair([cell], [cell], 'biblica');

            const result = addMilestoneCellsToNotebookPair(notebookPair);

            expect(result.source.cells[0].content).toBe('5');
        });
    });
});

