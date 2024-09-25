// FIXME: Any time you programmatically modify the notebook, you should also be updating the notebook's memory/edit history.

import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import { CustomNotebookData, CustomNotebookCellData } from "../types";

export interface CodexNotebookDocument extends vscode.NotebookDocument {
    cells: CustomNotebookCellData[];
    metadata: { [key: string]: any };
    getCells(): vscode.NotebookCell[];
    getCellIndex(cell: vscode.NotebookCell): number;
    cellAt(index: number): vscode.NotebookCell;
    cellsUpTo(index: number): vscode.NotebookCell[];
}

interface RawNotebookData {
    cells: CustomNotebookCellData[];
    metadata?: { [key: string]: any };
}

export class CodexContentSerializer implements vscode.NotebookSerializer {
    public readonly label: string = "Codex Translation Notebook Serializer";

    async deserializeNotebook(
        data: Uint8Array,
        token: vscode.CancellationToken
    ): Promise<CustomNotebookData> {
        const contents = new TextDecoder().decode(data); // convert to String
        console.log("contents sdafdsfa", { contents });
        // Read file contents
        let raw: RawNotebookData;
        try {
            raw = <RawNotebookData>JSON.parse(contents);
        } catch {
            raw = { cells: [], metadata: {} };
        }
        // Create array of Notebook cells for the VS Code API from file contents
        const cells = raw.cells.map((item) => {
            const cell = new vscode.NotebookCellData(item.kind, item.value, item.languageId);
            cell.metadata = item.metadata || {}; // Ensure metadata is included if available
            if (item.metadata && item.metadata.id) {
                cell.metadata.id = item.metadata.id;
            }
            return cell;
        });

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata || {};
        return notebookData as CustomNotebookData;
    }

    async serializeNotebook(
        data: vscode.NotebookData,
        token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        // Map the Notebook data into the format we want to save the Notebook data as
        const contents: RawNotebookData = {
            cells: [],
            metadata: data.metadata,
        };

        for (const cell of data.cells) {
            contents.cells.push({
                kind: cell.kind,
                languageId: cell.languageId,
                value: cell.value,
                metadata: {
                    ...cell.metadata,
                    id: cell.metadata?.id,
                },
            });
        }

        return new TextEncoder().encode(JSON.stringify(contents, null, 4));
    }
}

export class CodexNotebookReader {
    private notebookDocument: vscode.NotebookDocument | undefined;

    constructor(private readonly uri: vscode.Uri) {}

    private async ensureNotebookDocument(): Promise<void> {
        if (!this.notebookDocument) {
            this.notebookDocument = await vscode.workspace.openNotebookDocument(this.uri);
        }
    }

    async getCells(): Promise<CustomNotebookCellData[]> {
        await this.ensureNotebookDocument();
        return this.notebookDocument!.getCells() as unknown as CustomNotebookCellData[];
    }

    async getCellIndex(props: { cell?: vscode.NotebookCell; id?: string }): Promise<number> {
        const { cell, id } = props;
        const cells = await this.getCells();
        return cells.findIndex(
            (c) => c.metadata?.id === cell?.metadata?.id || c.metadata?.id === id
        );
    }

    async cellAt(index: number): Promise<CustomNotebookCellData | undefined> {
        const cells = await this.getCells();
        return cells[index];
    }

    async cellsUpTo(index: number): Promise<CustomNotebookCellData[]> {
        const cells = await this.getCells();
        return cells.slice(0, index);
    }
}
