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
const pendingSmartEditsPromise: Promise<any> | null = null;
let lastSmartEditsText: string | null = null;
let lastSmartEditResults: any[] | null = null;

// Custom debug function
function debugLog(...args: any[]) {
    if (DEBUG_MODE) {
        console.log(new Date().toISOString(), ...args);
    }
}

// Define special phrases with their replacements and colors
let specialPhrases: {
    phrase: string;
    replacement: string;
    color: string;
    source: string;
    leftToken: string;
    rightToken: string;
}[] = [
    {
        phrase: "hello world",
        replacement: "hi",
        color: "purple",
        source: "llm",
        leftToken: "",
        rightToken: "",
    },
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
                        debugLog("SERVER: Spell check result:", { spellCheckResult });
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

                    const code = 0;

                    return {
                        code,
                        cellId: param.cellId,
                        savedSuggestions: { suggestions: [] },
                    };
                })
            );

            debugLog("SERVER: Returning results:", { results });

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

connection.onRequest("spellcheck/check", async (params: { text: string; cellId: string }) => {
    debugLog("SERVER: Received spellcheck/check request:", { params });

    const text = params.text;
    const matches: MatchesEntity[] = [];

    // Start parallel requests for both smart edits and ICE suggestions
    const [smartEditsPromise, iceEditsPromise] = [
        // Existing smart edits request
        !pendingSmartEditsPromise || lastSmartEditsText !== text
            ? connection.sendRequest(ExecuteCommandRequest, {
                  command: "codex-smart-edits.getEdits",
                  args: [text],
              })
            : Promise.resolve(lastSmartEditResults),

        // New ICE edits request
        connection.sendRequest(ExecuteCommandRequest, {
            command: "codex-smart-edits.getIceEdits",
            args: [text],
        }),
    ];

    // Process spell checking
    const words = tokenizeText({
        method: "whitespace_and_punctuation",
        text: params.text,
    });

    // Process traditional spell checking
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
                    .map((correction) => ({
                        value: correction,
                        source: "llm" as const,
                    })),
                offset: offset,
                length: word.length,
                cellId: params.cellId,
            });
        }
    }

    // Wait for both smart edits and ICE suggestions
    const [smartEditResults, iceResults] = await Promise.all([smartEditsPromise, iceEditsPromise]);

    // Update smart edits cache
    if (lastSmartEditsText !== text) {
        lastSmartEditsText = text;
        lastSmartEditResults = smartEditResults;
    }

    // Process smart edits
    if (smartEditResults) {
        specialPhrases = [];
        smartEditResults.forEach((suggestion: any, index: number) => {
            const source = suggestion.source || "llm";
            const color = source === "ice" ? "blue" : "purple";

            specialPhrases.push({
                phrase: suggestion.oldString,
                replacement: suggestion.newString,
                color: color,
                source: source,
                leftToken: suggestion.leftToken || "",
                rightToken: suggestion.rightToken || "",
            });
        });

        specialPhrases.forEach(({ phrase, replacement, color, source }, index) => {
            let startIndex = 0;
            const phraseLower = phrase?.toLowerCase();

            while ((startIndex = text?.toLowerCase()?.indexOf(phraseLower, startIndex)) !== -1) {
                // Get context tokens for ICE suggestions
                let leftToken = "";
                let rightToken = "";
                if (source === "ice") {
                    const words = text?.split(/\s+/);
                    const wordIndex = words?.findIndex(
                        (w, i) =>
                            text?.indexOf(
                                w,
                                i === 0 ? 0 : text?.indexOf(words[i - 1]) + words[i - 1].length
                            ) === startIndex
                    );
                    if (wordIndex !== -1) {
                        leftToken = wordIndex > 0 ? words[wordIndex - 1] : "";
                        rightToken = wordIndex < words.length - 1 ? words[wordIndex + 1] : "";
                    }
                }

                matches.push({
                    id: `SPECIAL_PHRASE_${index}_${matches.length}`,
                    text: phrase,
                    replacements: [
                        {
                            value: replacement,
                            source: source as "llm" | "ice",
                        },
                    ],
                    offset: startIndex,
                    length: phrase.length,
                    color: color as "purple" | "blue",
                    leftToken: source === "ice" ? leftToken : "",
                    rightToken: source === "ice" ? rightToken : "",
                    cellId: params.cellId,
                });
                startIndex += phrase.length;
            }
        });
    }

    // Process ICE results first
    if (iceResults && Array.isArray(iceResults)) {
        console.log("[RYDER**] iceResults", { iceResults });
        for (const suggestion of iceResults) {
            if (suggestion.rejected === true) continue;

            const wordOffset = text.indexOf(suggestion.oldString);
            if (wordOffset !== -1) {
                matches.push({
                    id: `ICE_${matches.length}`,
                    text: suggestion.oldString,
                    replacements: [
                        {
                            value: suggestion.newString,
                            confidence: suggestion.confidence,
                            source: "ice",
                            frequency: suggestion.frequency,
                        },
                    ],
                    offset: wordOffset,
                    length: suggestion.oldString.length,
                    color: "blue",
                    leftToken: suggestion.leftToken || "",
                    rightToken: suggestion.rightToken || "",
                    cellId: params.cellId,
                });
            }
        }
    }

    // Update smart edits cache and process results
    if (lastSmartEditsText !== text) {
        lastSmartEditsText = text;
        lastSmartEditResults = smartEditResults;
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
