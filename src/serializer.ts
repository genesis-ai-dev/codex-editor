import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";

/**
 * An ultra-minimal sample provider that lets the user type in JSON, and then
 * outputs JSON cells. The outputs are transient and not saved to notebook file on disk.
 */

interface RawNotebookData {
    cells: RawNotebookCell[];
    metadata?: any;
}

interface RawNotebookCell {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    editable?: boolean;
    metadata?: any;
}

export class CodexContentSerializer implements vscode.NotebookSerializer {
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
            raw = { cells: [], metadata: {} };
        }
        // Create array of Notebook cells for the VS Code API from file contents
        const cells = raw.cells.map((item) => {
            const cell = new vscode.NotebookCellData(
                item.kind,
                item.value,
                item.language,
            );
            cell.metadata = item.metadata || {}; // Ensure metadata is included if available
            if (item.metadata && item.metadata.id) {
                // @ts-expect-error: metadata is added above
                cell.metadata.id = item.metadata.id;
            }
            return cell;
        });

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata || {};
        return notebookData;
    }

    public async serializeNotebook(
        data: vscode.NotebookData,
        token: vscode.CancellationToken,
    ): Promise<Uint8Array> {
        // Map the Notebook data into the format we want to save the Notebook data as
        const contents: RawNotebookData = { 
            cells: [],
            metadata: data.metadata
        };

        for (const cell of data.cells) {
            contents.cells.push({
                kind: cell.kind,
                language: cell.languageId,
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
