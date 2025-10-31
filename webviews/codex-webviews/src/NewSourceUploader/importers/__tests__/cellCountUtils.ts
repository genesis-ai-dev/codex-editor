import { NotebookPair } from '../../types/common';

/**
 * Asserts that source and codex notebooks have matching cell counts
 */
export function assertMatchingCellCounts(pair: NotebookPair): void {
    const count = (notebook: typeof pair.source) => {
        const parts = { topLevel: 0, paratext: 0, child: 0 };
        for (const cell of notebook.cells) {
            const isParatext = cell.metadata?.type === 'paratext';
            const isChild = cell.metadata?.isChild === true || cell.id.split(':').length > 2;
            if (isParatext) parts.paratext++;
            else if (isChild) parts.child++;
            else parts.topLevel++;
        }
        return parts;
    };

    const s = count(pair.source);
    const c = count(pair.codex);

    if (s.topLevel !== c.topLevel || s.paratext !== c.paratext || s.child !== c.child || pair.source.cells.length !== pair.codex.cells.length) {
        throw new Error(`Cell count mismatch: topLevel ${s.topLevel}/${c.topLevel}, paratext ${s.paratext}/${c.paratext}, child ${s.child}/${c.child}, total ${pair.source.cells.length}/${pair.codex.cells.length}`);
    }
}

