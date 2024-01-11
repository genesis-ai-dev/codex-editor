import * as vscode from 'vscode';
import { CodexKernel } from './controller';
import { CodexContentSerializer } from './serializer';
import { NOTEBOOK_TYPE, createCodexNotebook, createProjectNotebooks } from './codexNotebookUtils';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(
			NOTEBOOK_TYPE, new CodexContentSerializer(), { transientOutputs: true }
		),
		new CodexKernel()
	);

	context.subscriptions.push(vscode.commands.registerCommand('codex-notebook-extension.createCodexNotebook', async () => {
		vscode.window.showInformationMessage('Creating Codex Notebook');
		const doc = await createCodexNotebook();
		await vscode.window.showNotebookDocument(doc);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codex-notebook-extension.createCodexProject',
		async () => {
			vscode.window.showInformationMessage('Creating Codex Project');
			await createProjectNotebooks();
		}));

}
