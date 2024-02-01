import * as vscode from "vscode";
import { getLookupStringsForBook } from "../assets/vref";

export const findVerseRef = ({
    verseRef,
    content,
}: {
    verseRef: string;
    content: string;
}) => {
    // Utilizing known abbreviations for book names
    const lookupStrings = getLookupStringsForBook(verseRef.split(" ")[0]);
    let verseRefWasFound = false;
    let verseRefInContentFormat = "";

    // Checking each possible abbreviation or full name in the content
    for (const lookupString of lookupStrings) {
        if (!lookupString) continue; // Skip undefined lookup strings
        const modifiedVerseRef = verseRef.replace(verseRef.split(" ")[0], lookupString);
        const tsvVerseRef = modifiedVerseRef.replace(/(\w+)\s(\d+):(\d+)/, "$1\t$2\t$3");
        if (content.includes(modifiedVerseRef) || content.includes(tsvVerseRef)) {
            verseRefWasFound = true;
            verseRefInContentFormat = content.includes(modifiedVerseRef) ? modifiedVerseRef : tsvVerseRef;
            break; // Stop checking once a match is found
        }
    }

    return {
        verseRefWasFound,
        verseRefInContentFormat,
    };
};

export async function findReferences({
    verseRef,
    fileType,
    usfmOnly,
}: {
    verseRef: string;
    fileType?: string;
    usfmOnly?: boolean;
}) {
    const filesWithReferences: string[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        return filesWithReferences;
    }

    for (const folder of workspaceFolders) {
        const normalizedFileType = fileType?.startsWith(".")
            ? fileType.substring(1)
            : fileType;
        const pattern = normalizedFileType
            ? `resources/**/*.${normalizedFileType}`
            : "resources/**";
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, pattern),
        );

        console.log({ files });

        for (const file of files) {
            const fileUri = vscode.Uri.file(file.fsPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const { verseRefWasFound } = findVerseRef({ verseRef, content });
            if (verseRefWasFound) {
                filesWithReferences.push(file.fsPath);
            }
        }
    }

    return filesWithReferences;
}

export function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const verseRefRegex = /(\b[A-Z]{3}\s\d+:\d+\b)/;
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}
