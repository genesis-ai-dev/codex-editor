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
import { RequestType } from "vscode-languageserver";
import { debug } from "console";
import { tokenizeText } from "../utils/nlpUtils";

const DEBUG_MODE = true; // Flag for debug mode

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const ExecuteCommandRequest = new RequestType<{ command: string; args: any[] }, any, void>(
    "workspace/executeCommand"
);

let spellChecker: SpellChecker;
let diagnosticsProvider: SpellCheckDiagnosticsProvider;
let codeActionProvider: SpellCheckCodeActionProvider;
let completionItemProvider: SpellCheckCompletionItemProvider;
let wordSuggestionProvider: WordSuggestionProvider;

// Custom debug function
function debugLog(...args: any[]) {
    if (DEBUG_MODE) {
        console.log(new Date().toISOString(), ...args);
    }
}

// Define special phrases with their replacements and colors
let specialPhrases = [
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
let lastCellChanged: boolean = false;
connection.onRequest(
    "spellcheck/getAlertCode",
    async (params: { text: string; cellId: string }) => {
        debugLog("SERVER: Received spellcheck/getAlertCode request:", { params });
        const text = params.text.toLowerCase();
        const words = tokenizeText({
            method: "whitespace_and_punctuation",
            text: text,
        });

        // spellcheck
        for (const word of words) {
            const spellCheckResult = spellChecker.spellCheck(word);
            if (
                spellCheckResult &&
                spellCheckResult.corrections &&
                spellCheckResult.corrections.length > 0
            ) {
                return { code: 1, cellId: params.cellId };
            }
        }
     
        const savedSuggestions = await connection.sendRequest(ExecuteCommandRequest, {
            command: "codex-smart-edits.getSavedSuggestions",
            args: [params.cellId],
        });
        let code = 0;
        if (savedSuggestions && savedSuggestions.suggestions.length > 0) {
            code = 2;
        }
        return { code, cellId: params.cellId, savedSuggestions };
    }
);

connection.onRequest("spellcheck/check", async (params: { text: string; cellChanged: boolean }) => {
    debugLog("SERVER: Received spellcheck/check request:", { params });

    const text = params.text;
    const matches: MatchesEntity[] = [];

    // Perform regular spellcheck first
    const words = tokenizeText({
        method: "whitespace_and_punctuation",
        text: params.text,
    });

    let hasSpellingErrors = false;

    for (const word of words) {
        if (!word) continue; // Skip empty words

        const spellCheckResult = spellChecker.spellCheck(word);
        if (!spellCheckResult) continue;

        const offset = text.toLowerCase().indexOf(word.toLowerCase(), 0);
        if (offset === -1) continue;

        if (spellCheckResult.corrections && spellCheckResult.corrections.length > 0) {
            matches.push({
                id: `UNKNOWN_WORD_${matches.length}`,
                text: word,
                replacements: spellCheckResult.corrections
                    .filter((c) => c !== null && c !== undefined)
                    .map((correction) => ({ value: correction })),
                offset: offset,
                length: word.length,
                color: "red", // Default color for spelling errors
            });
            hasSpellingErrors = true;
        }
    }

    // Only process smart edits if there are no spelling errors
    if (!hasSpellingErrors && params.cellChanged !== lastCellChanged) {
        specialPhrases = [];
        const smartEditSuggestions = await connection.sendRequest(ExecuteCommandRequest, {
            command: "codex-smart-edits.getEdits",
            args: [params.text, params.cellChanged],
        });

        debugLog("Received smart edit suggestions:", smartEditSuggestions);

        // Process smart edit suggestions as special phrases
        smartEditSuggestions.forEach((suggestion: any, index: number) => {
            specialPhrases.push({
                phrase: suggestion.oldString,
                replacement: suggestion.newString,
                color: "purple", // Use a different color for smart edit suggestions
            });
        });

        // Update the last processed cellId
        lastCellChanged = params.cellChanged;

        // Handle special phrases
        specialPhrases.forEach(({ phrase, replacement, color }, index) => {
            let startIndex = 0;
            const phraseLower = phrase.toLowerCase();

            while ((startIndex = text.toLowerCase().indexOf(phraseLower, startIndex)) !== -1) {
                matches.push({
                    id: `SPECIAL_PHRASE_${index}_${matches.length}`,
                    text: phrase,
                    replacements: [{ value: replacement }],
                    offset: startIndex,
                    length: phrase.length,
                    color: color,
                });
                startIndex += phrase.length;
            }
        });
    }

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
        return { success: false, error: error.message };
    }
});

documents.listen(connection);
connection.listen();
