import * as vscode from "vscode";
import * as path from "path";
import { FileData, readSourceAndTargetFiles } from "./fileReaders";
import { getWorkSpaceUri } from "../../../../utils";
import { tokenizeText } from "../../../../utils/nlpUtils";

export interface FileInfo {
    sourceFile: {
        uri: vscode.Uri;
        fileName: string;
        id: string;
        totalCells: number;
        totalWords: number;
        cells: Array<{
            id?: string;
            type?: string;
            value: string;
            wordCount: number;
        }>;
    };
    codexFile: {
        uri: vscode.Uri;
        fileName: string;
        id: string;
        totalCells: number;
        totalWords: number;
        cells: Array<{
            id?: string;
            type?: string;
            value: string;
            wordCount: number;
        }>;
    };
}

// FIXME: name says it all
const METHOD_SHOULD_BE_STORED_IN_CONFIG = "whitespace_and_punctuation";

/**
 * Count words in text using the tokenizer
 */
function countWords(text: string): number {
    if (!text || text.trim() === "") {
        return 0;
    }

    const words = tokenizeText({
        method: METHOD_SHOULD_BE_STORED_IN_CONFIG,
        text: text,
    });

    return words.length;
}

/**
 * Initialize the files index with source and codex file pairs
 */
export async function initializeFilesIndex(): Promise<Map<string, FileInfo>> {
    // Create a new map for file information
    const result = new Map<string, FileInfo>();

    try {
        // Get source and target files
        const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();

        // Create a map of source files by ID for quick lookup
        const sourceFileMap = new Map<string, FileData>();
        for (const sourceFile of sourceFiles) {
            sourceFileMap.set(sourceFile.id, sourceFile);
        }

        // Process each target (codex) file and find its source pair
        for (const codexFile of targetFiles) {
            const sourceFile = sourceFileMap.get(codexFile.id);

            if (sourceFile) {
                let sourceWordCount = 0;
                let codexWordCount = 0;

                // Process source file cells
                const sourceCells = sourceFile.cells.map((cell) => {
                    const wordCount = countWords(cell.value);
                    sourceWordCount += wordCount;
                    return {
                        id: cell.metadata?.id,
                        type: cell.metadata?.type,
                        value: cell.value,
                        wordCount,
                    };
                });

                // Process codex file cells
                const codexCells = codexFile.cells.map((cell) => {
                    const wordCount = countWords(cell.value);
                    codexWordCount += wordCount;
                    return {
                        id: cell.metadata?.id,
                        type: cell.metadata?.type,
                        value: cell.value,
                        wordCount,
                    };
                });

                // Create file info object
                const fileInfo: FileInfo = {
                    sourceFile: {
                        uri: sourceFile.uri,
                        fileName: path.basename(sourceFile.uri.fsPath),
                        id: sourceFile.id,
                        totalCells: sourceCells.length,
                        totalWords: sourceWordCount,
                        cells: sourceCells,
                    },
                    codexFile: {
                        uri: codexFile.uri,
                        fileName: path.basename(codexFile.uri.fsPath),
                        id: codexFile.id,
                        totalCells: codexCells.length,
                        totalWords: codexWordCount,
                        cells: codexCells,
                    },
                };

                // Add to result map
                result.set(codexFile.id, fileInfo);
            }
        }

        console.log(`Total file pairs indexed: ${result.size}`);
        return result;
    } catch (error) {
        console.error("Error initializing files index:", error);
        return new Map<string, FileInfo>();
    }
}

/**
 * Get a list of all file pairs in the index
 */
export function getFilePairs(filesIndex: Map<string, FileInfo>): FileInfo[] {
    return Array.from(filesIndex.values());
}

/**
 * Get file pair information by ID
 */
export function getFilePairById(
    filesIndex: Map<string, FileInfo>,
    id: string
): FileInfo | undefined {
    return filesIndex.get(id);
}

/**
 * Get total word count statistics
 */
export function getWordCountStats(filesIndex: Map<string, FileInfo>): {
    totalSourceWords: number;
    totalCodexWords: number;
    totalFiles: number;
} {
    let totalSourceWords = 0;
    let totalCodexWords = 0;
    const totalFiles = filesIndex.size;

    filesIndex.forEach((fileInfo) => {
        totalSourceWords += fileInfo.sourceFile.totalWords;
        totalCodexWords += fileInfo.codexFile.totalWords;
    });

    return {
        totalSourceWords,
        totalCodexWords,
        totalFiles,
    };
}
