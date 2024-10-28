import * as vscode from "vscode";
import * as path from "path";
import { EbibleCorpusMetadata } from "./ebibleCorpusUtils";

export async function downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), new Uint8Array(buffer));
}

export async function ensureVrefList(workspaceRoot: string): Promise<string> {
    const vrefPath = path.join(workspaceRoot, ".project", "sourceTexts", "vref.txt");
    const vrefUri = vscode.Uri.file(vrefPath);
    try {
        await vscode.workspace.fs.stat(vrefUri);
    } catch {
        const vrefUrl = "https://raw.githubusercontent.com/BibleNLP/ebible/main/metadata/vref.txt";
        await downloadFile(vrefUrl, vrefPath);
    }
    return vrefPath;
}

export async function downloadEBibleText(
    languageMetadata: EbibleCorpusMetadata,
    workspaceRoot: string
): Promise<string> {
    const fileName = languageMetadata.file;
    // Update URL to use the correct GitHub raw content path format
    const targetDataUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/refs/heads/main/corpus/${fileName}.txt`;
    const targetPath = path.join(workspaceRoot, ".project", "sourceTexts", fileName);
    
    try {
        console.log(`Attempting to download from: ${targetDataUrl}`);
        const response = await fetch(targetDataUrl);
        if (!response.ok) {
            throw new Error(`Failed to download Bible text: ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(targetPath), 
            new Uint8Array(buffer)
        );
        return targetPath;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to download Bible text: ${error}`);
        throw error;
    }
}
