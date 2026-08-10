import * as vscode from "vscode";
import path from "path";
import type { Timestamps } from "../../../../types";
import type { CodexCellDocument } from "../codexDocument";
import { getCorrespondingSourceUri } from "../../../utils/codexNotebookUtils";

export type SourceCellMapEntry = {
    content: string;
    versions: string[];
    timestamps?: Timestamps;
};

export function resolveSourceUriForTargetDocument(
    targetDocument: CodexCellDocument
): vscode.Uri | null {
    if (targetDocument.uri.fsPath.toLowerCase().endsWith(".source")) {
        return targetDocument.uri;
    }

    const fromPair = getCorrespondingSourceUri(targetDocument.uri);
    if (fromPair) {
        return fromPair;
    }

    const metadata = targetDocument.getNotebookMetadata();
    if (metadata?.sourceFsPath) {
        return metadata.sourceFsPath.startsWith("file:")
            ? vscode.Uri.parse(metadata.sourceFsPath)
            : vscode.Uri.file(metadata.sourceFsPath);
    }

    return null;
}

export async function getSourceTimestampsForCellIds(
    targetDocument: CodexCellDocument,
    cellIds: string[]
): Promise<Record<string, Timestamps>> {
    if (cellIds.length === 0) {
        return {};
    }

    const sourceUri = resolveSourceUriForTargetDocument(targetDocument);
    if (!sourceUri) {
        return {};
    }

    try {
        const bytes = await vscode.workspace.fs.readFile(sourceUri);
        const notebook = JSON.parse(new TextDecoder().decode(bytes)) as {
            cells?: Array<{ metadata?: { id?: string; data?: Timestamps; }; }>;
        };

        const cellIdSet = new Set(cellIds);
        const result: Record<string, Timestamps> = {};

        for (const cell of notebook.cells ?? []) {
            const id = cell.metadata?.id;
            if (!id || !cellIdSet.has(id)) {
                continue;
            }

            const data = cell.metadata?.data;
            if (
                !data ||
                typeof data.startTime !== "number" ||
                typeof data.endTime !== "number"
            ) {
                continue;
            }

            result[id] = {
                startTime: data.startTime,
                endTime: data.endTime,
            };
        }

        return result;
    } catch (error) {
        console.warn(
            `Failed to read source timestamps from ${sourceUri.fsPath}:`,
            error
        );
        return {};
    }
}

export async function enrichSourceCellMapWithTimestamps(
    targetDocument: CodexCellDocument,
    sourceCellMap: Record<string, SourceCellMapEntry>
): Promise<Record<string, SourceCellMapEntry>> {
    const cellIds = Object.keys(sourceCellMap);
    if (cellIds.length === 0) {
        return sourceCellMap;
    }

    const timestampsByCellId = await getSourceTimestampsForCellIds(
        targetDocument,
        cellIds
    );

    const enriched: Record<string, SourceCellMapEntry> = {};
    for (const [cellId, entry] of Object.entries(sourceCellMap)) {
        enriched[cellId] = {
            ...entry,
            timestamps: timestampsByCellId[cellId],
        };
    }

    return enriched;
}

export async function getSourceCellTimestamps(
    targetDocument: CodexCellDocument,
    cellId: string
): Promise<Timestamps | undefined> {
    const timestampsByCellId = await getSourceTimestampsForCellIds(
        targetDocument,
        [cellId]
    );
    return timestampsByCellId[cellId];
}
