import * as fs from 'fs/promises';

export async function getCodexCells(filePath: string): Promise<string[]> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const cells = JSON.parse(fileContent).cells;
    return cells.filter((cell: any) => cell.kind === 2 && cell.language === 'scripture')
                .map((cell: any) => cell.value);
}

export function getCleanedCell(cellContent: string): string {
    // Remove HTML tags while preserving newlines
    return cellContent.replace(/<[^>]*>/g, '');
}

export function cleanCodexCell(cellContent: string): string {
    return getCleanedCell(cellContent);
}
