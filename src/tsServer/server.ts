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
} from "./spellCheck";
import {
    MatchesEntity,
} from "../../webviews/codex-webviews/src/CodexCellEditor/react-quill-spellcheck/types";
import { RequestType } from "vscode-languageserver";
import { tokenizeText } from "../utils/nlpUtils";
import { GetAlertCodes, AlertCodesServerResponse } from "@types";

const DEBUG_MODE = false; // Flag for debug mode

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const ExecuteCommandRequest = new RequestType<{ command: string; args: any[]; }, any, void>(
    "workspace/executeCommand"
);

let spellChecker: SpellChecker;
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

    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: 1, // Incremental
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
                    try {
                        const words = tokenizeText({
                            method: "whitespace_and_punctuation",
                            text: param.text,
                        });

                        // spellcheck
                        for (const word of words) {
                            try {
                                const spellCheckResult = await spellChecker.spellCheck(word);
                                debugLog("SERVER: Spell check result:", { spellCheckResult });
                                if (spellCheckResult?.corrections?.length > 0) {
                                    return {
                                        code: 1,
                                        cellId: param.cellId,
                                        savedSuggestions: { suggestions: [] },
                                    };
                                }
                            } catch (wordError) {
                                console.error("[Language Server] Spell check failed for word:", {
                                    word,
                                    cellId: param.cellId,
                                    error: wordError instanceof Error ? wordError.message : String(wordError),
                                    stack: wordError instanceof Error ? wordError.stack : undefined
                                });
                                // Continue processing other words
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
                    } catch (cellError) {
                        console.error("[Language Server] Alert code processing failed for cell:", {
                            cellId: param.cellId,
                            textLength: param.text?.length || 0,
                            error: cellError instanceof Error ? cellError.message : String(cellError),
                            stack: cellError instanceof Error ? cellError.stack : undefined
                        });
                        // Return safe fallback for this cell
                        return {
                            code: 0,
                            cellId: param.cellId,
                            savedSuggestions: { suggestions: [] },
                        };
                    }
                })
            );

            debugLog("SERVER: Returning results:", { results });
            return results;
        } catch (error) {
            console.error("[Language Server] Critical failure in getAlertCodes:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                requestCount: params?.length || 0,
                cellIds: params?.map(p => p.cellId) || []
            });
            // Return safe fallback for all requested cells
            return params.map((param) => ({
                code: 0,
                cellId: param.cellId,
                savedSuggestions: { suggestions: [] },
            }));
        }
    }
);

connection.onRequest("spellcheck/check", async (params: { text: string; cellId: string; }) => {
    try {
        debugLog("SERVER: Received spellcheck/check request:", { params });

        const text = params.text;
        const matches: MatchesEntity[] = [];

        // Start parallel requests for both smart edits and ICE suggestions
        let smartEditsPromise: Promise<any>;
        let iceEditsPromise: Promise<any>;

        try {
            smartEditsPromise = lastSmartEditsText !== text
                ? connection.sendRequest(ExecuteCommandRequest, {
                    command: "codex-smart-edits.getEdits",
                    args: [text, params.cellId],
                })
                : Promise.resolve(lastSmartEditResults);

            // New ICE edits request
            iceEditsPromise = connection.sendRequest(ExecuteCommandRequest, {
                command: "codex-smart-edits.getIceEdits",
                args: [text],
            });
        } catch (requestError) {
            console.error("[Language Server] Failed to initiate smart edits requests:", {
                error: requestError instanceof Error ? requestError.message : String(requestError),
                stack: requestError instanceof Error ? requestError.stack : undefined,
                cellId: params.cellId,
                textLength: text?.length || 0
            });
            // Continue with spell checking even if smart edits fail
            smartEditsPromise = Promise.resolve(null);
            iceEditsPromise = Promise.resolve(null);
        }

        // Process spell checking
        try {
            const words = tokenizeText({
                method: "whitespace_and_punctuation",
                text: params.text,
            });

            // Process traditional spell checking
            for (const word of words) {
                if (!word) continue;

                try {
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
                } catch (wordError) {
                    console.error("[Language Server] Spell check failed for individual word:", {
                        word,
                        cellId: params.cellId,
                        error: wordError instanceof Error ? wordError.message : String(wordError),
                        stack: wordError instanceof Error ? wordError.stack : undefined
                    });
                    // Continue processing other words
                }
            }
        } catch (spellError) {
            console.error("[Language Server] Traditional spell checking failed:", {
                error: spellError instanceof Error ? spellError.message : String(spellError),
                stack: spellError instanceof Error ? spellError.stack : undefined,
                cellId: params.cellId,
                textLength: text?.length || 0
            });
            // Continue to smart edits processing
        }

        // Wait for both smart edits and ICE suggestions
        let smartEditResults = null;
        let iceResults = null;

        try {
            [smartEditResults, iceResults] = await Promise.all([smartEditsPromise, iceEditsPromise]);
        } catch (smartEditsError) {
            console.error("[Language Server] Smart edits processing failed:", {
                error: smartEditsError instanceof Error ? smartEditsError.message : String(smartEditsError),
                stack: smartEditsError instanceof Error ? smartEditsError.stack : undefined,
                cellId: params.cellId
            });
            // Continue with what we have
        }

        // Update smart edits cache
        if (lastSmartEditsText !== text) {
            lastSmartEditsText = text;
            lastSmartEditResults = smartEditResults;
        }

        // Process smart edits
        if (smartEditResults) {
            try {
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
                    try {
                        let startIndex = 0;
                        const phraseToSearch = phrase?.trim(); // Trim whitespace before searching
                        if (!phraseToSearch) return; // Skip if phrase is empty after trimming

                        const phraseLower = phraseToSearch.toLowerCase();

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
                                text: phrase, // Display original phrase in popup
                                replacements: [
                                    {
                                        value: replacement,
                                        source: source as "llm" | "ice",
                                    },
                                ],
                                offset: startIndex,                // Use the found index
                                length: phraseToSearch.length,    // Use the *trimmed* length for the underline
                                color: color as "purple" | "blue",
                                leftToken: source === "ice" ? leftToken : "",
                                rightToken: source === "ice" ? rightToken : "",
                                cellId: params.cellId,
                            });
                            startIndex += phraseToSearch.length; // Advance by the *trimmed* length
                        }
                    } catch (phraseError) {
                        console.error("[Language Server] Failed to process smart edit phrase:", {
                            phrase,
                            index,
                            cellId: params.cellId,
                            error: phraseError instanceof Error ? phraseError.message : String(phraseError),
                            stack: phraseError instanceof Error ? phraseError.stack : undefined
                        });
                        // Continue processing other phrases
                    }
                });
            } catch (smartEditProcessingError) {
                console.error("[Language Server] Smart edit results processing failed:", {
                    error: smartEditProcessingError instanceof Error ? smartEditProcessingError.message : String(smartEditProcessingError),
                    stack: smartEditProcessingError instanceof Error ? smartEditProcessingError.stack : undefined,
                    cellId: params.cellId,
                    resultsCount: smartEditResults?.length || 0
                });
                // Continue to ICE processing
            }
        }

        // Process ICE results
        if (iceResults && Array.isArray(iceResults)) {
            try {
                for (const suggestion of iceResults) {
                    try {
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
                    } catch (iceItemError) {
                        console.error("[Language Server] Failed to process ICE suggestion:", {
                            suggestion,
                            cellId: params.cellId,
                            error: iceItemError instanceof Error ? iceItemError.message : String(iceItemError),
                            stack: iceItemError instanceof Error ? iceItemError.stack : undefined
                        });
                        // Continue processing other ICE suggestions
                    }
                }
            } catch (iceProcessingError) {
                console.error("[Language Server] ICE results processing failed:", {
                    error: iceProcessingError instanceof Error ? iceProcessingError.message : String(iceProcessingError),
                    stack: iceProcessingError instanceof Error ? iceProcessingError.stack : undefined,
                    cellId: params.cellId,
                    resultsCount: iceResults?.length || 0
                });
                // Continue with what we have
            }
        }

        debugLog(`Returning matches: ${JSON.stringify(matches)}`);
        return matches;
    } catch (error) {
        console.error("[Language Server] Critical failure in spellcheck/check:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            cellId: params?.cellId,
            textLength: params?.text?.length || 0
        });
        // Return empty matches array as safe fallback
        return [];
    }
});

connection.onRequest(
    "spellcheck/applyPromptedEdit",
    async (params: { text: string; prompt: string; cellId: string; }) => {
        try {
            debugLog("Received spellcheck/applyPromptedEdit request:", { params });

            const modifiedText = await connection.sendRequest(ExecuteCommandRequest, {
                command: "codex-smart-edits.applyPromptedEdit",
                args: [params.text, params.prompt, params.cellId],
            });

            debugLog("Modified text from prompted edit:", modifiedText);
            return modifiedText;
        } catch (error) {
            console.error("[Language Server] Prompted edit request failed:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                cellId: params?.cellId,
                textLength: params?.text?.length || 0,
                promptLength: params?.prompt?.length || 0
            });
            // Return original text as safe fallback
            return params?.text || null;
        }
    }
);

connection.onRequest("spellcheck/addWord", async (params: { words: string[]; }) => {
    try {
        debugLog("Received spellcheck/addWord request:", { params });

        if (!spellChecker) {
            console.error("[Language Server] SpellChecker not initialized for addWord request:", {
                requestedWords: params?.words || [],
                wordsCount: params?.words?.length || 0
            });
            throw new Error("SpellChecker is not initialized.");
        }

        await spellChecker.addWords(params.words);
        debugLog("Words successfully added to the dictionary.");
        return { success: true };
    } catch (error) {
        console.error("[Language Server] Add word request failed:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            requestedWords: params?.words || [],
            wordsCount: params?.words?.length || 0,
            spellCheckerAvailable: !!spellChecker
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
});

documents.listen(connection);
connection.listen();
