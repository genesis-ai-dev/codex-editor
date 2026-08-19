/**
 * Biblica translation migration: re-attaches translations from a Biblica notebook
 * imported before the June 2026 importer rewrite onto a freshly re-imported pair,
 * then restores the source's IDML style markup on the migrated text.
 */

import type { CustomNotebookCellData } from "../../../../types";
import {
    getAppliedParagraphStyle,
    hasTranslation,
    isTranslatableCell,
    matchBiblicaCells,
    normalizeCellText,
    type BiblicaMatchResult,
    type BiblicaUnmatchedCell,
} from "./biblicaCellMatching";
import {
    migrateBiblicaTranslations,
    type BiblicaMigrationOptions,
    type BiblicaMigrationResult,
    type BiblicaStructureOutcome,
} from "./biblicaTranslationMigration";

export * from "./biblicaCellMatching";
export * from "./biblicaTranslationMigration";

export interface BiblicaNotebookMigrationInput {
    /** Label used in the report (usually the notebook's display name). */
    notebookName: string;
    oldSourceCells: CustomNotebookCellData[];
    oldCodexCells: CustomNotebookCellData[];
    newSourceCells: CustomNotebookCellData[];
    newCodexCells: CustomNotebookCellData[];
    options: BiblicaMigrationOptions;
}

export interface BiblicaNotebookMigrationReport {
    notebookName: string;
    /** Old cells that held a translation before the migration. */
    oldTranslatedCells: number;
    newContentCells: number;
    translationsMigrated: number;
    matchedByParagraphIdentity: number;
    matchedBySourceText: number;
    /** Translations with no cell to move to; grouped for a readable summary. */
    unmatchedTranslated: BiblicaUnmatchedCell[];
    unmatchedByParagraphStyle: Array<{ appliedParagraphStyle: string; count: number; }>;
    newCellsWithoutTranslation: number;
    structureResolved: number;
    structureAlreadyMatching: number;
    structureUnresolved: BiblicaStructureOutcome[];
}

export interface BiblicaNotebookMigrationOutcome {
    /** Re-imported codex cells with the translations applied. */
    cells: CustomNotebookCellData[];
    report: BiblicaNotebookMigrationReport;
}

const countTranslatedCells = (
    sourceCells: CustomNotebookCellData[],
    codexCells: CustomNotebookCellData[]
): number => {
    const codexById = new Map<string, CustomNotebookCellData>();
    for (const cell of codexCells) {
        const id = cell.metadata?.id;
        if (typeof id === "string") codexById.set(id, cell);
    }
    return sourceCells.filter((cell) => {
        if (!isTranslatableCell(cell)) return false;
        const id = cell.metadata?.id;
        return typeof id === "string" && hasTranslation(codexById.get(id));
    }).length;
};

const groupUnmatchedByStyle = (
    unmatched: BiblicaUnmatchedCell[]
): Array<{ appliedParagraphStyle: string; count: number; }> => {
    const counts = new Map<string, number>();
    for (const cell of unmatched) {
        counts.set(cell.appliedParagraphStyle, (counts.get(cell.appliedParagraphStyle) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([appliedParagraphStyle, count]) => ({ appliedParagraphStyle, count }))
        .sort((a, b) => b.count - a.count);
};

const buildReport = (
    notebookName: string,
    input: BiblicaNotebookMigrationInput,
    matchResult: BiblicaMatchResult,
    migration: BiblicaMigrationResult
): BiblicaNotebookMigrationReport => ({
    notebookName,
    oldTranslatedCells: countTranslatedCells(input.oldSourceCells, input.oldCodexCells),
    newContentCells: input.newSourceCells.filter(isTranslatableCell).length,
    translationsMigrated: migration.translationsMigrated,
    matchedByParagraphIdentity: matchResult.matches.filter(
        (match) => match.strategy === "paragraphIdentity"
    ).length,
    matchedBySourceText: matchResult.matches.filter((match) => match.strategy === "sourceText")
        .length,
    unmatchedTranslated: matchResult.unmatchedTranslated,
    unmatchedByParagraphStyle: groupUnmatchedByStyle(matchResult.unmatchedTranslated),
    newCellsWithoutTranslation: matchResult.newCellsWithoutTranslation.length,
    structureResolved: migration.structureOutcomes.filter((o) => o.reason === "resolved").length,
    structureAlreadyMatching: migration.structureOutcomes.filter(
        (o) => o.reason === "alreadyMatching"
    ).length,
    structureUnresolved: migration.structureOutcomes.filter(
        (o) => o.reason === "noDeterministicFix"
    ),
});

/**
 * Match and migrate one notebook pair. Pure: the input cells are never mutated.
 */
export function migrateBiblicaNotebook(
    input: BiblicaNotebookMigrationInput
): BiblicaNotebookMigrationOutcome {
    const matchResult = matchBiblicaCells({
        oldSourceCells: input.oldSourceCells,
        oldCodexCells: input.oldCodexCells,
        newSourceCells: input.newSourceCells,
    });

    const migration = migrateBiblicaTranslations({
        oldCodexCells: input.oldCodexCells,
        newSourceCells: input.newSourceCells,
        newCodexCells: input.newCodexCells,
        matches: matchResult.matches,
        options: input.options,
    });

    return {
        cells: migration.cells,
        report: buildReport(input.notebookName, input, matchResult, migration),
    };
}

/** Human-readable summary of a notebook migration, for the report file and logs. */
export function formatBiblicaMigrationReport(report: BiblicaNotebookMigrationReport): string {
    const lines: string[] = [
        `## ${report.notebookName}`,
        "",
        `- translations in old notebook: ${report.oldTranslatedCells}`,
        `- cells in re-imported notebook: ${report.newContentCells}`,
        `- translations migrated: ${report.translationsMigrated}` +
        ` (${report.matchedByParagraphIdentity} by paragraph identity,` +
        ` ${report.matchedBySourceText} by source text)`,
        `- re-imported cells left untranslated: ${report.newCellsWithoutTranslation}`,
        `- styles restored from source: ${report.structureResolved}` +
        ` (already matching: ${report.structureAlreadyMatching},` +
        ` needs manual resolve: ${report.structureUnresolved.length})`,
    ];

    if (report.unmatchedTranslated.length > 0) {
        lines.push(
            "",
            `### ${report.unmatchedTranslated.length} translations without a cell in the re-import`,
            "",
            "| count | paragraph style |",
            "| --- | --- |",
            ...report.unmatchedByParagraphStyle.map(
                ({ appliedParagraphStyle, count }) => `| ${count} | ${appliedParagraphStyle} |`
            )
        );
    }

    return lines.join("\n");
}

/** Normalized text of the unmatched translations, for the sidecar carry-over file. */
export function collectUnmatchedTranslations(
    report: BiblicaNotebookMigrationReport
): Array<{ appliedParagraphStyle: string; sourceText: string; translation: string; }> {
    return report.unmatchedTranslated.map((cell) => ({
        appliedParagraphStyle: cell.appliedParagraphStyle,
        sourceText: cell.sourceText,
        translation: normalizeCellText(cell.translation),
    }));
}

export { getAppliedParagraphStyle };
