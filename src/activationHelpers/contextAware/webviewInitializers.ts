"use strict";

import * as vscode from "vscode";
import { registerParallelViewWebviewProvider } from "../../providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { registerSemanticViewProvider } from "../../providers/semanticView/customSemanticViewProvider";
import { registerDictionaryTableProvider } from "../../providers/dictionaryTable/dictionaryTableProvider";
import { registerDictionarySummaryProvider } from "../../providers/dictionaryTable/dictionarySummaryProvider";
import { registerChatProvider } from "../../providers/chat/customChatWebviewProvider";
import { registerCommentsWebviewProvider } from "../../providers/commentsWebview/customCommentsWebviewProvider";
import { registerProjectManagerViewWebviewProvider } from "../../projectManager/projectManagerViewProvider";

export async function initializeWebviews(context: vscode.ExtensionContext) {
    registerParallelViewWebviewProvider(context);
    registerSemanticViewProvider(context);
    registerDictionaryTableProvider(context);
    registerDictionarySummaryProvider(context);
    registerChatProvider(context);
    registerCommentsWebviewProvider(context);
    registerProjectManagerViewWebviewProvider(context);
}