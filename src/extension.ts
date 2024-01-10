import * as vscode from 'vscode';
import { SampleKernel } from './controller';
import { CodexContentSerializer } from './serializer';
import * as fs from 'fs';
import { vrefData, nonCanonicalBookRefs } from './assets/vref.js';
import { getWorkSpaceFolder } from './utils';

const NOTEBOOK_TYPE = 'codex-type';

export function activate(context: vscode.ExtensionContext) {

	const createCodexNotebook = async (cells: vscode.NotebookCellData[] = []) => {
		/** 
		 * Generic function to create a Codex notebook
		 */
		const cellData = cells.length > 0
			? cells.map(cell => new vscode.NotebookCellData(cell.kind, cell.value, cell.languageId))
			: [];
		const data = new vscode.NotebookData(cellData);
		const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
		return doc;
	};

	context.subscriptions.push(vscode.commands.registerCommand('codex-notebook-extension.createCodexNotebook', async () => {
		vscode.window.showInformationMessage('Creating Codex Notebook');
		const doc = await createCodexNotebook();
		await vscode.window.showNotebookDocument(doc);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codex-notebook-extension.createCodexProject', async () => {
		vscode.window.showInformationMessage('Creating Codex Project');

		// Loop over all books (top-level keys in vrefData), and createCodexNotebook for each
		Object.keys(vrefData).filter(ref => !nonCanonicalBookRefs.includes(ref)).forEach(async (book) => {
			/** 
			 * One notebook for each book of the Bible. Each notebook has a code cell for each chapter.
			 * Each chapter cell has a preceding markdown cell with the chapter number, and a following 
			 * markdown cell that says '### Notes for Chapter {chapter number}'
			 */
			const cells: vscode.NotebookCellData[] = [];
			const bookData = vrefData[book];

			// Iterate over all chapters in the current book
			Object.keys(bookData.chapterVerseCountPairings).forEach((chapter) => {
				// Generate a markdown cell with the chapter number
				cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, `# Chapter ${chapter}`, 'markdown'));

				// Generate a code cell for the chapter
				const numberOfVrefsForChapter = bookData.chapterVerseCountPairings[chapter];
				const vrefsString = Array.from(Array(numberOfVrefsForChapter).keys()).map((_, i) => `${book} ${chapter}:${i + 1}`).join('\n');

				cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, vrefsString, 'scripture'));

				// Generate a markdown cell for notes for the chapter
				cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, `### Notes for Chapter ${chapter}`, 'markdown'));
			});

			// Create a notebook for the current book
			// Save the notebook
			const filePath = 'drafts/Bible';
			const fileName = `${book}.codex`;

			const workspaceFolder = getWorkSpaceFolder();
			const fullPath = `${workspaceFolder}/${filePath}/${fileName}`;
			const uri = vscode.Uri.file(fullPath);

			const serializer = new CodexContentSerializer();
			const notebookData = new vscode.NotebookData(cells);
			const notebookFile = await serializer.serializeNotebook(notebookData, new vscode.CancellationTokenSource().token);
			fs.writeFileSync(uri.fsPath, Buffer.from(notebookFile));
		});
	}));

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(
			NOTEBOOK_TYPE, new CodexContentSerializer(), { transientOutputs: true }
		),
		new SampleKernel()
	);
}
