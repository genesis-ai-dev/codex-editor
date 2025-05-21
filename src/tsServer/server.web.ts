import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    BrowserMessageReader,
    BrowserMessageWriter,
    Connection,
} from "vscode-languageserver/browser";
import { TextDocument } from "vscode-languageserver-textdocument";
import { RequestType } from "vscode-languageserver";

// Initialize browser-based connection
const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);
const connection = createConnection(ProposedFeatures.all, messageReader, messageWriter);
const documents = new TextDocuments(TextDocument);
const ExecuteCommandRequest = new RequestType<{ command: string; args: any[] }, any, void>(
    "workspace/executeCommand"
);

// Simple mock for web environment
class SimplifiedSpellChecker {
    constructor(private connection: Connection) {}
    
    async spellCheck(word: string) {
        // In a real implementation, this would use IndexedDB or other web storage
        // For now, just return a simple mock response
        return {
            wordIsFoundInDictionary: true,
            corrections: []
        };
    }
}

// Simplified providers for web environment
const spellChecker = new SimplifiedSpellChecker(connection);

connection.onInitialize((params: InitializeParams) => {
    console.log("Web Language Server initializing");
    
    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: 1, // Incremental
            },
            completionProvider: {
                resolveProvider: true,
            },
        },
    } as InitializeResult;
});

// Handle spell check requests with simplified implementation
connection.onRequest("spellcheck/check", async (params: { text: string; cellId: string }) => {
    console.log("Web server received spellcheck/check request:", params);
    
    // Return empty matches for web environment
    return {
        matches: [],
        replacements: []
    };
});

// Handle get alert codes with simplified implementation
connection.onRequest(
    "spellcheck/getAlertCodes",
    async (params: any[]): Promise<any[]> => {
        console.log("Web server received spellcheck/getAlertCodes request");
        
        // Return simplified response for web environment
        return params.map((param) => ({
            code: 0,
            cellId: param.cellId,
            savedSuggestions: { suggestions: [] },
        }));
    }
);

// Handle add word request with simplified implementation
connection.onRequest("spellcheck/addWord", async (params: { words: string[] }) => {
    console.log("Web server received spellcheck/addWord request:", params);
    
    // In a real implementation, we would store these in IndexedDB
    return true;
});

// Handle get similar words with simplified implementation
connection.onRequest("server.getSimilarWords", async ([word]: [string]) => {
    console.log("Web server received server.getSimilarWords request:", word);
    
    // Return empty array for web environment
    return [];
});

// Start listening
documents.listen(connection);
connection.listen(); 