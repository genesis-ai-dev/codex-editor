
"use strict";
import * as vscode from "vscode";
import { verseRefRegex } from "../../../utils/verseRefUtils";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems,
} from "../../../providers/translationSuggestions/inlineCompletionsProvider";
import { getWorkSpaceFolder } from "../../../utils";
import { minisearchIndexer } from './minisearchIndexer';
import { SpellChecker,  SpellCheckDiagnosticsProvider, SpellCheckCodeActionProvider} from './spellCheck';


class TranslationAssistantServer {
    private context: vscode.ExtensionContext;
    public workspaceFolder: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.workspaceFolder = getWorkSpaceFolder();
    }

    async initialize() {
        const config = vscode.workspace.getConfiguration('translation-assistant-server');
        const isAssistantEnabled = config.get<boolean>('enable', true);

        if (!isAssistantEnabled) {
            vscode.window.showInformationMessage("Translation Assistant Server is disabled. Language server not activated.");
            return;
        }

        vscode.window.showInformationMessage("Translation Assistant Server activated");

        this.registerProviders();
        this.registerEventListeners();
        await this.initializeMinisearchIndexer();
    }

    private registerProviders() {
        const scriptureLanguages = ["scripture"];
        const disposables = scriptureLanguages.map((language) =>
            vscode.languages.registerInlineCompletionItemProvider(language, {
                provideInlineCompletionItems,
            })
        );
        disposables.forEach((disposable) => this.context.subscriptions.push(disposable));

        const triggerCompletionCommand = vscode.commands.registerCommand(
            "extension.triggerInlineCompletion",
            triggerInlineCompletion
        );
        this.context.subscriptions.push(triggerCompletionCommand);
    }

    private registerEventListeners() {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async (event) => {
                await this.handleDocumentChange(event);
            }),
            vscode.workspace.onDidOpenTextDocument(async (doc) => {
                await this.handleDocumentOpen(doc);
            })
        );
    }

    private async handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        minisearchIndexer.updateIndex(event);
        await minisearchIndexer.serializeIndex();
    }

    private async handleDocumentOpen(doc: vscode.TextDocument) {
        minisearchIndexer.indexDocument(doc);
        await minisearchIndexer.serializeIndex();
    }

    private async initializeMinisearchIndexer() {
        await minisearchIndexer.initializeIndexing();
    }

    searchIndex(query: string) {
        return minisearchIndexer.search(query);
    }
}


export async function initializeLanguageServer(context: vscode.ExtensionContext) {
    const server = new TranslationAssistantServer(context);
    await server.initialize();

    const spellChecker = new SpellChecker(server.workspaceFolder);
    await spellChecker.initializeDictionary();

    const diagnosticsProvider = new SpellCheckDiagnosticsProvider(spellChecker);
    const codeActionProvider = new SpellCheckCodeActionProvider(spellChecker);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('scripture', codeActionProvider)
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'scripture') {
                diagnosticsProvider.updateDiagnostics(doc);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'scripture') {
                diagnosticsProvider.updateDiagnostics(event.document);
            }
        })
    );

    context.subscriptions.push(
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

