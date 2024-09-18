import * as vscode from 'vscode';
import { verseRefRegex } from '../../../utils/verseRefUtils';
import { getWorkSpaceUri } from "../../../utils";

export async function updateCompleteDrafts(): Promise<void> {
    const workspaceFolderUri = getWorkSpaceUri();
    if (!workspaceFolderUri) {
        throw new Error('Workspace folder not found.');
    }

    const targetBibleFiles = await vscode.workspace.findFiles('**/*.codex');
    const completeDrafts: string[] = [];

    for (const file of targetBibleFiles) {
        const document = await vscode.workspace.openNotebookDocument(file);
        for (const cell of document.getCells()) {
            const lines = cell.document.getText().split('\n');
            for (const line of lines) {
                const match = line.match(verseRefRegex);
                if (match) {
                    const verseContent = line.substring(match.index! + match[0].length).trim();
                    if (verseContent) {
                        completeDrafts.push(verseContent);
                    }
                }
            }
        }
    }

    const completeDraftPath = vscode.Uri.joinPath(workspaceFolderUri, '.project', 'complete_drafts.txt');
    await vscode.workspace.fs.writeFile(completeDraftPath, Buffer.from(completeDrafts.join('\n'), 'utf8'));
}