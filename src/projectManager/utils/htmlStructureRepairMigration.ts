import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "@/serializer";
import { EditMapUtils } from "@/utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
import {
    extractPlainTextFromHtml,
    tryDeterministicStructureFix,
} from "../../../sharedUtils/htmlStructureUtils";

const DEBUG_MODE = false;
function debug(...args: unknown[]): void {
    if (DEBUG_MODE) {
        console.log("[HtmlStructureRepair]", ...args);
    }
}

interface ValueEdit {
    editMap: readonly string[];
    value: unknown;
    timestamp: number;
    type: EditType;
    author?: string;
    validatedBy?: unknown[];
}

/**
 * Detect a translation that a faulty structure-resolve overwrote with the
 * source-language text, and return the most recent prior translation from the
 * cell's edit history. Returns null when the cell doesn't fit that damage
 * pattern (e.g. legitimately identical text, or no earlier translation).
 */
export const findRevertedTranslation = (
    sourceHtml: string,
    currentValue: string,
    edits: ValueEdit[],
): string | null => {
    const sourceText = extractPlainTextFromHtml(sourceHtml);
    if (!sourceText || extractPlainTextFromHtml(currentValue) !== sourceText) {
        return null;
    }

    const valueEdits = edits
        .filter(
            (edit) =>
                Array.isArray(edit?.editMap) &&
                edit.editMap.length === 1 &&
                edit.editMap[0] === "value" &&
                typeof edit.value === "string"
        )
        .map((edit) => ({ value: edit.value as string, type: edit.type }));
    if (valueEdits.length < 2) return null;

    // Only treat it as damage when an automated write (the resolver saves with
    // LLM_GENERATION) produced the source-identical value.
    const lastEdit = valueEdits[valueEdits.length - 1];
    if (lastEdit.type !== EditType.LLM_GENERATION) return null;
    if (extractPlainTextFromHtml(lastEdit.value) !== sourceText) return null;

    for (let i = valueEdits.length - 2; i >= 0; i--) {
        const text = extractPlainTextFromHtml(valueEdits[i].value);
        if (text && text !== sourceText) {
            return valueEdits[i].value;
        }
    }
    return null;
};

interface FileRepairResult {
    changed: boolean;
    cellsRepaired: number;
    translationsRestored: number;
}

/**
 * Repair one codex file:
 * 1. restore translations that a faulty resolve reverted to source text, and
 * 2. unwrap spurious bare `<span>` wrappers left by the LLM completion pipeline
 *    (verified against the source cell's HTML structure).
 *
 * All value changes are appended to the cell's edit history as MIGRATION edits.
 */
export const repairHtmlStructureForFile = async (
    fileUri: vscode.Uri
): Promise<FileRepairResult> => {
    const noChange: FileRepairResult = { changed: false, cellsRepaired: 0, translationsRestored: 0 };
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const serializer = new CodexContentSerializer();
        const token = new vscode.CancellationTokenSource().token;
        const notebookData = await serializer.deserializeNotebook(fileContent, token);

        const notebookMetadata = notebookData.metadata as Record<string, any> | undefined;
        if (!notebookMetadata?.enforceHtmlStructure) return noChange;

        const sourcePath = notebookMetadata.sourceFsPath as string | undefined;
        if (!sourcePath) return noChange;

        let sourceNotebook;
        try {
            const sourceContent = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
            sourceNotebook = await serializer.deserializeNotebook(sourceContent, token);
        } catch {
            return noChange;
        }

        const sourceMap = new Map<string, string>();
        for (const cell of sourceNotebook.cells ?? []) {
            const id = cell.metadata?.id;
            if (typeof id === "string" && typeof cell.value === "string") {
                sourceMap.set(id, cell.value);
            }
        }

        let cellsRepaired = 0;
        let translationsRestored = 0;

        for (const cell of notebookData.cells ?? []) {
            if (cell.metadata?.type !== CodexCellTypes.TEXT) continue;
            const cellId = cell.metadata?.id;
            if (typeof cellId !== "string") continue;

            const sourceHtml = sourceMap.get(cellId);
            const originalValue = cell.value;
            if (!sourceHtml || typeof originalValue !== "string" || !originalValue.trim()) {
                continue;
            }

            const edits: ValueEdit[] = cell.metadata.edits ?? (cell.metadata.edits = []);
            let value = originalValue;

            const restored = findRevertedTranslation(sourceHtml, value, edits);
            if (restored !== null) {
                value = restored;
                translationsRestored++;
            }

            const fixed = tryDeterministicStructureFix(sourceHtml, value);
            if (fixed !== null) {
                value = fixed;
            }

            if (value !== originalValue) {
                cell.value = value;
                edits.push({
                    editMap: EditMapUtils.value(),
                    value,
                    timestamp: Date.now(),
                    type: EditType.MIGRATION,
                    author: "system",
                    validatedBy: [],
                });
                cellsRepaired++;
                debug(`Repaired cell ${cellId} in ${path.basename(fileUri.fsPath)}`);
            }
        }

        if (cellsRepaired === 0) return noChange;

        const updatedContent = await serializer.serializeNotebook(notebookData, token);
        await vscode.workspace.fs.writeFile(fileUri, updatedContent);
        return { changed: true, cellsRepaired, translationsRestored };
    } catch (error) {
        console.error(`[HtmlStructureRepair] Error repairing ${fileUri.fsPath}:`, error);
        return noChange;
    }
};

/**
 * Manually triggered repair of HTML-structure artifacts in existing projects:
 * - spurious bare `<span>` wrappers added around LLM translations, and
 * - translations that the old structure resolver overwrote with source text.
 *
 * Deliberately NOT run automatically on activation — not all projects were
 * affected, so the user opts in via the
 * `codex-editor-extension.repairHtmlStructureArtifacts` command. It is safe to
 * run repeatedly: only codex files with `enforceHtmlStructure` enabled are
 * scanned, every fix is verified against the source cell's structure before
 * being applied, and each change is recorded as a MIGRATION edit in the
 * cell's history.
 */
export const repairHtmlStructureArtifacts = async (): Promise<void> => {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage("Open a project before running the HTML structure repair.");
            return;
        }

        const confirmed = await vscode.window.showInformationMessage(
            "Repair HTML structure artifacts?",
            {
                modal: true,
                detail:
                    "Scans codex files that have structure enforcement enabled, removes spurious <span> wrappers left by older versions, and restores translations that were overwritten with source text. " +
                    "Only verified fixes are applied, and every change is recorded in the cell's edit history.",
            },
            "Run Repair"
        );
        if (confirmed !== "Run Repair") return;

        const codexFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolders[0], "**/*.codex")
        );
        if (codexFiles.length === 0) {
            vscode.window.showInformationMessage("No codex files found in this project.");
            return;
        }

        let totalCellsRepaired = 0;
        let totalTranslationsRestored = 0;
        let filesChanged = 0;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Repairing HTML structure artifacts",
                cancellable: false,
            },
            async (progress) => {
                for (let i = 0; i < codexFiles.length; i++) {
                    const file = codexFiles[i];
                    progress.report({
                        message: `Checking ${path.basename(file.fsPath)}`,
                        increment: 100 / codexFiles.length,
                    });
                    const result = await repairHtmlStructureForFile(file);
                    if (result.changed) {
                        filesChanged++;
                        totalCellsRepaired += result.cellsRepaired;
                        totalTranslationsRestored += result.translationsRestored;
                    }
                }
            }
        );

        if (totalCellsRepaired > 0) {
            const restoredNote =
                totalTranslationsRestored > 0
                    ? ` (${totalTranslationsRestored} overwritten translation(s) restored)`
                    : "";
            vscode.window.showInformationMessage(
                `Repaired HTML structure in ${totalCellsRepaired} cell(s) across ${filesChanged} file(s)${restoredNote}.`
            );
        } else {
            vscode.window.showInformationMessage(
                "No HTML structure artifacts found — nothing needed repair."
            );
        }
        debug(
            `HTML structure repair completed: ${totalCellsRepaired} cells across ${filesChanged} files`
        );
    } catch (error) {
        console.error("[HtmlStructureRepair] Repair failed:", error);
        vscode.window.showErrorMessage("HTML structure repair failed. See the console for details.");
    }
};
