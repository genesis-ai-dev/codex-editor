import * as vscode from 'vscode';
import { extractVerseRefFromLine } from '../utils/verseRefUtils';

export async function exportCodexContent() {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const codexFiles = await vscode.workspace.findFiles('**/*.codex');
        if (codexFiles.length === 0) {
            vscode.window.showInformationMessage('No .codex files found in the workspace.');
            return;
        }

        let allContent = '';

        for (const file of codexFiles) {
            const notebookDocument = await vscode.workspace.openNotebookDocument(file);
            const cells = notebookDocument.getCells()
                .filter(cell => cell.kind === vscode.NotebookCellKind.Code)
                .map(cell => cell.document.getText());

            const processedContent = cells
                .map(cell => {
                    const lines = cell.split('\n');
                    return lines.filter(line => {
                        const verseRef = extractVerseRefFromLine(line);
                        return !(verseRef && line.trim() === verseRef);
                    }).join('\n');
                })
                .filter(cellContent => cellContent.trim() !== '')
                .join('\n\n');

            if (processedContent.trim() !== '') {
                allContent += processedContent + '\n\n';
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportFileName = `export_${timestamp}.txt`;
        const exportFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, 'exports');

        await vscode.workspace.fs.createDirectory(exportFolder);
        const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(allContent));

        vscode.window.showInformationMessage(`Export completed: ${exportFile.fsPath}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}
