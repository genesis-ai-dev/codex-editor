import * as vscode from "vscode";

export async function getCodexCells(filePath: string): Promise<string[]> {
    const fileUri = vscode.Uri.file(filePath);
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const cells = JSON.parse(new TextDecoder().decode(fileContent)).cells;
    return cells
        .filter((cell: any) => cell.kind === 2 && cell.language === "scripture")
        .map((cell: any) => cell.value);
}

export function getCleanedCell(cellContent: string): string {
    // Remove HTML tags while preserving newlines
    return cellContent.replace(/<[^>]*>/g, "");
}

export function cleanCodexCell(cellContent: string): string {
    return getCleanedCell(cellContent);
}
