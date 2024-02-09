// import { commands, ExtensionContext } from "vscode";
import * as vscode from "vscode";
import { DictionaryTablePanel } from "./DictionaryTablePanel";

//   const showDictionaryTableCommand = commands.registerCommand("react.showDictionaryTable", async () => {
    
//     DictionaryTablePanel.render(context.extensionUri);
//   });

//   // Add command to the extension context
//   context.subscriptions.push(showDictionaryTableCommand);
// }


export function registerDictionaryTableProvider(
    context: vscode.ExtensionContext,
) {
    const showDictionaryTableCommand = vscode.commands.registerCommand("react.showDictionaryTable", async () => {
    
        DictionaryTablePanel.render(context.extensionUri);
        });

        // Add command to the extension context
        context.subscriptions.push(showDictionaryTableCommand);
}