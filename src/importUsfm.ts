// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

type UsfmImportParameters = {
	usfmFiles: vscode.Uri[];
}

async function getImportParameters() : Promise<UsfmImportParameters> {
	//https://vshaxe.github.io/vscode-extern/vscode/OpenDialogOptions.html
	const usfmFiles = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: true,
        openLabel: "Choose USFM file(s) to import",
		filters: {
			'USFM': ['usfm','USFM','usf','USF']
		}
      });
	//Throw an exception if the user canceled.
	if (!usfmFiles) throw new Error('User canceled import.');

	
	return { usfmFiles };
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function registerUsfmImporter(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('The importUsfm plugin is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('codex-editor-extension.importUsfm', async () => {
		// The code you place here will be executed every time your command is executed
		await getImportParameters();

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello Usfm!');
	});

	context.subscriptions.push(disposable);
}
