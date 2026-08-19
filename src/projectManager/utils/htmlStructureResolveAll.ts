/**
 * Project-wide HTML structure resolver.
 *
 * Walks every notebook with `enforceHtmlStructure` enabled, finds translated
 * cells whose tags still don't match the source (the yellow Resolve state),
 * and runs the same deterministic-then-LLM resolver the editor's Resolve
 * button uses. Safe to re-run: already-matching cells are skipped, so a long
 * pass can be cancelled and continued later.
 */

import * as path from "path";
import * as vscode from "vscode";
import { CodexContentSerializer } from "../../serializer";
import type { CustomNotebookCellData, EditHistory, ValidationEntry } from "../../../types";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import { atomicWriteUriText } from "../../utils/notebookSafeSaveUtils";
import { compareHtmlStructure } from "../../../sharedUtils/htmlStructureUtils";
import {
    resolveHtmlStructurePair,
    type StructureResolveOutcome,
} from "../../providers/codexCellEditorProvider/utils/htmlStructureResolver";
import type { CompletionConfig } from "../../utils/llmUtils";

const CHECKPOINT_EVERY = 8;

export interface HtmlStructureMismatch {
    cellId: string;
    cellIndex: number;
    sourceHtml: string;
    targetHtml: string;
}

export interface HtmlStructureResolveFileSummary {
    displayName: string;
    fileName: string;
    mismatches: number;
    resolvedDeterministic: number;
    resolvedLlm: number;
    unresolved: number;
    missingContent: number;
}

export interface HtmlStructureResolveRunResult {
    files: HtmlStructureResolveFileSummary[];
    cancelled: boolean;
}

interface NotebookPair {
    codexUri: vscode.Uri;
    sourceUri: vscode.Uri;
    displayName: string;
    fileName: string;
    metadata: Record<string, unknown>;
    sourceCells: CustomNotebookCellData[];
    codexCells: CustomNotebookCellData[];
}

const getCellId = (cell: CustomNotebookCellData): string | null => {
    const id = cell.metadata?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
};

const isTranslatableCell = (cell: CustomNotebookCellData): boolean =>
    cell.metadata?.type !== CodexCellTypes.MILESTONE;

const getLastValueEdit = (cell: CustomNotebookCellData): EditHistory | null => {
    const valueEdits = (cell.metadata?.edits ?? []).filter(
        (edit) => edit.editMap && EditMapUtils.isValue(edit.editMap)
    );
    return valueEdits.length > 0 ? valueEdits[valueEdits.length - 1] : null;
};

const cloneValidations = (edit: EditHistory | null): ValidationEntry[] | undefined => {
    const validatedBy = edit?.validatedBy;
    if (!Array.isArray(validatedBy) || validatedBy.length === 0) return undefined;
    return validatedBy.map((entry) => ({ ...entry }));
};

/** Cells that would show the yellow Resolve button in the editor. */
export const collectMismatchedCells = (
    sourceCells: CustomNotebookCellData[],
    codexCells: CustomNotebookCellData[]
): HtmlStructureMismatch[] => {
    const sourceById = new Map<string, string>();
    for (const cell of sourceCells) {
        const id = getCellId(cell);
        if (id && typeof cell.value === "string") {
            sourceById.set(id, cell.value);
        }
    }

    const mismatches: HtmlStructureMismatch[] = [];
    for (let cellIndex = 0; cellIndex < codexCells.length; cellIndex++) {
        const cell = codexCells[cellIndex];
        if (!isTranslatableCell(cell)) continue;
        const cellId = getCellId(cell);
        if (!cellId) continue;
        const sourceHtml = sourceById.get(cellId);
        const targetHtml = cell.value;
        if (!sourceHtml?.trim() || !targetHtml?.trim()) continue;
        if (!compareHtmlStructure(sourceHtml, targetHtml).isMatch) {
            mismatches.push({ cellId, cellIndex, sourceHtml, targetHtml });
        }
    }
    return mismatches;
};

/** Write a verified resolve onto the cell and record it in edit history. */
export const applyResolvedContent = (
    cell: CustomNotebookCellData,
    content: string,
    author: string,
    timestamp: number
): void => {
    const carriedValidations = cloneValidations(getLastValueEdit(cell));
    cell.value = content;
    if (!cell.metadata) return;
    cell.metadata.edits = [
        ...(cell.metadata.edits ?? []),
        {
            editMap: EditMapUtils.value(),
            value: content,
            timestamp,
            type: EditType.LLM_GENERATION,
            author,
            ...(carriedValidations ? { validatedBy: carriedValidations } : {}),
        } as EditHistory,
    ];
};

const emptySummary = (pair: Pick<NotebookPair, "displayName" | "fileName">, mismatches: number): HtmlStructureResolveFileSummary => ({
    displayName: pair.displayName,
    fileName: pair.fileName,
    mismatches,
    resolvedDeterministic: 0,
    resolvedLlm: 0,
    unresolved: 0,
    missingContent: 0,
});

const recordOutcome = (
    summary: HtmlStructureResolveFileSummary,
    outcome: StructureResolveOutcome
): void => {
    if (outcome.status === "resolved" && outcome.method === "deterministic") {
        summary.resolvedDeterministic += 1;
        return;
    }
    if (outcome.status === "resolved" && outcome.method === "llm") {
        summary.resolvedLlm += 1;
        return;
    }
    if (outcome.status === "already-matched") {
        return;
    }
    if (outcome.status === "missing-content") {
        summary.missingContent += 1;
        return;
    }
    summary.unresolved += 1;
};

const getStringField = (metadata: Record<string, unknown>, field: string): string => {
    const value = metadata[field];
    return typeof value === "string" ? value : "";
};

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

const writeNotebook = async (
    uri: vscode.Uri,
    cells: CustomNotebookCellData[],
    metadata: Record<string, unknown>,
    serializer: CodexContentSerializer
): Promise<void> => {
    const bytes = await serializer.serializeNotebook(
        { cells, metadata } as never,
        new vscode.CancellationTokenSource().token
    );
    await atomicWriteUriText(uri, new TextDecoder("utf-8").decode(bytes));
};

const sourceUriForCodex = async (
    codexUri: vscode.Uri,
    metadata: Record<string, unknown>
): Promise<vscode.Uri | undefined> => {
    const sourceFsPath = getStringField(metadata, "sourceFsPath").trim();
    if (sourceFsPath) {
        const fromMetadata = vscode.Uri.file(sourceFsPath);
        try {
            await vscode.workspace.fs.stat(fromMetadata);
            return fromMetadata;
        } catch {
            // Fall through to the conventional sourceTexts path.
        }
    }

    const baseName = path.basename(codexUri.fsPath).replace(/\.codex$/i, "");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return undefined;
    const fallback = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".project",
        "sourceTexts",
        `${baseName}.source`
    );
    try {
        await vscode.workspace.fs.stat(fallback);
        return fallback;
    } catch {
        return undefined;
    }
};

const findEnforcedNotebooks = async (): Promise<NotebookPair[]> => {
    const serializer = new CodexContentSerializer();
    const codexUris = await vscode.workspace.findFiles("files/target/*.codex");
    const notebooks: NotebookPair[] = [];

    for (const codexUri of codexUris) {
        let codex: { cells: CustomNotebookCellData[]; metadata: Record<string, unknown>; };
        try {
            codex = await readNotebook(codexUri, serializer);
        } catch (error) {
            console.warn(`[HtmlStructureResolveAll] Could not read ${codexUri.fsPath}:`, error);
            continue;
        }
        if (codex.metadata.enforceHtmlStructure !== true) continue;

        const sourceUri = await sourceUriForCodex(codexUri, codex.metadata);
        if (!sourceUri) continue;

        let source: { cells: CustomNotebookCellData[]; metadata: Record<string, unknown>; };
        try {
            source = await readNotebook(sourceUri, serializer);
        } catch (error) {
            console.warn(`[HtmlStructureResolveAll] Missing source for ${codexUri.fsPath}:`, error);
            continue;
        }

        const fileName = path.basename(codexUri.fsPath);
        notebooks.push({
            codexUri,
            sourceUri,
            displayName: getStringField(codex.metadata, "fileDisplayName") || fileName.replace(/\.codex$/i, ""),
            fileName,
            metadata: codex.metadata,
            sourceCells: source.cells,
            codexCells: codex.cells,
        });
    }

    return notebooks;
};

export async function runHtmlStructureResolveAll(
    pairs: NotebookPair[],
    author: string,
    progress?: vscode.Progress<{ message?: string; increment?: number; }>,
    token?: vscode.CancellationToken
): Promise<HtmlStructureResolveRunResult> {
    const serializer = new CodexContentSerializer();
    const { fetchCompletionConfig } = await import("../../utils/llmUtils");
    const config: CompletionConfig = await fetchCompletionConfig();
    const files: HtmlStructureResolveFileSummary[] = [];
    const totalMismatches = pairs.reduce(
        (sum, pair) => sum + collectMismatchedCells(pair.sourceCells, pair.codexCells).length,
        0
    );
    let completed = 0;

    for (const pair of pairs) {
        if (token?.isCancellationRequested) {
            return { files, cancelled: true };
        }

        const mismatches = collectMismatchedCells(pair.sourceCells, pair.codexCells);
        const summary = emptySummary(pair, mismatches.length);
        if (mismatches.length === 0) {
            files.push(summary);
            continue;
        }

        let dirty = false;
        for (let i = 0; i < mismatches.length; i++) {
            if (token?.isCancellationRequested) {
                if (dirty) {
                    await writeNotebook(pair.codexUri, pair.codexCells, pair.metadata, serializer);
                }
                files.push(summary);
                return { files, cancelled: true };
            }

            const mismatch = mismatches[i];
            completed += 1;
            progress?.report({
                message: `${pair.displayName} (${completed}/${totalMismatches})`,
                increment: totalMismatches > 0 ? 100 / totalMismatches : 0,
            });

            const liveHtml = pair.codexCells[mismatch.cellIndex]?.value ?? mismatch.targetHtml;
            const outcome = await resolveHtmlStructurePair(mismatch.sourceHtml, liveHtml, config);
            recordOutcome(summary, outcome);
            if (outcome.status !== "resolved") continue;

            applyResolvedContent(
                pair.codexCells[mismatch.cellIndex],
                outcome.content,
                author,
                Date.now()
            );
            dirty = true;

            if ((i + 1) % CHECKPOINT_EVERY === 0) {
                await writeNotebook(pair.codexUri, pair.codexCells, pair.metadata, serializer);
                dirty = false;
            }
        }

        if (dirty) {
            await writeNotebook(pair.codexUri, pair.codexCells, pair.metadata, serializer);
        }
        files.push(summary);
    }

    return { files, cancelled: false };
}

const formatRunMessage = (result: HtmlStructureResolveRunResult): string => {
    const totals = result.files.reduce(
        (accumulator, file) => ({
            resolved:
                accumulator.resolved + file.resolvedDeterministic + file.resolvedLlm,
            unresolved: accumulator.unresolved + file.unresolved + file.missingContent,
            filesTouched: accumulator.filesTouched + (
                file.resolvedDeterministic + file.resolvedLlm > 0 ? 1 : 0
            ),
        }),
        { resolved: 0, unresolved: 0, filesTouched: 0 }
    );
    const prefix = result.cancelled ? "Stopped early. " : "";
    return (
        `${prefix}Resolved ${totals.resolved} cell(s) in ${totals.filesTouched} notebook(s). ` +
        `${totals.unresolved} still need Resolve — run the command again to continue.`
    );
};

/** Command entry point: scan, confirm, resolve, then report remaining mismatches. */
export async function resolveHtmlStructureAcrossProjectCommand(author: string): Promise<void> {
    const notebooks = await findEnforcedNotebooks();
    if (notebooks.length === 0) {
        vscode.window.showWarningMessage(
            "No notebooks with HTML structure enforcement were found in this project."
        );
        return;
    }

    const scanned = notebooks.map((notebook) => ({
        notebook,
        mismatches: collectMismatchedCells(notebook.sourceCells, notebook.codexCells),
    }));
    const withMismatches = scanned.filter((item) => item.mismatches.length > 0);
    if (withMismatches.length === 0) {
        vscode.window.showInformationMessage("Every enforced notebook already matches the source structure.");
        return;
    }

    const selected = await vscode.window.showQuickPick(
        withMismatches.map((item) => ({
            label: item.notebook.displayName,
            description: `${item.mismatches.length} cell(s) to resolve`,
            detail: item.notebook.fileName,
            picked: true,
            notebook: item.notebook,
        })),
        {
            canPickMany: true,
            title: "Resolve HTML structure mismatches",
            placeHolder: "Choose notebooks to resolve. Safe to stop and re-run later.",
        }
    );
    if (!selected || selected.length === 0) return;

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Resolving HTML structure",
            cancellable: true,
        },
        (progress, token) =>
            runHtmlStructureResolveAll(
                selected.map((item) => item.notebook),
                author,
                progress,
                token
            )
    );

    vscode.window.showInformationMessage(formatRunMessage(result));
}
