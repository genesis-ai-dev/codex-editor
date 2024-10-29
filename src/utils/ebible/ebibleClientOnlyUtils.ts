import * as vscode from "vscode";
import * as path from "path";
import { EbibleCorpusMetadata } from "./ebibleCorpusUtils";

export async function downloadFile(url: string, outputUri: vscode.Uri): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    await vscode.workspace.fs.writeFile(outputUri, new Uint8Array(buffer));
}

export async function ensureVrefList(tempDirectory: vscode.Uri): Promise<vscode.Uri> {
    const vrefUri = vscode.Uri.joinPath(tempDirectory, "vref.txt");
    try {
        await vscode.workspace.fs.stat(vrefUri);
    } catch {
        const vrefUrl = "https://raw.githubusercontent.com/BibleNLP/ebible/main/metadata/vref.txt";
        await downloadFile(vrefUrl, vrefUri);
    }
    return vrefUri;
}

export async function downloadEBibleText(
    languageMetadata: EbibleCorpusMetadata,
    tempDirectory: vscode.Uri
): Promise<vscode.Uri> {
    const fileName = `${languageMetadata.file}.txt`;
    const targetDataUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/refs/heads/main/corpus/${fileName}`;
    const targetUri = vscode.Uri.joinPath(tempDirectory, fileName);

    try {
        console.log(`Attempting to download from: ${targetDataUrl}`);
        await downloadFile(targetDataUrl, targetUri);
        return targetUri;
    } catch (error) {
        console.error("Download failed:", error);
        throw error;
    }
}

export async function zipBibleFiles(
    vrefPath: vscode.Uri,
    downloadedFile: vscode.Uri,
    saveDirectory: vscode.Uri
): Promise<vscode.Uri> {
    const zippedContent: string[] = [];

    const vrefs = await vscode.workspace.fs.readFile(vrefPath).then((content) => {
        return content.toString().split("\n");
    });
    const downloadedFileContent = await vscode.workspace.fs
        .readFile(downloadedFile)
        .then((content) => {
            return content.toString().split("\n");
        });

    for (let i = 0; i < downloadedFileContent.length; i++) {
        zippedContent.push(`${vrefs[i]} ${downloadedFileContent[i]}`);
    }

    const zipPath = vscode.Uri.joinPath(saveDirectory, "ebible.zip");
    await vscode.workspace.fs.writeFile(
        zipPath,
        new TextEncoder().encode(zippedContent.join("\n"))
    );
    
    return zipPath;
}
