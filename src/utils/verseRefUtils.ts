import * as vscode from "vscode";

export const findVerseRef = ({
    verseRef,
    content,
}: {
    verseRef: string;
    content: string;
}) => {
    // TODO: expand to use know abbreviations
    // TODO: add a versification bridge so that ORG refs can be used to look up other versifications to get the correct content
    const tsvVerseRef = verseRef.replace(/(\w+)\s(\d+):(\d+)/, "$1\t$2\t$3");
    const verseRefWasOrgFormat = content.includes(verseRef);
    const verseRefWasFound =
        verseRefWasOrgFormat || content.includes(tsvVerseRef);
    return {
        verseRefWasFound,
        verseRefInContentFormat: verseRefWasOrgFormat ? verseRef : tsvVerseRef,
    };
};

export async function findReferences({
    verseRef,
    fileType,
}: {
    verseRef: string;
    fileType?: string;
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
