import * as vscode from "vscode";
import * as verseRefWrapper from "./verseRefWrapper";

// Types for compatibility
interface VrefSearchResult {
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

export async function indexVerseRefsInSourceText() {
    return verseRefWrapper.indexVerseRefsInSourceText();
}

export function searchVerseRefPositionIndex(searchString: string): VrefSearchResult[] {
    return verseRefWrapper.searchVerseRefPositionIndex(searchString);
}
