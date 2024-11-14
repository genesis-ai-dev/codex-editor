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
import { tokenizeText } from "../utils/nlpUtils";
import { GetAlertCodes, AlertCodesServerResponse } from "@types";

const DEBUG_MODE = false; // Flag for debug mode

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
let pendingSmartEditsPromise: Promise<any> | null = null;
let lastSmartEditsText: string | null = null;
let lastSmartEditResults: any[] | null = null;

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
    spellChecker = new SpellChecker(connection);
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
connection.onRequest(
    "spellcheck/getAlertCodes",
    async (params: GetAlertCodes): Promise<AlertCodesServerResponse> => {
        try {
            debugLog("SERVER: Received spellcheck/getAlertCodes request:", { params });

            const results = await Promise.all(
                params.map(async (param) => {
                    const words = tokenizeText({
                        method: "whitespace_and_punctuation",
                        text: param.text,
                    });

                    // spellcheck
                    for (const word of words) {
                        const spellCheckResult = await spellChecker.spellCheck(word);
                        if (spellCheckResult?.corrections?.length > 0) {
                            return {
                                code: 1,
                                cellId: param.cellId,
                                savedSuggestions: { suggestions: [] },
                            };
                        }
                    }

                    // debugLog("No smart edits found, checking for applicable prompt");
                    // If no spelling errors or smart edits, check for applicable prompt
                    const prompt = await connection.sendRequest(ExecuteCommandRequest, {
                        command: "codex-smart-edits.hasApplicablePrompts",
                        args: [param.cellId, param.text],
                    });

                    const code = prompt ? 3 : 0;

                    return {
                        code,
                        cellId: param.cellId,
                        savedSuggestions: { suggestions: [] },
                    };
                })
            );

            return results;
        } catch (error) {
            console.error("Error in getAlertCode:", error);
            return params.map((param) => ({
                code: 0,
                cellId: param.cellId,
                savedSuggestions: { suggestions: [] },
            }));
        }
    }
);

connection.onRequest("spellcheck/check", async (params: { text: string }) => {
    debugLog("SERVER: Received spellcheck/check request:", { params });

    const text = params.text;
    const matches: MatchesEntity[] = [];

    // Start a new smart edits request if we don't have one pending or if the text changed
    if (!pendingSmartEditsPromise || lastSmartEditsText !== text) {
        lastSmartEditsText = text;
        lastSmartEditResults = null;
        pendingSmartEditsPromise = connection
            .sendRequest(ExecuteCommandRequest, {
                command: "codex-smart-edits.getEdits",
                args: [text],
            })
            .then((results) => {
                lastSmartEditResults = results;
                return results;
            });
    }

    // Process spell checking
    const words = tokenizeText({
        method: "whitespace_and_punctuation",
        text: params.text,
    });

    for (const word of words) {
        if (!word) continue;
        const spellCheckResult = await spellChecker.spellCheck(word);
        if (!spellCheckResult) continue;

        const offset = text.indexOf(word, 0);
        if (offset === -1) continue;

        if (spellCheckResult.wordIsFoundInDictionary === false) {
            matches.push({
                id: `UNKNOWN_WORD_${matches.length}`,
                text: word,
                replacements: spellCheckResult.corrections
                    .filter((c) => c !== null && c !== undefined)
                    .map((correction) => ({ value: correction })),
                offset: offset,
                length: word.length,
                color: "red",
            });
        }
    }

    // Include smart edits if they're ready
    if (lastSmartEditResults) {
        specialPhrases = [];
        lastSmartEditResults.forEach((suggestion: any) => {
            specialPhrases.push({
                phrase: suggestion.oldString,
                replacement: suggestion.newString,
                color: "purple",
            });
        });

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

connection.onRequest(
    "spellcheck/applyPromptedEdit",
    async (params: { text: string; prompt: string; cellId: string }) => {
        debugLog("Received spellcheck/applyPromptedEdit request:", { params });
        try {
            const modifiedText = await connection.sendRequest(ExecuteCommandRequest, {
                command: "codex-smart-edits.applyPromptedEdit",
                args: [params.text, params.prompt, params.cellId],
            });
            debugLog("Modified text from prompted edit:", modifiedText);
            return modifiedText;
        } catch (error) {
            console.error("Error applying prompted edit:", error);
            return null; // Return original text if there's an error
        }
    }
);

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
