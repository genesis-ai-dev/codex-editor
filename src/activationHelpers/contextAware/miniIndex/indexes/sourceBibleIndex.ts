import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { verseRefRegex } from '../../../../utils/verseRefUtils';
import { StatusBarHandler } from '../statusBarHandler';
import { SourceVerseVersions } from "../../../../../types";
import { IndexMetadata, loadIndexMetadata, Manifest, saveIndexMetadata } from '.';

export async function createSourceBibleIndex(sourceBibleIndex: MiniSearch<SourceVerseVersions>, statusBarHandler: StatusBarHandler): Promise<MiniSearch<SourceVerseVersions>> {
    const sourceBibleFiles = await vscode.workspace.findFiles('**/*.bible');
    const verseMap = new Map<string, { content: string, versions: string[] }>();

    // Add this
    const metadata: IndexMetadata = await loadIndexMetadata('sourceBibleIndex') || { lastIndexed: 0, fileTimestamps: {} };

    // Batch process files
    const batchSize = 10;
    for (let i = 0; i < sourceBibleFiles.length; i += batchSize) {
        const batch = sourceBibleFiles.slice(i, i + batchSize);
        await Promise.all(batch.map(file => processFile(file, verseMap, metadata)));
    }

    const documents = Array.from(verseMap.entries()).map(([vref, { content, versions }]) => ({
        vref,
        content,
        versions,
    }));

    sourceBibleIndex.addAll(documents);
    console.log(`Source Bible index created with ${sourceBibleIndex.documentCount} verses`);

    // Save updated metadata
    await saveIndexMetadata("sourceBibleIndex", metadata);

    return sourceBibleIndex;
}

async function processFile(file: vscode.Uri, verseMap: Map<string, { content: string, versions: string[] }>, metadata: IndexMetadata): Promise<void> {
    const stats = await vscode.workspace.fs.stat(file);
    if (metadata.fileTimestamps[file.fsPath] && stats.mtime <= metadata.fileTimestamps[file.fsPath]) {
        return; // File hasn't changed, skip processing
    }

    const document = await vscode.workspace.openTextDocument(file);
    const content = document.getText();
    const lines = content.split('\n');
    const version = file.fsPath.split('/').pop()?.replace('.bible', '') || '';

    for (const line of lines) {
        const match = line.match(verseRefRegex);
        if (match) {
            const [vref] = match;
            const verseContent = line.substring(match.index! + match[0].length).trim();
            if (verseContent) {
                if (verseMap.has(vref)) {
                    const existingVerse = verseMap.get(vref)!;
                    existingVerse.versions.push(version);
                } else {
                    verseMap.set(vref, { content: verseContent, versions: [version] });
                }
            }
        }
    }

    metadata.fileTimestamps[file.fsPath] = stats.mtime;
}