import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { verseRefRegex } from '../../../../utils/verseRefUtils';
import { StatusBarHandler } from '../statusBarHandler';
import { SourceVerseVersions } from "../../../../../types";

export async function createSourceBibleIndex(sourceBibleIndex: MiniSearch<SourceVerseVersions>, statusBarHandler: StatusBarHandler): Promise<MiniSearch<SourceVerseVersions>> {
    const sourceBibleFiles = await vscode.workspace.findFiles('**/*.bible');
    const verseMap = new Map<string, { content: string, versions: string[] }>();

    for (const file of sourceBibleFiles) {
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
    }

    const documents = Array.from(verseMap.entries()).map(([vref, { content, versions }]) => ({
        vref,
        content,
        versions,
    }));

    console.log('documents added to sourceBibleIndex:', documents);

    sourceBibleIndex.addAll(documents);
    console.log(`Source Bible index created with ${sourceBibleIndex.documentCount} verses`);

    return sourceBibleIndex;
}