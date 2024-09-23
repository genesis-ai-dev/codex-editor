import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { verseRefRegex } from '../../../../utils/verseRefUtils';
import { StatusBarHandler } from '../statusBarHandler';
import { getWorkSpaceUri } from '../../../../utils';
import { FileData } from './fileReaders';

export interface minisearchDoc {
    id: string;
    vref: string;
    book: string;
    chapter: string;
    verse: string;
    sourceContent: string;
    targetContent: string;
    uri: string;
    line: number;
}

interface TranslationPair {
    sourceText: string;
    targetText: string;
    sourceUri: string;
    targetUri: string;
}

interface TranslationPairsIndex {
    [vref: string]: TranslationPair[];
}

export async function createTranslationPairsIndex(
    context: vscode.ExtensionContext,
    translationPairsIndex: MiniSearch<minisearchDoc>,
    sourceFiles: FileData[],
    targetFiles: FileData[],
    force: boolean = false
): Promise<void> {
    console.time("createTranslationPairsIndex");
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Translation Pairs Index. Returning empty index.');
        return;
    }

    // Index all documents using the files passed in
    const index = await indexAllDocuments(sourceFiles, targetFiles);

    // Clear existing index
    translationPairsIndex.removeAll();

    // Add new documents to the index
    for (const [vref, pairs] of Object.entries(index)) {
        for (const pair of pairs) {
            const doc: minisearchDoc = {
                id: `${pair.sourceUri}:${vref}`,
                vref,
                book: vref.split(' ')[0],
                chapter: vref.split(' ')[1].split(':')[0],
                verse: vref.split(':')[1],
                sourceContent: pair.sourceText,
                targetContent: pair.targetText,
                uri: pair.sourceUri,
                line: -1 // We don't have line numbers in this context
            };
            translationPairsIndex.add(doc);
        }
    }

    console.log('Translation pairs index created with', translationPairsIndex.documentCount, 'documents');
    console.timeEnd("createTranslationPairsIndex");



    async function indexAllDocuments(
        sourceFiles: FileData[],
        targetFiles: FileData[]
    ): Promise<TranslationPairsIndex> {
        const index: TranslationPairsIndex = {};
        const targetCellsMap = new Map<string, { text: string; uri: string }>();

        // First, index all target cells
        for (const targetFile of targetFiles) {
            for (const cell of targetFile.cells) {
                if (cell.metadata?.type === 'text' && cell.metadata?.id && cell.value.trim() !== '') {
                    targetCellsMap.set(cell.metadata.id, { text: cell.value, uri: targetFile.uri.toString() });
                }
            }
        }

        // Now, index source cells only if they have a corresponding target cell
        for (const sourceFile of sourceFiles) {
            for (const sourceCell of sourceFile.cells) {
                if (sourceCell.metadata?.type === 'text' && sourceCell.metadata?.id && sourceCell.value.trim() !== '') {
                    const vref = sourceCell.metadata.id;
                    const targetCell = targetCellsMap.get(vref);

                    if (targetCell) {
                        if (!index[vref]) {
                            index[vref] = [];
                        }
                        index[vref].push({
                            sourceText: sourceCell.value,
                            targetText: targetCell.text,
                            sourceUri: sourceFile.uri.toString(),
                            targetUri: targetCell.uri,
                        });
                    }
                }
            }
        }

        return index;
    }

    async function indexDocument(document: vscode.TextDocument, targetVerseMap: Map<string, string>, translationPairsIndex: MiniSearch<minisearchDoc>): Promise<number> {
        const uri = document.uri.toString();
        let indexedCount = 0;
        const batchSize = 1000;
        let batch: minisearchDoc[] = [];

        const processBatch = () => {
            if (batch.length > 0) {
                try {
                    translationPairsIndex.addAll(batch);
                    indexedCount += batch.length;
                } catch (error) {
                    if (error instanceof Error && error.message.includes('duplicate ID')) {
                        processBatchRecursively(batch);
                    } else {
                        throw error;
                    }
                } batch = [];
            }
        };

        const processBatchRecursively = (currentBatch: minisearchDoc[]) => {
            if (currentBatch.length === 0) return;
            const smallerBatch = currentBatch.filter((_, index) => index % 10 === 0);
            try {
                translationPairsIndex.addAll(smallerBatch);
                indexedCount += smallerBatch.length;
            } catch (error) {
                if (error instanceof Error && error.message.includes('duplicate ID')) {
                    for (const doc of smallerBatch) {
                        try {
                            translationPairsIndex.add(doc);
                            indexedCount++;
                        } catch (innerError) {
                            if (innerError instanceof Error && innerError.message.includes('duplicate ID')) {
                                console.info(`Skipped duplicate ID: ${doc.id}`);
                            } else {
                                throw innerError;
                            }
                        }
                    }
                } else {
                    throw error;
                }
            }
            processBatchRecursively(currentBatch.filter((_, index) => index % 10 !== 0));
        };

        const lines = document.getText().split('\n'); for (let i = 0; i < lines.length; i++) {
            const indexedDoc = indexLine(lines[i], i, uri, targetVerseMap);
            if (indexedDoc) {
                batch.push(indexedDoc);
                if (batch.length >= batchSize) {
                    processBatch();
                }
            }
        }

        processBatch(); // Process any remaining documents in the batch
        return indexedCount;
    }

    function indexLine(line: string, lineIndex: number, uri: string, targetVerseMap: Map<string, string>): minisearchDoc | null {
        const match = line.match(verseRefRegex);
        if (match) {
            const [vref] = match;
            // Only index if there's a corresponding target verse
            if (targetVerseMap.has(vref)) {
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':');
                const sourceContent = line.substring(match.index! + match[0].length).trim();
                const targetContent = targetVerseMap.get(vref)!;
                const id = `${uri}:${lineIndex}:${vref}`;
                return {
                    id,
                    vref,
                    book,
                    chapter,
                    verse,
                    sourceContent,
                    targetContent,
                    uri,
                    line: lineIndex
                };
            }
        }
        return null;
    }

    // Subscriptions

    context.subscriptions.push(
        // vscode.workspace.onDidChangeTextDocument(debouncedUpdateIndex),
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            if (doc.languageId === 'scripture' || doc.fileName.endsWith('.codex')) {
                await indexDocument(doc, new Map<string, string>(), translationPairsIndex);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(async (doc) => {
            if (doc.languageId === 'scripture' || doc.fileName.endsWith('.codex')) {
                await indexDocument(doc, new Map<string, string>(), translationPairsIndex);
            }
        })
    );

}