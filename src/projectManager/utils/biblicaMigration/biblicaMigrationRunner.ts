/**
 * Runs the Biblica translation migration across a project.
 *
 * Pairs each Biblica notebook imported with the pre-June-2026 importer against its
 * freshly re-imported counterpart, moves the translations over, restores the
 * source's style markup where that can be done without guessing, and turns on
 * HTML structure enforcement so the editor's Resolve action can finish the rest.
 *
 * Nothing is deleted: the old notebooks stay on disk, and translations that have
 * no cell in the re-import are written to the report so they remain recoverable.
 */

import * as vscode from "vscode";
import { CodexContentSerializer } from "../../../serializer";
import type { CustomNotebookCellData } from "../../../../types";
import {
    collectUnmatchedTranslations,
    formatBiblicaMigrationReport,
    migrateBiblicaNotebook,
    type BiblicaNotebookMigrationReport,
} from "./index";

const REPORT_DIRECTORY = ".project";
const REPORT_BASE_NAME = "biblica-translation-migration";

interface BiblicaNotebook {
    codexUri: vscode.Uri;
    sourceUri: vscode.Uri;
    baseName: string;
    displayName: string;
    /** SHA-256 of the IDML the notebook was imported from. */
    originalHash: string;
    originalFileName: string;
    /** Cells only carry segment structure when imported by the current importer. */
    hasSegmentedSourceMarkup: boolean;
    translatedCellCount: number;
    metadata: Record<string, unknown>;
    sourceCells: CustomNotebookCellData[];
    codexCells: CustomNotebookCellData[];
}

export interface BiblicaMigrationPair {
    old: BiblicaNotebook;
    new: BiblicaNotebook;
    pairedBy: "originalHash" | "baseName";
}

export interface BiblicaMigrationRunOptions {
    /** Report only; no file is modified. */
    dryRun: boolean;
    /** Re-wrap migrated translations with the source's tags where deterministic. */
    applySourceStructure: boolean;
    /** Turn on `enforceHtmlStructure` so the editor offers Resolve on the rest. */
    enableStructureEnforcement: boolean;
    author: string;
}

export interface BiblicaMigrationRunResult {
    reports: BiblicaNotebookMigrationReport[];
    reportUri?: vscode.Uri;
    pairsMigrated: number;
}

const readNotebook = async (
    uri: vscode.Uri,
    serializer: CodexContentSerializer
): Promise<{ cells: CustomNotebookCellData[]; metadata: Record<string, unknown>; }> => {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const notebook = await serializer.deserializeNotebook(
        bytes,
        new vscode.CancellationTokenSource().token
    );
    return {
        cells: (notebook.cells ?? []) as CustomNotebookCellData[],
        metadata: (notebook.metadata ?? {}) as unknown as Record<string, unknown>,
    };
};

const getStringField = (metadata: Record<string, unknown>, field: string): string => {
    const value = metadata[field];
    return typeof value === "string" ? value : "";
};

/**
 * Tells a re-imported notebook from a pre-rewrite one.
 *
 * The current importer emits one `span.idml-segment` per IDML content slot inside a
 * `p.indesign-paragraph`; the old importer emitted a single `span.idml-char` inside a
 * `p.biblica-paragraph`. Both put `data-segment-index` in their markup — the old one
 * on the paragraph, the new one on each span — so only the span class separates them.
 */
const hasSegmentedMarkup = (cells: CustomNotebookCellData[]): boolean =>
    cells.some((cell) => typeof cell.value === "string" && cell.value.includes("idml-segment"));

const countTranslated = (cells: CustomNotebookCellData[]): number =>
    cells.filter((cell) => {
        if (cell.metadata?.type === "milestone") return false;
        return (cell.value ?? "").replace(/<[^>]*>/g, "").trim().length > 0;
    }).length;

/** Strip the uuid/counter suffixes the importer adds when a notebook name is taken. */
const normalizeBaseName = (baseName: string): string =>
    baseName
        .replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "")
        .replace(/[-_]?notes$/i, "")
        .replace(/[-_]?biblica$/i, "")
        .replace(/[-_]\d+$/, "")
        .replace(/\s*\(\d+\)$/, "")
        .toLowerCase();

export async function findBiblicaNotebooks(): Promise<BiblicaNotebook[]> {
    const serializer = new CodexContentSerializer();
    const codexUris = await vscode.workspace.findFiles("files/target/*.codex");
    const notebooks: BiblicaNotebook[] = [];

    for (const codexUri of codexUris) {
        const baseName = codexUri.path.split("/").pop()!.replace(/\.codex$/i, "");
        let codex: { cells: CustomNotebookCellData[]; metadata: Record<string, unknown>; };
        try {
            codex = await readNotebook(codexUri, serializer);
        } catch (error) {
            console.warn(`[BiblicaMigration] Could not read ${codexUri.fsPath}:`, error);
            continue;
        }

        const importerType = getStringField(codex.metadata, "importerType");
        const corpusMarker = getStringField(codex.metadata, "corpusMarker");
        if (importerType !== "biblica" && corpusMarker !== "biblica") {
            continue;
        }

        const sourceUri = vscode.Uri.joinPath(
            codexUri,
            "..",
            "..",
            "..",
            ".project",
            "sourceTexts",
            `${baseName}.source`
        );
        let source: { cells: CustomNotebookCellData[]; metadata: Record<string, unknown>; };
        try {
            source = await readNotebook(sourceUri, serializer);
        } catch (error) {
            console.warn(`[BiblicaMigration] Missing source for ${baseName}:`, error);
            continue;
        }

        notebooks.push({
            codexUri,
            sourceUri,
            baseName,
            displayName: getStringField(codex.metadata, "fileDisplayName") || baseName,
            originalHash: getStringField(codex.metadata, "originalHash"),
            originalFileName: getStringField(codex.metadata, "originalFileName"),
            hasSegmentedSourceMarkup: hasSegmentedMarkup(source.cells),
            translatedCellCount: countTranslated(codex.cells),
            metadata: codex.metadata,
            sourceCells: source.cells,
            codexCells: codex.cells,
        });
    }

    return notebooks;
}

/**
 * Pair each old notebook with the re-import of the same IDML. Prefers the IDML
 * hash; falls back to the notebook base name, which is needed when the re-imported
 * file is not byte-identical to the one originally imported.
 */
export function pairBiblicaNotebooks(notebooks: BiblicaNotebook[]): {
    pairs: BiblicaMigrationPair[];
    unpaired: BiblicaNotebook[];
} {
    // Destination notebooks are the empty re-imports (new markup, no translations yet).
    // Source notebooks are anything that still holds translations — including a volume
    // that was already on the new importer (ACT-REV in the Portuguese notes project)
    // and is being re-imported again.
    const oldNotebooks = notebooks.filter((notebook) => notebook.translatedCellCount > 0);
    const newNotebooks = notebooks.filter(
        (notebook) => notebook.hasSegmentedSourceMarkup && notebook.translatedCellCount === 0
    );

    const pairs: BiblicaMigrationPair[] = [];
    const claimed = new Set<string>();

    const claim = (
        oldNotebook: BiblicaNotebook,
        candidate: BiblicaNotebook | undefined,
        pairedBy: BiblicaMigrationPair["pairedBy"]
    ): boolean => {
        if (!candidate || claimed.has(candidate.baseName)) return false;
        claimed.add(candidate.baseName);
        pairs.push({ old: oldNotebook, new: candidate, pairedBy });
        return true;
    };

    for (const oldNotebook of oldNotebooks) {
        const byHash = oldNotebook.originalHash
            ? newNotebooks.find((candidate) => candidate.originalHash === oldNotebook.originalHash)
            : undefined;
        if (claim(oldNotebook, byHash, "originalHash")) continue;

        const oldKey = normalizeBaseName(oldNotebook.baseName);
        const byName = newNotebooks.find(
            (candidate) => normalizeBaseName(candidate.baseName) === oldKey
        );
        claim(oldNotebook, byName, "baseName");
    }

    const pairedOldNames = new Set(pairs.map((pair) => pair.old.baseName));
    const unpaired = oldNotebooks.filter((notebook) => !pairedOldNames.has(notebook.baseName));

    return { pairs, unpaired };
}

const writeNotebookCells = async (
    uri: vscode.Uri,
    cells: CustomNotebookCellData[],
    metadata: Record<string, unknown>,
    serializer: CodexContentSerializer
): Promise<void> => {
    const bytes = await serializer.serializeNotebook(
        { cells, metadata } as never,
        new vscode.CancellationTokenSource().token
    );
    await vscode.workspace.fs.writeFile(uri, bytes);
};

const setEnforcementFlag = async (
    notebook: BiblicaNotebook,
    serializer: CodexContentSerializer
): Promise<void> => {
    const source = await readNotebook(notebook.sourceUri, serializer);
    await writeNotebookCells(
        notebook.sourceUri,
        source.cells,
        { ...source.metadata, enforceHtmlStructure: true },
        serializer
    );
};

export async function runBiblicaTranslationMigration(
    pairs: BiblicaMigrationPair[],
    options: BiblicaMigrationRunOptions,
    progress?: vscode.Progress<{ message?: string; increment?: number; }>
): Promise<BiblicaMigrationRunResult> {
    const serializer = new CodexContentSerializer();
    const reports: BiblicaNotebookMigrationReport[] = [];
    const carryOver: Record<string, unknown> = {};
    let pairsMigrated = 0;

    for (const pair of pairs) {
        progress?.report({
            message: `${pair.new.displayName} (${pair.old.translatedCellCount} translations)`,
            increment: 100 / pairs.length,
        });

        const { cells, report } = migrateBiblicaNotebook({
            notebookName: pair.new.displayName,
            oldSourceCells: pair.old.sourceCells,
            oldCodexCells: pair.old.codexCells,
            newSourceCells: pair.new.sourceCells,
            newCodexCells: pair.new.codexCells,
            options: {
                author: options.author,
                applySourceStructure: options.applySourceStructure,
            },
        });

        reports.push(report);
        carryOver[pair.new.displayName] = collectUnmatchedTranslations(report);

        if (options.dryRun) continue;

        await writeNotebookCells(
            pair.new.codexUri,
            cells,
            {
                ...pair.new.metadata,
                ...(options.enableStructureEnforcement ? { enforceHtmlStructure: true } : {}),
            },
            serializer
        );
        if (options.enableStructureEnforcement) {
            await setEnforcementFlag(pair.new, serializer);
        }
        pairsMigrated += 1;
    }

    const reportUri = await writeReport(reports, carryOver, options);
    return { reports, reportUri, pairsMigrated };
}

const writeReport = async (
    reports: BiblicaNotebookMigrationReport[],
    carryOver: Record<string, unknown>,
    options: BiblicaMigrationRunOptions
): Promise<vscode.Uri | undefined> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return undefined;

    const totals = reports.reduce(
        (accumulator, report) => ({
            migrated: accumulator.migrated + report.translationsMigrated,
            unmatched: accumulator.unmatched + report.unmatchedTranslated.length,
            resolved: accumulator.resolved + report.structureResolved,
            unresolved: accumulator.unresolved + report.structureUnresolved.length,
        }),
        { migrated: 0, unmatched: 0, resolved: 0, unresolved: 0 }
    );

    const markdown = [
        `# Biblica translation migration${options.dryRun ? " (dry run)" : ""}`,
        "",
        `Run at ${new Date().toISOString()} by ${options.author}.`,
        "",
        `- notebooks migrated: ${reports.length}`,
        `- translations migrated: ${totals.migrated}`,
        `- translations without a cell in the re-import: ${totals.unmatched}`,
        `- styles restored automatically: ${totals.resolved}`,
        `- cells still needing the editor's Resolve action: ${totals.unresolved}`,
        "",
        ...reports.map((report) => `${formatBiblicaMigrationReport(report)}\n`),
    ].join("\n");

    const directory = vscode.Uri.joinPath(workspaceFolder.uri, REPORT_DIRECTORY);
    await vscode.workspace.fs.createDirectory(directory);

    const markdownUri = vscode.Uri.joinPath(directory, `${REPORT_BASE_NAME}.md`);
    await vscode.workspace.fs.writeFile(markdownUri, new TextEncoder().encode(markdown));

    // The unmatched translations only exist in the old notebooks from here on, so
    // they are also written out as data for whoever decides what to do with them.
    await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, `${REPORT_BASE_NAME}-unmatched.json`),
        new TextEncoder().encode(JSON.stringify(carryOver, null, 2))
    );

    return markdownUri;
};

/** Command entry point: pick pairs, confirm, migrate, then show the report. */
export async function migrateBiblicaTranslationsCommand(author: string): Promise<void> {
    const notebooks = await findBiblicaNotebooks();
    if (notebooks.length === 0) {
        vscode.window.showWarningMessage("No Biblica notebooks found in this project.");
        return;
    }

    const { pairs, unpaired } = pairBiblicaNotebooks(notebooks);
    if (pairs.length === 0) {
        vscode.window.showWarningMessage(
            "No old/new Biblica notebook pairs found. Re-import the IDML files with the " +
            "Biblica importer first, then run this again."
        );
        return;
    }

    const selected = await vscode.window.showQuickPick(
        pairs.map((pair) => ({
            label: `${pair.old.displayName} → ${pair.new.displayName}`,
            description: `${pair.old.translatedCellCount} translations, paired by ${pair.pairedBy}`,
            detail: `${pair.old.baseName}.codex → ${pair.new.baseName}.codex`,
            picked: true,
            pair,
        })),
        {
            canPickMany: true,
            title: "Migrate Biblica translations into the re-imported notebooks",
            placeHolder: unpaired.length > 0
                ? `${unpaired.length} old notebook(s) have no re-import yet and will be skipped`
                : "Confirm the notebook pairs to migrate",
        }
    );

    if (!selected || selected.length === 0) return;

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Migrating Biblica translations",
            cancellable: false,
        },
        (progress) =>
            runBiblicaTranslationMigration(
                selected.map((item) => item.pair),
                {
                    dryRun: false,
                    applySourceStructure: true,
                    enableStructureEnforcement: true,
                    author,
                },
                progress
            )
    );

    const totalUnresolved = result.reports.reduce(
        (sum, report) => sum + report.structureUnresolved.length,
        0
    );
    const message =
        `Migrated ${result.reports.reduce((sum, r) => sum + r.translationsMigrated, 0)} ` +
        `translation(s) into ${result.pairsMigrated} notebook(s). ` +
        `${totalUnresolved} cell(s) still need the editor's Resolve action.`;

    const openReport = "Open report";
    const choice = await vscode.window.showInformationMessage(message, openReport);
    if (choice === openReport && result.reportUri) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(result.reportUri));
    }
}
