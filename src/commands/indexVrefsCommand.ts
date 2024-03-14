import * as vscode from "vscode";
import { getFullListOfOrgVerseRefs } from "../utils";
import MiniSearch, { SearchResult } from "minisearch";

const miniSearch = new MiniSearch({
    fields: ["vref"], // fields to index for full-text search
    storeFields: ["id", "vref", "uri", "position"], // fields to return with search results
});
interface VrefIndex {
    id: string;
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

interface VrefSearchResult extends SearchResult {
    vref: string;
    uri: string;
    position: { line: number; character: number };
}
export async function indexVerseRefsInSourceText() {
    const orgVerseRefsSet = new Set(getFullListOfOrgVerseRefs()); // Convert list to a Set for faster lookup
    try {
        const files = await vscode.workspace.findFiles(
            // "resources/**",
            "**/*.bible",
        ); // Adjust the glob pattern to match your files
        // Use Promise.all to process files in parallel
        await Promise.all(
            files.map(async (file) => {
                try {
                    const linesToIndex: VrefIndex[] = [];
                    const document =
                        await vscode.workspace.openTextDocument(file);
                    const text = document.getText();
                    const lines = text.split(/\r?\n/);
                    lines.forEach((line, lineIndex) => {
                        // Extract potential verse references from the line
                        const potentialVrefs = extractPotentialVrefs(line); // Implement this based on your pattern
                        potentialVrefs.forEach((vref) => {
                            if (orgVerseRefsSet.has(vref)) {
                                // Add to documentsToIndex
                                linesToIndex.push({
                                    id: `${file.fsPath.replace(
                                        /[^a-zA-Z0-9-_]/g,
                                        "_",
                                    )}_${lineIndex}_${line.indexOf(vref)}`,
                                    vref: vref,
                                    uri: file.fsPath,
                                    position: {
                                        line: lineIndex,
                                        character: line.indexOf(vref),
                                    },
                                });
                            }
                        });
                    });
                    await miniSearch.addAllAsync(linesToIndex);
                } catch (error) {
                    console.error(
                        `Error processing file ${file.fsPath}: ${error}`,
                    );
                }
            }),
        );

        vscode.window.showInformationMessage(
            "Indexing of verse references completed successfully.",
        );
    } catch (error) {
        console.error(`Error indexing documents: ${error}`);
    }
}

function extractPotentialVrefs(line: string): string[] {
    const verseRefPattern = /\b(?:[1-3]\s)?[A-Za-z]+(?:\s\d+:\d+(-\d+)?)/g;
    // fixme: Ryder, expand this search
    const matches = line.match(verseRefPattern);
    return matches || [];
}

export async function searchVerseRefPositionIndex(searchString: string) {
    try {
        // Normalize the search string to match the format used in indexing
        const normalizedSearchString = searchString;
        // Perform the search with a filter for exact matches on the 'vref' field
        const results: VrefSearchResult[] = miniSearch.search(
            normalizedSearchString,
            {
                filter: (result) => result.vref === normalizedSearchString,
            },
        ) as any;
        console.log(results);
        return results;
    } catch (error: any) {
        vscode.window.showErrorMessage(
            "Error fetching task status: " + error.message,
        );
    }
}
