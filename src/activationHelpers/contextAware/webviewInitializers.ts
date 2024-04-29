"use strict";

import * as vscode from "vscode";
import { registerParallelViewWebviewProvider } from "../../providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { registerSmartViewWebviewProvider } from "../../providers/smartView/custumSmartViewProvider";

import { registerSemanticViewProvider } from "../../providers/semanticView/customSemanticViewProvider";
import { registerDictionaryTableProvider } from "../../providers/dictionaryTable/dictionaryTableProvider";
import { registerDictionarySummaryProvider } from "../../providers/dictionaryTable/dictionarySummaryProvider";


export async function initializeWebviews(context: vscode.ExtensionContext){
    registerParallelViewWebviewProvider(context);
    registerSemanticViewProvider(context);
    registerDictionaryTableProvider(context);
    registerDictionarySummaryProvider(context);
    registerSmartViewWebviewProvider(context);
}