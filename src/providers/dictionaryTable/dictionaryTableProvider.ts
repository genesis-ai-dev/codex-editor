// import { commands, ExtensionContext } from "vscode";
import * as vscode from "vscode";
import { DictionaryTablePanel } from "./DictionaryTablePanel";
// import { DictionaryTableCustomEditorProvider } from './DictionaryTableCustomEditorProvider';


export function registerDictionaryTableProvider(context: vscode.ExtensionContext) {
    
    const showDictionaryTableCommand = vscode.commands.registerCommand("dictionaryTable.showDictionaryTable", async () => {
        DictionaryTablePanel.render(context.extensionUri);
        });

    // Add command to the extension context
    context.subscriptions.push(showDictionaryTableCommand);


    // context.subscriptions.push(vscode.window.registerCustomEditorProvider(
    //     'dictionaryTable.customEditor',
    //     new DictionaryTableCustomEditorProvider(context),
    //     { webviewOptions: { enableFindWidget: true, retainContextWhenHidden: true } }
    // ));
}

