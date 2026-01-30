import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { mergeDuplicateCellsUsingResolverLogic } from "../projectManager/utils/merge/resolvers";
import { EditMapUtils } from "../utils/editMapUtils";
import { EditType } from "../../types/enums";
import { getAuthApi } from "../extension";
import type { CustomNotebookCellData } from "../../types";
import type { MigrationMatchResult } from "./types";

const cloneCell = (cell: CustomNotebookCellData): CustomNotebookCellData => {
    return JSON.parse(JSON.stringify(cell)) as CustomNotebookCellData;
};

const getCellId = (cell: CustomNotebookCellData): string | null => {
    const cellId = cell.metadata?.id;
    return typeof cellId === "string" && cellId.trim() ? cellId.trim() : null;
};

const addMigrationEdit = (
    cell: CustomNotebookCellData,
    timestamp: number,
    author: string
): void => {
    if (!cell.metadata) {
        cell.metadata = { id: (cell as any).id, type: (cell as any).type, edits: [] };
    }
    if (!cell.metadata.edits) {
        cell.metadata.edits = [];
    }
    cell.metadata.edits.push({
        editMap: EditMapUtils.value(),
        value: cell.value,
        timestamp,
        type: EditType.MIGRATION,
        author,
    });
};

const getLatestValueEditTimestamp = (cell: CustomNotebookCellData): number | null => {
    const edits = cell.metadata?.edits ?? [];
    const valueEdits = edits.filter((edit) => EditMapUtils.isValue(edit.editMap));
    if (valueEdits.length === 0) {
        return null;
    }
    const latest = valueEdits.reduce((max, edit) => Math.max(max, edit.timestamp), 0);
    return Number.isFinite(latest) ? latest : null;
};

const ensureValueEditForMerge = (
    cell: CustomNotebookCellData,
    author: string
): void => {
    const latestValueTimestamp = getLatestValueEditTimestamp(cell);
    if (latestValueTimestamp !== null) {
        return;
    }
    addMigrationEdit(cell, 0, author);
};

export async function applyMigrationToTargetFile(params: {
    fromFileUri: vscode.Uri;
    toFileUri: vscode.Uri;
    matches: MigrationMatchResult[];
    forceOverride: boolean;
}): Promise<{ updated: number; skipped: number; }> {
    const { fromFileUri, toFileUri, matches, forceOverride } = params;
    const serializer = new CodexContentSerializer();

    let currentUser = "anonymous";
    try {
        const authApi = getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        currentUser = userInfo?.username || "anonymous";
    } catch {
        // keep anonymous
    }

    const [fromBytes, toBytes] = await Promise.all([
        vscode.workspace.fs.readFile(fromFileUri),
        vscode.workspace.fs.readFile(toFileUri),
    ]);

    const [fromNotebook, toNotebook] = await Promise.all([
        serializer.deserializeNotebook(fromBytes, new vscode.CancellationTokenSource().token),
        serializer.deserializeNotebook(toBytes, new vscode.CancellationTokenSource().token),
    ]);

    const fromCellsById = new Map<string, CustomNotebookCellData>();
    fromNotebook.cells.forEach((cell: CustomNotebookCellData) => {
        const cellId = getCellId(cell);
        if (cellId) {
            fromCellsById.set(cellId, cell);
        }
    });

    const toCellsById = new Map<string, { index: number; cell: CustomNotebookCellData }>();
    toNotebook.cells.forEach((cell: CustomNotebookCellData, index: number) => {
        const cellId = getCellId(cell);
        if (cellId) {
            toCellsById.set(cellId, { index, cell });
        }
    });

    let updated = 0;
    let skipped = 0;
    const migrationTimestamp = Date.now();

    for (const match of matches) {
        const fromCell = fromCellsById.get(match.fromCellId);
        const toEntry = toCellsById.get(match.toCellId);
        if (!fromCell || !toEntry) {
            skipped += 1;
            continue;
        }

        const fromCellCopy = cloneCell(fromCell);
        const toCellCopy = cloneCell(toEntry.cell);

        if (forceOverride) {
            addMigrationEdit(fromCellCopy, migrationTimestamp, currentUser);
        } else {
            ensureValueEditForMerge(fromCellCopy, currentUser);
        }

        const mergedCell = mergeDuplicateCellsUsingResolverLogic([toCellCopy, fromCellCopy]);
        toNotebook.cells[toEntry.index] = mergedCell;
        updated += 1;
    }

    if (updated > 0) {
        const content = await serializer.serializeNotebook(
            toNotebook,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(toFileUri, content);
    }

    return { updated, skipped };
}
