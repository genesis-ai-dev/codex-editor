"use strict";

import * as vscode from "vscode";
import { registerParallelViewWebviewProvider } from "../../providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { registerDictionaryTableProvider } from "../../providers/dictionaryTable/dictionaryTableProvider";
import { registerChatProvider } from "../../providers/chat/customChatWebviewProvider";
import { registerCommentsWebviewProvider } from "../../providers/commentsWebview/customCommentsWebviewProvider";
import { registerProjectManagerViewWebviewProvider } from "../../projectManager/projectManagerViewProvider";
import { registerNavigationWebviewProvider } from "../../providers/navigationWebview/register";

export async function initializeWebviews(context: vscode.ExtensionContext) {
    // Register our navigation view first so it appears first in the activity bar
    registerNavigationWebviewProvider(context);

    // Then register the rest of the views
    registerParallelViewWebviewProvider(context);
    registerDictionaryTableProvider(context);
    registerChatProvider(context);
    registerCommentsWebviewProvider(context);
    registerProjectManagerViewWebviewProvider(context);
}
