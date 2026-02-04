"use strict";

import * as vscode from "vscode";

export async function initializeWebviews(context: vscode.ExtensionContext) {
    // Note: The following providers are now registered in registerProviders.ts:
    // - registerNavigationWebviewProvider (first so it appears first in activity bar)
    // - registerMainMenuProvider
    // - registerCommentsWebviewProvider
    // - registerParallelViewWebviewProvider
    // - registerChatProvider
}
