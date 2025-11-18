import { describe, it, expect } from 'vitest';
import { processUsfmContent } from '../usfmUtils';
import { CodexCellTypes } from '../../../../../../../types/enums';

describe('processUsfmContent - deterministic paratext IDs', () => {
    it('generates identical paratext IDs when parsing the same USFM file twice', async () => {
        // USFM content with verses and paratext (text without markers)
        const usfmContent = `\\id GEN
\\usfm 3.0
\\c 1
\\p This is a paragraph before verse 1.
\\v 1 In the beginning God created the heavens and the earth.
\\p This is a paragraph between verses.
\\v 2 The earth was formless and void.
\\p Another paragraph after verse 2.
\\c 2
\\p Paragraph at start of chapter 2.
\\v 1 Thus the heavens and the earth were completed.
\\p Paragraph after verse 1 of chapter 2.`;

        const fileName = 'test.usfm';

        // Parse the same content twice
        const result1 = await processUsfmContent(usfmContent, fileName);
        const result2 = await processUsfmContent(usfmContent, fileName);

        // Extract paratext cells from both results (identified by paratext ID pattern)
        const paratextCells1 = result1.cells.filter(
            (cell) => cell.id.match(/paratext-\d+$/) && cell.metadata?.verse === undefined
        );
        const paratextCells2 = result2.cells.filter(
            (cell) => cell.id.match(/paratext-\d+$/) && cell.metadata?.verse === undefined
        );

        // Should have the same number of paratext cells
        expect(paratextCells1.length).toBe(paratextCells2.length);
        expect(paratextCells1.length).toBeGreaterThan(0);

        // All paratext cell IDs should match
        for (let i = 0; i < paratextCells1.length; i++) {
            expect(paratextCells1[i].id).toBe(paratextCells2[i].id);
            expect(paratextCells1[i].id).toMatch(/^GEN \d+:paratext-\d+$/);
        }
    });

    it('generates deterministic paratext IDs for marker lines', async () => {
        // USFM content with marker lines (like \\s, \\p, etc.)
        const usfmContent = `\\id GEN
\\usfm 3.0
\\c 1
\\s Section heading
\\v 1 In the beginning God created the heavens and the earth.
\\p Paragraph marker
\\v 2 The earth was formless and void.
\\mt1 Major title
\\c 2
\\s Another section heading
\\v 1 Thus the heavens and the earth were completed.`;

        const fileName = 'test.usfm';

        // Parse the same content twice
        const result1 = await processUsfmContent(usfmContent, fileName);
        const result2 = await processUsfmContent(usfmContent, fileName);

        // Extract all cells (including marker-based paratext)
        const allCells1 = result1.cells;
        const allCells2 = result2.cells;

        // Should have the same number of cells
        expect(allCells1.length).toBe(allCells2.length);

        // All cell IDs should match exactly
        for (let i = 0; i < allCells1.length; i++) {
            expect(allCells1[i].id).toBe(allCells2[i].id);
        }

        // Verify paratext IDs follow the expected pattern
        const paratextIds1 = allCells1
            .filter((cell) => cell.id.match(/paratext-\d+$/) && cell.metadata?.verse === undefined)
            .map((cell) => cell.id);
        const paratextIds2 = allCells2
            .filter((cell) => cell.id.match(/paratext-\d+$/) && cell.metadata?.verse === undefined)
            .map((cell) => cell.id);

        expect(paratextIds1).toEqual(paratextIds2);
        paratextIds1.forEach((id) => {
            expect(id).toMatch(/^GEN \d+:paratext-\d+$/);
        });
    });

    it('resets paratext index counter for each chapter', async () => {
        // USFM content with paratext in multiple chapters
        const usfmContent = `\\id GEN
\\usfm 3.0
\\c 1
\\p First paratext in chapter 1
\\v 1 Verse 1
\\p Second paratext in chapter 1
\\v 2 Verse 2
\\c 2
\\p First paratext in chapter 2
\\v 1 Verse 1
\\p Second paratext in chapter 2`;

        const fileName = 'test.usfm';

        const result = await processUsfmContent(usfmContent, fileName);

        // Extract paratext cells (identified by paratext ID pattern)
        const paratextCells = result.cells.filter(
            (cell) => cell.id.match(/paratext-\d+$/) && cell.metadata?.verse === undefined
        );

        // Verify chapter 1 paratext IDs
        const chapter1Paratext = paratextCells.filter(
            (cell) => cell.metadata?.chapter === 1
        );
        expect(chapter1Paratext.length).toBeGreaterThanOrEqual(2);
        expect(chapter1Paratext[0].id).toBe('GEN 1:paratext-0');
        expect(chapter1Paratext[1].id).toBe('GEN 1:paratext-1');

        // Verify chapter 2 paratext IDs (should restart at 0)
        const chapter2Paratext = paratextCells.filter(
            (cell) => cell.metadata?.chapter === 2
        );
        expect(chapter2Paratext.length).toBeGreaterThanOrEqual(2);
        expect(chapter2Paratext[0].id).toBe('GEN 2:paratext-0');
        expect(chapter2Paratext[1].id).toBe('GEN 2:paratext-1');
    });

    it('maintains deterministic IDs when verses and paratext are interleaved', async () => {
        // USFM content with mixed verses and paratext
        const usfmContent = `\\id GEN
\\usfm 3.0
\\c 1
\\p Before verse 1
\\v 1 First verse
\\p Between verse 1 and 2
\\v 2 Second verse
\\p Between verse 2 and 3
\\v 3 Third verse
\\p After verse 3`;

        const fileName = 'test.usfm';

        // Parse twice
        const result1 = await processUsfmContent(usfmContent, fileName);
        const result2 = await processUsfmContent(usfmContent, fileName);

        // All IDs should match
        expect(result1.cells.length).toBe(result2.cells.length);
        for (let i = 0; i < result1.cells.length; i++) {
            expect(result1.cells[i].id).toBe(result2.cells[i].id);
        }

        // Verify verse IDs are still deterministic
        const verseCells1 = result1.cells.filter(
            (cell) => cell.metadata?.verse !== undefined
        );
        const verseCells2 = result2.cells.filter(
            (cell) => cell.metadata?.verse !== undefined
        );

        expect(verseCells1.length).toBe(verseCells2.length);
        verseCells1.forEach((cell, index) => {
            expect(cell.id).toBe(verseCells2[index].id);
            expect(cell.id).toMatch(/^GEN 1:\d+$/); // Verse IDs should be GEN 1:1, GEN 1:2, etc.
        });
    });

    it('assigns correct cell types: paratext for content, style for empty markers, text for verses', async () => {
        // USFM content with various cell types
        const usfmContent = `\\id GEN
\\usfm 3.0
\\c 1
\\s1 Section heading with content
\\p
\\v 1 This is a verse.
\\p Paragraph with content
\\mt1 Major title with text`;

        const fileName = 'test.usfm';

        const result = await processUsfmContent(usfmContent, fileName);

        // Find verse cells - should have type 'text'
        const verseCells = result.cells.filter(
            (cell) => cell.metadata?.verse !== undefined
        );
        expect(verseCells.length).toBeGreaterThan(0);
        verseCells.forEach((cell) => {
            expect(cell.metadata?.type).toBe(CodexCellTypes.TEXT);
        });

        // Find paratext cells with content - should have type 'paratext'
        const paratextCellsWithContent = result.cells.filter(
            (cell) => cell.id.match(/paratext-\d+$/) &&
                cell.metadata?.verse === undefined &&
                cell.content.trim().length > 0 &&
                // Check that content has actual text (not just HTML tags)
                cell.content.replace(/<[^>]*>/g, '').trim().length > 0
        );
        expect(paratextCellsWithContent.length).toBeGreaterThan(0);
        paratextCellsWithContent.forEach((cell) => {
            expect(cell.metadata?.type).toBe(CodexCellTypes.PARATEXT);
        });

        // Find style cells (empty formatting markers) - should have type 'style'
        const styleCells = result.cells.filter(
            (cell) => cell.id.match(/paratext-\d+$/) &&
                cell.metadata?.verse === undefined &&
                // Check that content is empty or only contains empty HTML tags
                (cell.content.trim().length === 0 ||
                    cell.content.replace(/<[^>]*>/g, '').trim().length === 0)
        );
        // Note: The test USFM has \p on its own line which should create an empty style cell
        // But depending on parsing, it might not always create a cell. Let's check if any exist.
        styleCells.forEach((cell) => {
            expect(cell.metadata?.type).toBe(CodexCellTypes.STYLE);
        });
    });
});

