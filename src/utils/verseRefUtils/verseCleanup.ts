import * as fs from "fs/promises";

export async function getCodexCells(filePath: string): Promise<string[]> {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const cells = JSON.parse(fileContent).cells;
    return cells
        .filter((cell: any) => (cell.kind === 2 || cell.kind === 1) && cell.language === "scripture") //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
        .map((cell: any) => cell.value);
}

export function getCleanedCell(cellContent: string): string {
    // Remove HTML tags while preserving newlines
    return cellContent.replace(/<[^>]*>/g, "");
}

export function cleanCodexCell(cellContent: string): string {
    return getCleanedCell(cellContent);
}


// Start VS Code //V
// Go in and build the extensions //V
// Go and start the debug thing //V
// check to see if it has the sirens 
// If it has sirens, figure out why something is not being updated.
// Then make sure everything is still exporting correctly. 
// Go and figure out how to submit this as a push and then document it up a bit
// next get started working on the export to html

