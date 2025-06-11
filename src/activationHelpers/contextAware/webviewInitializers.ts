"use strict";

import * as vscode from "vscode";
import { registerDictionaryTableProvider } from "../../providers/dictionaryTable/dictionaryTableProvider";
import { registerProjectManagerViewWebviewProvider } from "../../projectManager/projectManagerViewProvider";

export async function initializeWebviews(context: vscode.ExtensionContext) {
    // Register providers that are not yet handled by the centralized registration system
    registerDictionaryTableProvider(context);
    registerProjectManagerViewWebviewProvider(context);
    
    // Note: The following providers are now registered in registerProviders.ts:
    // - registerNavigationWebviewProvider (first so it appears first in activity bar)
    // - registerMainMenuProvider
    // - registerCommentsWebviewProvider
    // - registerParallelViewWebviewProvider
    // - registerChatProvider
}
