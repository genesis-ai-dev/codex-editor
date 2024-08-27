import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    TextDocumentPositionParams,
    CodeActionParams,
    PublishDiagnosticsParams,
    CompletionContext
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SpellChecker, SpellCheckDiagnosticsProvider, SpellCheckCodeActionProvider, SpellCheckCompletionItemProvider } from './spellCheck';
import { createIndexWithContext } from "./indexes";
import { WordSuggestionProvider } from './forecasting';
import { workspace } from 'vscode';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let spellChecker: SpellChecker;
let diagnosticsProvider: SpellCheckDiagnosticsProvider;
let codeActionProvider: SpellCheckCodeActionProvider;
let completionItemProvider: SpellCheckCompletionItemProvider;
let wordSuggestionProvider: WordSuggestionProvider;

connection.onInitialize((params: InitializeParams) => {
    const workspaceFolder = params.workspaceFolders?.[0].uri;

    // Initialize services
    spellChecker = new SpellChecker(workspaceFolder);
    diagnosticsProvider = new SpellCheckDiagnosticsProvider(spellChecker);
    codeActionProvider = new SpellCheckCodeActionProvider(spellChecker);
    completionItemProvider = new SpellCheckCompletionItemProvider(spellChecker);
    
    if (workspaceFolder)
    wordSuggestionProvider = new WordSuggestionProvider(workspaceFolder);

    // Initialize indexes
    // createIndexWithContext(connection);

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: [' ']
            },
            codeActionProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true
        }
    };
    return result;
});

documents.onDidChangeContent(change => {
    const diagnostics = diagnosticsProvider.updateDiagnostics(change.document);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

connection.onCompletion((params: TextDocumentPositionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    
    // Create a dummy CancellationToken since we don't have one in this context
    const dummyToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
    
    // Create a default CompletionContext
    const defaultContext: CompletionContext = { 
        triggerKind: 1, // Invoked
        triggerCharacter: undefined 
    };

    const spellCheckSuggestions = completionItemProvider.provideCompletionItems(
        document, 
        params.position, 
        dummyToken, 
        defaultContext
    );
    const wordSuggestions = wordSuggestionProvider.provideCompletionItems(
        document, 
        params.position, 
        dummyToken, 
        defaultContext
    );
    return [...spellCheckSuggestions, ...wordSuggestions];
});

connection.onCodeAction((params: CodeActionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    
    return codeActionProvider.provideCodeActions(document, params.range, params.context);
});

// TODO: Implement other handlers (hover, document symbols, etc.)

documents.listen(connection);
connection.listen();