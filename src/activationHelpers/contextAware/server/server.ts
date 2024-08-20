
"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder } from "../../../utils";
import { SpellChecker, SpellCheckDiagnosticsProvider, SpellCheckCodeActionProvider } from './spellCheck';
import { createIndexWithContext } from "./indexes";


export async function initializeLanguageServer(context: vscode.ExtensionContext) {
    const workspaceFolder = getWorkSpaceFolder();

    const config = vscode.workspace.getConfiguration('translation-assistant-server');
    const isAssistantEnabled = config.get<boolean>('enable', true);
    if (!isAssistantEnabled) {
        return;
    }

    createIndexWithContext(context);

    const spellChecker = new SpellChecker(workspaceFolder);
    await spellChecker.initializeDictionary();

    const diagnosticsProvider = new SpellCheckDiagnosticsProvider(spellChecker);
    const codeActionProvider = new SpellCheckCodeActionProvider(spellChecker);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('scripture', codeActionProvider),
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.fileName.endsWith('.bible')) {
                return;
            }
            if (doc.languageId === 'scripture') {
                // TODO: should we break out resource heavy diagnostics into a separate diagnostic provider?
                diagnosticsProvider.updateDiagnostics(doc);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'scripture') {
                diagnosticsProvider.updateDiagnostics(event.document);
                // TODO: update resource-intensive diagnostics here, but not on the open event
            }
        }),
        vscode.commands.registerCommand('extension.addToDictionary', async (word: string) => {
            await spellChecker.addToDictionary(word);
            vscode.window.showInformationMessage(`Added '${word}' to dictionary.`);
            diagnosticsProvider.refreshDiagnostics();
        })
    );
}

// - Add LAD (Linguistic Anomaly Detection) diagnostics (port from servable_lad.py)
// - Add verse validation diagnostics (port from verse_validator.py)
// - Add Wildebeest analysis diagnostics (port from servable_wb.py)
// - Set up onDidChangeContent event to trigger diagnostics

// FEATURE: Code action providers
// TODO: Implement code action providers
// - Add spelling-related code actions (port from spelling.py)
// - Add verse reference code actions (port from verse_validator.py)
// - Register code action providers with the server

// FEATURE: MiniSearch indexing for draft verses and source Bible
// Initialize indexing
// TODO: Implement WebSocket server to handle search requests
// TODO: Implement handlers for various socket requests (search, LAD, etc.)

// FEATURE: Database integration
// TODO: Implement database integration
// - Create or port JsonDatabase class
// -- should we be using SQLite? It has bm25 out of the box
// - Implement TF-IDF functionality or use a TypeScript library for TF-IDF
// - Set up methods for searching and retrieving verse data

// FEATURE: Utility functions
// TODO: Create utility functions
// - Port relevant utility functions from Python implementation
// - Implement helper functions for text processing, verse validation, etc.

// FEATURE: Document symbol provider
// TODO: Implement document symbol provider
// - Create a provider to outline the structure of scripture documents
// --this structure includes all of the vrefs in the file
// also, we want to identify all proper nouns in the file, by looking at a lookup definition of all entities/places/etc. (ACAI data) in the Bible, and then we can
// check in the file for any of those entities, and then we can highlight them in the file OR check whether they are present. We will need a tool for prompting the
// user about which words in the current verse draft correspond to the key terms, etc.
// - Register document symbol provider with the server

// FEATURE: Hover provider
// TODO: Implement hover provider
// - Port hover functionality from lsp_wrapper.py
// - Register hover provider with the server

