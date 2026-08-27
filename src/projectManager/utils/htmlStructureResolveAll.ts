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
import {
    compareHtmlStructure,
    tryDeterministicStructureFix,
} from "../../../sharedUtils/htmlStructureUtils";
import {
    fillSourceTemplateWithTranslation,
    isSafeForcedRewrite,
} from "../../../sharedUtils/htmlStructureTemplateFill";
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
    resolvedTemplateFill: number;
    unresolved: number;
    missingContent: number;
}

export interface HtmlStructureResolveRunResult {
    files: HtmlStructureResolveFileSummary[];
    cancelled: boolean;
}

/**
 * `llm` reshapes the translation and asks a model when that fails, which can
 * leave cells unresolved. `force` instead rebuilds the translation inside the
 * source's own tags, which always matches and never calls a model.
 */
export type HtmlStructureResolveMode = "llm" | "force";

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
    resolvedTemplateFill: 0,
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
    mode: HtmlStructureResolveMode = "llm",
    progress?: vscode.Progress<{ message?: string; increment?: number; }>,
    token?: vscode.CancellationToken
): Promise<HtmlStructureResolveRunResult> {
    const serializer = new CodexContentSerializer();
    // Force mode is fully offline, so the LLM config is only fetched when needed.
    let config: CompletionConfig | undefined;
    if (mode === "llm") {
        const { fetchCompletionConfig } = await import("../../utils/llmUtils");
        config = await fetchCompletionConfig();
    }
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
            let resolvedContent: string | null = null;

            if (mode === "llm") {
                const outcome = await resolveHtmlStructurePair(mismatch.sourceHtml, liveHtml, config);
                recordOutcome(summary, outcome);
                if (outcome.status === "resolved") {
                    resolvedContent = outcome.content;
                }
            } else {
                const deterministic = tryDeterministicStructureFix(mismatch.sourceHtml, liveHtml);
                if (deterministic !== null) {
                    summary.resolvedDeterministic += 1;
                    resolvedContent = deterministic;
                } else {
                    const filled = fillSourceTemplateWithTranslation(mismatch.sourceHtml, liveHtml);
                    // Verified rather than trusted: the fill is only written when it
                    // really matches the source and keeps every word of the translation.
                    if (filled && isSafeForcedRewrite(mismatch.sourceHtml, liveHtml, filled.html)) {
                        summary.resolvedTemplateFill += 1;
                        resolvedContent = filled.html;
                    } else {
                        summary.unresolved += 1;
                    }
                }
            }

            if (resolvedContent === null) continue;

            applyResolvedContent(
                pair.codexCells[mismatch.cellIndex],
                resolvedContent,
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
                accumulator.resolved +
                file.resolvedDeterministic +
                file.resolvedLlm +
                file.resolvedTemplateFill,
            rebuilt: accumulator.rebuilt + file.resolvedTemplateFill,
            unresolved: accumulator.unresolved + file.unresolved + file.missingContent,
            filesTouched: accumulator.filesTouched + (
                file.resolvedDeterministic + file.resolvedLlm + file.resolvedTemplateFill > 0 ? 1 : 0
            ),
        }),
        { resolved: 0, rebuilt: 0, unresolved: 0, filesTouched: 0 }
    );
    const prefix = result.cancelled ? "Stopped early. " : "";
    const rebuiltNote = totals.rebuilt > 0
        ? ` ${totals.rebuilt} were rebuilt from the source template.`
        : "";
    const remainingNote = totals.unresolved > 0
        ? ` ${totals.unresolved} still need Resolve — run the command again to continue.`
        : "";
    return (
        `${prefix}Resolved ${totals.resolved} cell(s) in ${totals.filesTouched} notebook(s).` +
        `${rebuiltNote}${remainingNote}`
    );
};

const runAcrossProject = async (
    author: string,
    mode: HtmlStructureResolveMode
): Promise<void> => {
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

    const forced = mode === "force";
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
            title: forced
                ? "Force-resolve HTML structure from the source template"
                : "Resolve HTML structure mismatches",
            placeHolder: forced
                ? "Rebuilds each translation inside the source's tags. No model calls."
                : "Choose notebooks to resolve. Safe to stop and re-run later.",
        }
    );
    if (!selected || selected.length === 0) return;

    if (forced) {
        const cells = selected.reduce((sum, item) => {
            const match = withMismatches.find((entry) => entry.notebook === item.notebook);
            return sum + (match?.mismatches.length ?? 0);
        }, 0);
        const proceed = await vscode.window.showWarningMessage(
            `Force-resolve ${cells} cell(s)?`,
            {
                modal: true,
                detail:
                    "Each translation is rewritten into the source paragraph's own tags, so the structure always matches. " +
                    "Every word of the translation is kept and the previous value stays in the cell's edit history, but " +
                    "where a translation is split across styled runs is a best guess. Inline bold/italic that the source " +
                    "does not have is dropped.",
            },
            "Force Resolve"
        );
        if (proceed !== "Force Resolve") return;
    }

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: forced ? "Force-resolving HTML structure" : "Resolving HTML structure",
            cancellable: true,
        },
        (progress, token) =>
            runHtmlStructureResolveAll(
                selected.map((item) => item.notebook),
                author,
                mode,
                progress,
                token
            )
    );

    vscode.window.showInformationMessage(formatRunMessage(result));
};

/** Deterministic reshaping first, then the LLM. Can leave cells unresolved. */
export async function resolveHtmlStructureAcrossProjectCommand(author: string): Promise<void> {
    await runAcrossProject(author, "llm");
}

/** Rebuilds every remaining mismatch from the source template. Never uses the LLM. */
export async function forceResolveHtmlStructureAcrossProjectCommand(author: string): Promise<void> {
    await runAcrossProject(author, "force");
}
