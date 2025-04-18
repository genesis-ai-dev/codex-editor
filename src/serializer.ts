// FIXME: Any time you programmatically modify the notebook, you should also be updating the notebook's memory/edit history.

import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import { CodexNotebookAsJSONData, CustomNotebookCellData } from "../types";

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
const DEBUG = false;

const debug = (...args: any[]) => {
    if (DEBUG) {
        console.log("CodexContentSerializer", ...args);
    }
};

export class CodexContentSerializer implements vscode.NotebookSerializer {
    public readonly label: string = "Codex Translation Notebook Serializer";

    async deserializeNotebook(
        data: Uint8Array,
        token: vscode.CancellationToken
    ): Promise<CodexNotebookAsJSONData> {
        debug("Deserializing notebook data");
        const contents = new TextDecoder().decode(data); // convert to String
        debug("Contents:", contents);
        // Read file contents
        let raw: RawNotebookData;
        try {
            raw = <RawNotebookData>JSON.parse(contents);
            debug("Successfully parsed notebook contents", { cellCount: raw.cells.length });
            return raw as CodexNotebookAsJSONData;
        } catch {
            debug("Failed to parse notebook contents, creating empty notebook");
            raw = { cells: [], metadata: {} };
        }
        // Create array of Notebook cells for the VS Code API from file contents
        const cells = raw.cells.map((item) => {
            debug("Processing cell", { id: item.metadata?.id, kind: item.kind });
            const cell = new vscode.NotebookCellData(
                item.kind,
                item.value,
                item.languageId || "html"
            );
            cell.metadata = item.metadata || {}; // Ensure metadata is included if available
            if (item.metadata && item.metadata.id) {
                cell.metadata.id = item.metadata.id;
            }
            return cell;
        });
        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata || {};
        debug("Notebook deserialization complete", { cellCount: cells.length });
        return notebookData as CodexNotebookAsJSONData;
    }

    async serializeNotebook(
        data: vscode.NotebookData,
        token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        debug("Serializing notebook data", { cellCount: data.cells.length });
        // Map the Notebook data into the format we want to save the Notebook data as
        const contents: RawNotebookData = {
            cells: [],
            metadata: data.metadata,
        };
        for (const cell of data.cells) {
            debug("Processing cell for serialization", { id: cell.metadata?.id, kind: cell.kind });
            contents.cells.push({
                kind: cell.kind,
                languageId: cell.languageId,
                value: cell.value,
                metadata: {
                    ...cell.metadata,
                    id: cell.metadata?.id,
                    type: cell.metadata?.type || "default", // FIXME: Add a default type if not present, user?
                },
            });
        }

        debug("Notebook serialization complete", { cellCount: contents.cells.length });
        return new TextEncoder().encode(JSON.stringify(contents, null, 4));
    }
}

export class CodexNotebookReader {
    private notebookDocument: vscode.NotebookDocument | undefined;
    private notebookData: CodexNotebookAsJSONData | undefined;
    private isDirectMode: boolean = false;

    constructor(private readonly uri: vscode.Uri) {}

    /**
     * Reads the notebook file directly as JSON without opening it as a VS Code notebook.
     * This is significantly faster for operations that only need to read data.
     */
    private async readNotebookAsJson(): Promise<CodexNotebookAsJSONData> {
        if (this.notebookData) {
            return this.notebookData;
        }

        try {
            const fileData = await vscode.workspace.fs.readFile(this.uri);
            const serializer = new CodexContentSerializer();
            this.notebookData = await serializer.deserializeNotebook(
                fileData,
                new vscode.CancellationTokenSource().token
            );
            this.isDirectMode = true;
            return this.notebookData;
        } catch (error) {
            console.error(`Failed to read notebook as JSON: ${this.uri.fsPath}`, error);
            throw error;
        }
    }

    private async ensureNotebookDocument(): Promise<void> {
        if (!this.notebookDocument) {
            const specificUri = vscode.Uri.parse(this.uri.toString());
            this.notebookDocument = await vscode.workspace.openNotebookDocument(specificUri);
        }
    }

    async getCells(): Promise<vscode.NotebookCell[]> {
        // Try direct JSON access first
        try {
            const data = await this.readNotebookAsJson();
            if (this.notebookDocument) {
                // If we already have the document open, use it
                return this.notebookDocument.getCells();
            }

            // Otherwise, convert JSON cells to a compatible format
            // Note: This returns a compatible interface but not actual NotebookCell objects
            return data.cells.map(
                (cell, index) =>
                    ({
                        document: {
                            getText: () => cell.value,
                            uri: vscode.Uri.parse(`${this.uri.toString()}#cell-${index}`),
                        },
                        kind: cell.kind,
                        metadata: cell.metadata,
                        notebook: { uri: this.uri } as vscode.NotebookDocument,
                        executionSummary: undefined,
                        index,
                        outputs: [],
                    }) as unknown as vscode.NotebookCell
            );
        } catch (error) {
            // Fall back to traditional method
            await this.ensureNotebookDocument();
            return this.notebookDocument!.getCells();
        }
    }

    async getCellIndex(props: { cell?: vscode.NotebookCell; id?: string }): Promise<number> {
        const { cell, id } = props;

        if (this.isDirectMode && this.notebookData) {
            return this.notebookData.cells.findIndex(
                (c) => c.metadata?.id === cell?.metadata?.id || c.metadata?.id === id
            );
        }

        const cells = await this.getCells();
        return cells.findIndex(
            (c) => c.metadata?.id === cell?.metadata?.id || c.metadata?.id === id
        );
    }

    async cellAt(index: number): Promise<vscode.NotebookCell | undefined> {
        const cells = await this.getCells();
        return cells[index];
    }

    async cellsUpTo(index: number): Promise<vscode.NotebookCell[]> {
        const cells = await this.getCells();
        return cells.slice(0, index);
    }

    // Check if the cell is a range marker
    isRangeCell(cell: vscode.NotebookCell | undefined): boolean {
        if (!cell) {
            return false; // If cell is undefined, it's not a range cell
        }

        if (this.isDirectMode) {
            // In direct mode, we need to check the value directly
            return (cell as any).document.getText().trim() === "<range>";
        }

        return cell.document.getText().trim() === "<range>";
    }

    // Get the cell IDs, including subsequent range cells
    async getCellIds(cellIndex: number): Promise<string[]> {
        const cells = await this.getCells();
        const ids: string[] = [];

        // If the current cell is a range marker, find the preceding cell
        if (cellIndex < 0 || cellIndex >= cells.length) {
            return ids; // Return empty array if index is out of bounds
        }

        const currentCell = cells[cellIndex];
        if (currentCell?.metadata?.id) {
            ids.push(currentCell.metadata.id);
        }

        // Check for subsequent range cells
        let nextIndex = cellIndex + 1;
        while (nextIndex < cells.length && this.isRangeCell(cells[nextIndex])) {
            if (cells[nextIndex]?.metadata?.id) {
                ids.push(cells[nextIndex].metadata.id);
            }
            nextIndex++;
        }

        return ids;
    }

    // Get effective cell content, including subsequent range cells
    async getEffectiveCellContent(cellIndex: number): Promise<string> {
        const cells = await this.getCells();
        let content = "";

        if (cellIndex < 0 || cellIndex >= cells.length) {
            return content; // Return empty string if index is out of bounds
        }

        let currentIndex = cellIndex;

        // If the current cell is a range marker, find the preceding cell
        if (this.isRangeCell(cells[currentIndex])) {
            currentIndex = Math.max(0, cellIndex - 1);
        }

        content += cells[currentIndex]?.document.getText() || "";

        // Check for subsequent range markers
        let nextIndex = currentIndex + 1;
        while (nextIndex < cells.length && this.isRangeCell(cells[nextIndex])) {
            content += " " + (cells[nextIndex]?.document.getText() || "");
            nextIndex++;
        }

        return content;
    }
}
