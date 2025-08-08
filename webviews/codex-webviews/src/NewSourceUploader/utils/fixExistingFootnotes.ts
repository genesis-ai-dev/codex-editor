/**
 * Utility to fix footnotes in existing imported content
 * 
 * This can be used to retroactively fix footnotes that were imported
 * in the wrong format before the post-processing was implemented.
 */

import { postProcessImportedFootnotes } from './postProcessFootnotes';

/**
 * Fixes footnotes in a cell's content
 */
export const fixCellFootnotes = (cellContent: string): string => {
    if (!cellContent) return cellContent;

    // Check if this content has mammoth.js style footnotes that need fixing
    const hasMammothFootnotes = /<sup><a>\[\d+\]<\/a><\/sup>/.test(cellContent);
    const hasGenericSupFootnotes = /<sup>\d+<\/sup>/.test(cellContent) &&
        !/<sup class="footnote-marker"/.test(cellContent);

    if (hasMammothFootnotes || hasGenericSupFootnotes) {
        console.log('Fixing footnotes in cell content');
        return postProcessImportedFootnotes(cellContent);
    }

    return cellContent;
};

/**
 * Fixes footnotes in an array of cells
 */
export const fixCellsFootnotes = (cells: Array<{ cellContent: string;[key: string]: any; }>): void => {
    cells.forEach(cell => {
        if (cell.cellContent) {
            const fixedContent = fixCellFootnotes(cell.cellContent);
            if (fixedContent !== cell.cellContent) {
                cell.cellContent = fixedContent;
                console.log(`Fixed footnotes in cell: ${cell.cellMarkers?.[0] || 'unknown'}`);
            }
        }
    });
};

/**
 * Checks if content contains footnotes that need fixing
 */
export const needsFootnoteFix = (content: string): boolean => {
    if (!content) return false;

    const hasMammothFootnotes = /<sup><a>\[\d+\]<\/a><\/sup>/.test(content);
    const hasGenericSupFootnotes = /<sup>\d+<\/sup>/.test(content) &&
        !/<sup class="footnote-marker"/.test(content);

    return hasMammothFootnotes || hasGenericSupFootnotes;
};
