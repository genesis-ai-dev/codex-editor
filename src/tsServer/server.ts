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
    CompletionContext,
    Connection,
    Hover,
    DocumentSymbol,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    SpellChecker,
    SpellCheckDiagnosticsProvider,
    SpellCheckCodeActionProvider,
    SpellCheckCompletionItemProvider,
} from "./spellCheck";
import { WordSuggestionProvider } from "./forecasting";
import { URI } from "vscode-uri";
import { tokenizeText } from "../utils/nlpUtils";

const DEBUG_MODE = false; // Flag for debug mode
const TOKENIZE_METHOD_SHOULD_BE_SET_IN_CONFIG = "words";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let spellChecker: SpellChecker;
let diagnosticsProvider: SpellCheckDiagnosticsProvider;
let codeActionProvider: SpellCheckCodeActionProvider;
let completionItemProvider: SpellCheckCompletionItemProvider;
let wordSuggestionProvider: WordSuggestionProvider;

// Custom debug function
function debugLog(...args: any[]) {
    if (DEBUG_MODE) {
        console.log(...args);
    }
}

connection.onInitialize((params: InitializeParams) => {
    const workspaceFolder = params.workspaceFolders?.[0].uri;
    debugLog(`Initializing with workspace folder: ${workspaceFolder}`);

    // Initialize services
    debugLog("Initializing SpellChecker...");
    spellChecker = new SpellChecker(workspaceFolder);
    debugLog("SpellChecker initialized.");

    debugLog("Initializing SpellCheckDiagnosticsProvider...");
    diagnosticsProvider = new SpellCheckDiagnosticsProvider(spellChecker);
    debugLog("SpellCheckDiagnosticsProvider initialized.");

    debugLog("Initializing SpellCheckCodeActionProvider...");
    codeActionProvider = new SpellCheckCodeActionProvider(spellChecker);
    debugLog("SpellCheckCodeActionProvider initialized.");

    debugLog("Initializing SpellCheckCompletionItemProvider...");
    completionItemProvider = new SpellCheckCompletionItemProvider(spellChecker);
    debugLog("SpellCheckCompletionItemProvider initialized.");

    if (workspaceFolder) {
        const fsPath = URI.parse(workspaceFolder).fsPath;
        debugLog(`Creating WordSuggestionProvider with workspace folder: ${fsPath}`);
        wordSuggestionProvider = new WordSuggestionProvider(fsPath);
        debugLog("WordSuggestionProvider initialized.");
    } else {
        console.warn("No workspace folder provided. WordSuggestionProvider not initialized.");
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: [" "],
            },
            codeActionProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true,
            executeCommandProvider: {
                commands: ["spellcheck.addToDictionary", "server.getSimilarWords"],
            },
        },
    };
    return result;
});

// NOTE: if we watch for document changes, we wind up doing things like spell checking the entirety of any .codex document
// documents.onDidChangeContent((change) => {
//     debugLog(`Document changed: ${change.document.uri}`);
//     const diagnostics = diagnosticsProvider.updateDiagnostics(change.document);
//     debugLog(`Sending diagnostics for: ${change.document.uri}`);
//     connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
// });

connection.onCompletion((params: TextDocumentPositionParams) => {
    debugLog(
        `Completion requested for document: ${params.textDocument.uri} at position: ${params.position}`
    );
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        console.warn(`Document not found: ${params.textDocument.uri}`);
        return [];
    }

    // Create a dummy CancellationToken since we don't have one in this context
    const dummyToken = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
    };

    // Create a default CompletionContext
    const defaultContext: CompletionContext = {
        triggerKind: 1, // Invoked
        triggerCharacter: undefined,
    };

    debugLog("About to get spell check suggestions...");
    const spellCheckSuggestions = completionItemProvider.provideCompletionItems(
        document,
        params.position,
        dummyToken,
        defaultContext
    );

    debugLog("About to get word suggestions...");
    const wordSuggestions = wordSuggestionProvider.provideCompletionItems(
        document,
        params.position,
        dummyToken,
        defaultContext
    );

    debugLog("Returning combined suggestions.");
    return [...spellCheckSuggestions, ...wordSuggestions];
});

connection.onCodeAction((params: CodeActionParams) => {
    debugLog(`Code action requested for document: ${params.textDocument.uri}`);
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        console.warn(`Document not found: ${params.textDocument.uri}`);
        return [];
    }

    debugLog("Providing code actions...");
    return codeActionProvider.provideCodeActions(document, params.range, params.context);
});

// TODO: Implement other handlers (hover, document symbols, etc.)

// Add this new handler
connection.onExecuteCommand(async (params) => {
    debugLog("Received execute command:", params.command);

    if (params.command === "spellcheck.addToDictionary" && params.arguments) {
        const words = params.arguments as string[];
        debugLog(`Adding words to dictionary: ${words}`);
        await spellChecker.addWordsToDictionary(words);
        debugLog("Words added to dictionary.");
        connection.sendNotification("spellcheck/dictionaryUpdated");
    }

    if (params.command === "server.getSimilarWords") {
        debugLog("Handling server.getSimilarWords command");
        const [word] = params.arguments || [];
        if (typeof word === "string") {
            try {
                debugLog(`Getting similar words for: ${word}`);
                const similarWords = wordSuggestionProvider.getSimilarWords(word);
                debugLog("Similar words:", similarWords);
                return similarWords;
            } catch (error) {
                console.error("Error getting similar words:", error);
                return [];
            }
        } else {
            console.error("Invalid arguments for server.getSimilarWords");
            return [];
        }
    }
    // ... other command handlers ...
});

connection.onRequest("spellcheck/check", async (params: { text: string }) => {
    debugLog("SERVER: Received spellcheck/check request:", { params });
    const words = tokenizeText({
        method: TOKENIZE_METHOD_SHOULD_BE_SET_IN_CONFIG,
        text: params.text,
    });
    debugLog(`Checking spelling for words: ${words}`);
    const matches = words
        .map((word, index) => {
            const spellCheckResult = spellChecker.spellCheck(word);
            const offset = params.text.indexOf(word);
            debugLog("spell-checker-debug: spellCheckResult", {
                spellCheckResult,
            });
            if (spellCheckResult.corrections.length > 0) {
                return {
                    id: `UNKNOWN_WORD_${index}`,
                    text: word,
                    replacements: spellCheckResult.corrections
                        .filter((c) => !!c)
                        .map((correction) => ({ value: correction })),
                    offset: offset,
                    length: word.length,
                };
            }
            return null;
        })
        .filter((match) => match !== null);

    debugLog(`Returning matches: ${JSON.stringify(matches)}`);
    return matches;
});

connection.onRequest("spellcheck/addWord", async (params: { words: string[] }) => {
    debugLog("Received addWord request:", params.words);
    await spellChecker.addWordsToDictionary(params.words);
    debugLog("Words added to dictionary.");
    return { success: true };
});

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    debugLog(
        `Hover requested for document: ${params.textDocument.uri} at position: ${params.position}`
    );
    // For now, return null to indicate no hover information
    return null;
});

connection.onDocumentSymbol((params): DocumentSymbol[] => {
    debugLog(`Document symbol requested for document: ${params.textDocument.uri}`);
    // For now, return an empty array to indicate no document symbols
    return [];
});

documents.listen(connection);
connection.listen();
