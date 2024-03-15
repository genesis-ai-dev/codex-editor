import * as vscode from "vscode";
import { getLookupStringsForBook } from "./verseData";

export const findVerseRef = ({
    verseRef,
    content,
}: {
    verseRef: string;
    content: string;
}) => {
    // Utilize expanded strings for lookup
    const lookupStrings = getLookupStringsForBook(verseRef.split(" ")[0]);
    let verseRefWasFound = false;
    let verseRefInContentFormat = "";

    // Check each lookup string to see if it's present in the content
    for (const lookupString of lookupStrings) {
        const tsvVerseRef = `${lookupString}\t${verseRef.split(" ")[1]}\t${
            verseRef.split(" ")[2]
        }`;
        if (content.includes(verseRef) || content.includes(tsvVerseRef)) {
            verseRefWasFound = true;
            verseRefInContentFormat = content.includes(verseRef)
                ? verseRef
                : tsvVerseRef;
            break;
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

export const verseRefRegex = /(\b[A-Z, 1-3]{3}\s\d+:\d+\b)/;

export function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}

import { client } from "../../meilisearchClient";

export async function findReferencesUsingMeilisearch(verseRef: string) {
    try {
        const index = client.index("vrefs"); // Use the same index name as before
        const searchResponse = await index.search(verseRef);
        console.log({ searchResponse });

        return searchResponse.hits.map((hit) => ({
            uri: hit.uri,
            position: new vscode.Position(
                hit.position.line,
                hit.position.character,
            ),
        }));
    } catch (error) {
        console.error("Error finding references using Meilisearch:", error);
        return [];
    }
}
