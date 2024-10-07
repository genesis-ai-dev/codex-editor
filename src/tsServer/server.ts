import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    SpellChecker,
    SpellCheckDiagnosticsProvider,
    SpellCheckCodeActionProvider,
    SpellCheckCompletionItemProvider,
} from "./spellCheck";
import { WordSuggestionProvider } from "./forecasting";
import {
    MatchesEntity,
    ReplacementsEntity,
} from "../../webviews/codex-webviews/src/CodexCellEditor/react-quill-spellcheck/types";

const DEBUG_MODE = true; // Flag for debug mode

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

// Define special phrases with their replacements and colors
const specialPhrases = [
    { phrase: "hello world", replacement: "hi", color: "purple" },
    // Add more phrases as needed
];

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

    debugLog("Initializing WordSuggestionProvider...");
    wordSuggestionProvider = new WordSuggestionProvider(workspaceFolder || "");
    debugLog("WordSuggestionProvider initialized.");

    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: 1, // Incremental
            },
            completionProvider: {
                resolveProvider: true,
            },
            // Add other capabilities as needed
        },
    } as InitializeResult;
});

connection.onRequest("spellcheck/check", async (params: { text: string }) => {
    debugLog("SERVER: Received spellcheck/check request:", { params });
    const text = params.text.toLowerCase();

    const matches: MatchesEntity[] = [];

    // Handle special phrases first to avoid overlapping with single-word matches
    specialPhrases.forEach(({ phrase, replacement, color }, index) => {
        let startIndex = 0;
        const phraseLower = phrase.toLowerCase();

        while ((startIndex = text.indexOf(phraseLower, startIndex)) !== -1) {
            matches.push({
                id: `SPECIAL_PHRASE_${index}_${matches.length}`,
                text: phrase,
                replacements: [{ value: replacement }],
                offset: startIndex,
                length: phrase.length,
                color: color, // Assign specified color
            });
            startIndex += phrase.length;
        }
    });

    // Perform regular spellcheck for other words
    const words = tokenizeText({
        method: "words",
        text: params.text,
    });

    words.forEach((word, index) => {
        const lowerWord = word.toLowerCase();

        // Skip if the word is part of any special phrase matched
        const isPartOfSpecialPhrase = specialPhrases.some(({ phrase }) =>
            phrase.toLowerCase().includes(lowerWord)
        );
        if (isPartOfSpecialPhrase) return;

        const spellCheckResult = spellChecker.spellCheck(word);
        const offset = params.text.toLowerCase().indexOf(lowerWord, 0);
        if (spellCheckResult.corrections.length > 0) {
            matches.push({
                id: `UNKNOWN_WORD_${matches.length}`,
                text: word,
                replacements: spellCheckResult.corrections
                    .filter((c) => !!c)
                    .map((correction) => ({ value: correction })),
                offset: offset,
                length: word.length,
                color: "red", // Default color for spelling errors
            });
        }
    });

    debugLog(`Returning matches: ${JSON.stringify(matches)}`);
    return matches;
});

connection.onRequest("spellcheck/addWord", async (params: { words: string[] }) => {
    debugLog("Received spellcheck/addWord request:", { params });
    if (!spellChecker) {
        debugLog("SpellChecker is not initialized.");
        throw new Error("SpellChecker is not initialized.");
    }

    try {
        await spellChecker.addWords(params.words);
        debugLog("Words successfully added to the dictionary.");
        return { success: true };
    } catch (error: any) {
        debugLog("Error adding words to the dictionary:", error);
        throw new Error(`Failed to add words: ${error.message}`);
    }
});

// ... include other request handlers as needed

documents.listen(connection);
connection.listen();

/**
 * Tokenizes the input text into words.
 * @param params Tokenization parameters.
 * @returns An array of words.
 */
function tokenizeText(params: { method: string; text: string }): string[] {
    // Simple word tokenizer; can be replaced with a more robust solution
    return params.text.match(/\b\w+\b/g) || [];
}
