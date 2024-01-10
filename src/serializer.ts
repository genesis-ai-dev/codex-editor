import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";

/**
 * An ultra-minimal sample provider that lets the user type in JSON, and then
 * outputs JSON cells. The outputs are transient and not saved to notebook file on disk.
 */

interface RawNotebookData {
    cells: RawNotebookCell[];
}

interface RawNotebookCell {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    editable?: boolean;
    metadata?: any;
}

export class SampleContentSerializer implements vscode.NotebookSerializer {
    public readonly label: string = "My Sample Content Serializer";

    public async deserializeNotebook(
        data: Uint8Array,
        token: vscode.CancellationToken,
    ): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(data); // convert to String

        // Read file contents
        let raw: RawNotebookData;
        try {
            raw = <RawNotebookData>JSON.parse(contents);
        } catch {
            raw = { cells: [] };
        }
        // Create array of Notebook cells for the VS Code API from file contents
        const cells = raw.cells.map(
            (item) =>
                new vscode.NotebookCellData(
                    item.kind,
                    item.value,
                    item.language,
                ),
        );

        const mewCells = cells.map((cell, index) => {
            cell.metadata = raw.cells[index].metadata;
            return cell;
        });
        return new vscode.NotebookData(mewCells);
    }

    public async serializeNotebook(
        data: vscode.NotebookData,
        token: vscode.CancellationToken,
    ): Promise<Uint8Array> {
        // Map the Notebook data into the format we want to save the Notebook data as
        const contents: RawNotebookData = { cells: [] };

        for (const cell of data.cells) {
            contents.cells.push({
                kind: cell.kind,
                language: cell.languageId,
                value: cell.value,
                metadata: cell.metadata,
            });
        }

        return new TextEncoder().encode(JSON.stringify(contents));
    }
}
