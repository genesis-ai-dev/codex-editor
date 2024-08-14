"use strict";
import * as vscode from "vscode";
import { verseRefRegex } from "../../utils/verseRefUtils";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems,
} from "../../providers/translationSuggestions/inlineCompletionsProvider";
import { getWorkSpaceFolder } from "../../utils";
import { Dictionary, DictionaryEntry, SpellCheckResult, SpellCheckDiagnostic } from "../../../types";
import MiniSearch from 'minisearch';
import { debounce } from 'lodash';  // Make sure to install and import lodash

// TODO: let's use a sqlite db instead of the dictionary file

// Helper function to calculate Levenshtein distance
function levenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Update spellCheck function to provide suggestions based on edit distance
function spellCheck(word: string, dictionary: Dictionary): SpellCheckResult {
    const lowercaseWord = word.toLowerCase();
    const isInDictionary = dictionary.entries.some(entry => entry.headWord.toLowerCase() === lowercaseWord);

    if (isInDictionary) {
        return { word, corrections: [] };
    }

    // Find closest words in the dictionary
    const suggestions = dictionary.entries
        .map(entry => ({
            word: entry.headWord,
            distance: levenshteinDistance(lowercaseWord, entry.headWord.toLowerCase())
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)  // Get top 3 suggestions
        .map(suggestion => suggestion.word);

    return { word, corrections: suggestions };
}

// Update provideDiagnostics function to ignore verse references at the beginning of lines
function provideDiagnostics(document: vscode.TextDocument, dictionary: Dictionary): SpellCheckDiagnostic[] {
    const diagnostics: SpellCheckDiagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    lines.forEach((line, lineIndex) => {
        // Skip verse reference at the beginning of the line
        const trimmedLine = line.trimStart();
        const match = trimmedLine.match(verseRefRegex);
        const startIndex = match && trimmedLine.startsWith(match[0]) ? match[0].length : 0;

        const words = line.slice(startIndex).split(/\s+/);
        let editWindow = startIndex;

        words.forEach(word => {
            if (word.length > 0) {
                const spellCheckResult = spellCheck(word, dictionary);
                if (spellCheckResult.corrections.length > 0) {
                    const range = new vscode.Range(
                        new vscode.Position(lineIndex, editWindow),
                        new vscode.Position(lineIndex, editWindow + word.length)
                    );
                    diagnostics.push({
                        range,
                        message: `Possible spelling mistake. Suggestions: ${spellCheckResult.corrections.join(', ')}`,
                        severity: vscode.DiagnosticSeverity.Information,
                        source: 'Spell-Check'
                    });
                }
            }
            editWindow += word.length + 1; // +1 for space
        });
    });

    return diagnostics;
}

// Implement code action provider
function provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken, dictionary: Dictionary): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const diagnostics = context.diagnostics.filter(diag => diag.source === 'Spell-Check');

    diagnostics.forEach(diagnostic => {
        const word = document.getText(diagnostic.range);
        const spellCheckResult = spellCheck(word, dictionary);

        spellCheckResult.corrections.forEach((correction: string) => {
            const action = new vscode.CodeAction(`${word} → ${correction}`, vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, diagnostic.range, correction);
            actions.push(action);
        });

        const addToDictionaryAction = new vscode.CodeAction(`${word} → 📖`, vscode.CodeActionKind.QuickFix);
        addToDictionaryAction.command = {
            command: 'extension.addToDictionary',
            title: 'Add to Dictionary',
            arguments: [word]
        };
        actions.push(addToDictionaryAction);
    });

    return actions;
}

// Function to generate a unique ID
function generateUniqueId() {
    return Math.random().toString(36).substr(2, 9);
}

// Function to generate a hash
function generateHash(word: string) {
    // FIXME: this should be an image hash
    return word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0).toString();
}

// Function to add word to dictionary
async function addToDictionary(word: string, dictionary: Dictionary) {
    const newEntry: DictionaryEntry = {
        id: generateUniqueId(),
        headWord: word,
        hash: generateHash(word)
    };
    dictionary.entries.push(newEntry);

    // Serialize and save updated dictionary to file
    try {
        const serializedDictionary = JSON.stringify(dictionary, null, 2);
        await vscode.workspace.fs.writeFile(dictionaryPath, Buffer.from(serializedDictionary));
    } catch (error) {
        console.error('Error saving dictionary:', error);
        vscode.window.showErrorMessage('Failed to save dictionary. Please try again.');
    }
}

const workspaceFolder = getWorkSpaceFolder();
const dictionaryPath = vscode.Uri.file(
    `${workspaceFolder}/files/project.dictionary`
);

interface FileManifest {
    [filePath: string]: number; // last modified timestamp
}

const manifestPath = vscode.Uri.file(
    `${workspaceFolder}/.project/copilot_server_minisearch_index_manifest.json`
);

async function loadManifest(): Promise<FileManifest> {
    try {
        const data = await vscode.workspace.fs.readFile(manifestPath);
        return JSON.parse(Buffer.from(data).toString('utf8'));
    } catch (error) {
        return {};
    }
}

async function saveManifest(manifest: FileManifest) {
    const data = JSON.stringify(manifest, null, 2);
    await vscode.workspace.fs.writeFile(manifestPath, Buffer.from(data, 'utf8'));
}

async function checkIfIndexNeedsUpdate(): Promise<boolean> {
    const manifest = await loadManifest();
    const currentTime = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000; // milliseconds in a week

    // Force re-index if it's been more than a week since last full re-index
    if (!manifest['lastFullReindex'] || currentTime - manifest['lastFullReindex'] > oneWeek) {
        return true;
    }

    const filesToCheck = [
        ...await vscode.workspace.findFiles('**/*.bible'),
        ...await vscode.workspace.findFiles('**/*.codex')
    ];

    for (const file of filesToCheck) {
        const stats = await vscode.workspace.fs.stat(file);
        if (!manifest[file.fsPath] || stats.mtime > manifest[file.fsPath]) {
            return true;
        }
    }

    return false;
}

export async function createTypescriptLanguageServer(context: vscode.ExtensionContext) {
    // Check if Translators Copilot is enabled
    const config = vscode.workspace.getConfiguration('translators-copilot-server');
    const isCopilotEnabled = config.get<boolean>('enable', true);

    if (!isCopilotEnabled) {
        vscode.window.showInformationMessage("Translators Copilot Server is disabled. Language server not activated.");
        return;
    }

    vscode.window.showInformationMessage("Translators Copilot Server activated");
    const languages = ["scripture"];
    const disposables = languages.map((language) => {
        return vscode.languages.registerInlineCompletionItemProvider(language, {
            provideInlineCompletionItems,
        });
    });
    disposables.forEach((disposable) => context.subscriptions.push(disposable));

    // TODO: Enhance completion providers
    // - Implement spell completion (port from spelling.py)
    // - Implement text forecasting completion (port from servable_forecasting.py)
    // - Register completion providers with the server
    // TODO: Inline completions - need to finish
    // const commandDisposable = vscode.commands.registerCommand(
    //     "extension.triggerInlineCompletion",
    //     triggerInlineCompletion,
    //     triggerInlineCompletion,
    // );
    // vscode.window.onDidChangeTextEditorSelection((e) => {
    //     const shouldTriggerInlineCompletion = e.length > 0;
    //     if (shouldTriggerInlineCompletion) {
    //         triggerInlineCompletion();
    //     }
    // });

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

    // FEATURE: Diagnostic providers
    let dictionary: Dictionary | null = null;

    // Read the dictionary file
    if (workspaceFolder) {

        // Try creating the dictionary if it doesn't exist
        try {
            await vscode.workspace.fs.stat(dictionaryPath);
        } catch {
            // File doesn't exist, create it with an empty dictionary
            const emptyDictionary = { entries: [] };
            await vscode.workspace.fs.writeFile(
                dictionaryPath,
                Buffer.from(JSON.stringify(emptyDictionary))
            );
            vscode.window.showInformationMessage("Created new empty dictionary.");
        }

        try {
            const content = await vscode.workspace.fs.readFile(dictionaryPath);
            dictionary = JSON.parse(content.toString());
            if (dictionary) {
                const wordCount = dictionary.entries.length;
                vscode.window.showInformationMessage(`Dictionary loaded with ${wordCount} words.`);
            } else {
                vscode.window.showErrorMessage("Failed to load dictionary. Code 2");
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Failed to read or parse dictionary: ${error.message}`
            );
        }
    }
    if (!dictionary) {
        vscode.window.showErrorMessage("Failed to load dictionary. Code 1");
        return;
    }
    if (dictionary) {
        // Register diagnostic provider
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('spell-check');
        context.subscriptions.push(diagnosticCollection);

        const updateDiagnostics = (document: vscode.TextDocument) => {
            const diagnostics = provideDiagnostics(document, dictionary!);
            diagnosticCollection.set(document.uri, diagnostics);
        };

        // Update diagnostics for all open text documents immediately
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.languageId === 'scripture') { // Only check 'scripture' files
                updateDiagnostics(doc);
            }
        });

        // Update diagnostics on document open and change, but only for 'scripture' files
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.languageId === 'scripture') {
                    updateDiagnostics(doc);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'scripture') {
                    updateDiagnostics(event.document);
                }
            })
        );

        // Register code action provider only for 'scripture' files
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider('scripture', {
                provideCodeActions: (document, range, context, token) =>
                    provideCodeActions(document, range, context, token, dictionary!)
            })
        );

        // Register command to add words to dictionary
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.addToDictionary', async (word: string) => {
                await addToDictionary(word, dictionary!,);
                vscode.window.showInformationMessage(`Added '${word}' to dictionary.`);
                // Refresh diagnostics for all open documents
                vscode.workspace.textDocuments.forEach(updateDiagnostics);
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
    // Initialize MiniSearch instance
    let miniSearch = new MiniSearch({
        fields: ['vref', 'book', 'chapter', 'fullVref', 'content'],
        storeFields: ['vref', 'book', 'chapter', 'fullVref', 'content', 'uri', 'line'],
        searchOptions: {
            boost: { vref: 2, fullVref: 3 },
            fuzzy: 0.2
        }
    });

    interface minisearchDoc {
        id: string;
        vref: string;
        book: string;
        chapter: string;
        verse: string;
        content: string;
        uri: string;
        line: number;
        isSourceBible: boolean;
    }

    // Function to index a document
    function indexDocument(document: vscode.TextDocument, isSourceBible: boolean = false) {
        vscode.window.showInformationMessage(`Indexing document: ${document.uri}`);
        const uri = document.uri.toString();
        const lines = document.getText().split('\n');
        lines.forEach((line, lineIndex) => {
            const match = line.match(verseRefRegex);
            if (match) {
                const [vref] = match;
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':');
                const content = line.substring(match.index! + match[0].length).trim();
                const id = `${isSourceBible ? 'source' : 'target'}:${uri}:${lineIndex}:${vref}`;

                // Remove existing entry with the same ID before adding
                miniSearch.remove({ id });

                try {
                    miniSearch.add({
                        id,
                        vref,
                        book,
                        chapter,
                        verse,
                        content,
                        uri,
                        line: lineIndex,
                        isSourceBible
                    } as minisearchDoc);
                } catch (error) {
                    console.error(`Error indexing document ${uri} at line ${lineIndex}:`, error);
                }
            }
        });
    }

    // Debounced function to update index
    const debouncedUpdateIndex = debounce(async (event: vscode.TextDocumentChangeEvent) => {
        const document = event.document;
        if (document.languageId === 'scripture' || document.fileName.endsWith('.codex')) {
            // Remove old entries for this document
            const docsToRemove = miniSearch.search(document.uri.toString(), {
                fields: ['uri'],
                combineWith: 'AND'
            });
            miniSearch.removeAll(docsToRemove.map(doc => doc.id));
            // Re-index the document
            indexDocument(document);
            await serializeIndex(miniSearch);
        }
    }, 1000);  // 1000ms debounce time

    const allSourceBiblesPath = vscode.Uri.file(
        `${workspaceFolder}/.project/sourceTextBibles`
    );

    // Function to index all source Bibles
    async function indexSourceBible() {
        vscode.window.showInformationMessage(`Indexing all source Bibles`);

        if (workspaceFolder) {
            try {
                const files = await vscode.workspace.fs.readDirectory(allSourceBiblesPath);
                const biblePaths = files.filter(([name, type]) => name.endsWith('.bible') && type === vscode.FileType.File);

                if (biblePaths.length === 0) {
                    vscode.window.showWarningMessage('No source Bibles found to index.');
                    return;
                }

                for (const [fileName, _] of biblePaths) {
                    const sourcePath = vscode.Uri.joinPath(allSourceBiblesPath, fileName);
                    try {
                        const document = await vscode.workspace.openTextDocument(sourcePath);
                        indexDocument(document, true);
                        vscode.window.showInformationMessage(`Indexed source Bible: ${fileName}`);
                    } catch (error) {
                        console.error(`Error reading source Bible ${fileName}:`, error);
                        vscode.window.showErrorMessage(`Failed to read source Bible file: ${fileName}`);
                    }
                }
            } catch (error) {
                console.error('Error reading source Bible directory:', error);
                vscode.window.showErrorMessage('Failed to read source Bible directory.');
            }
        } else {
            vscode.window.showErrorMessage('Workspace folder not found.');
        }
    }

    const targetDraftsPath = vscode.Uri.file(
        `${workspaceFolder}/files/target`
    );
    // Function to index target Bible
    async function indexTargetBible() {
        vscode.window.showInformationMessage(`Indexing target Bible`);
        const config = vscode.workspace.getConfiguration('translators-copilot-server');
        const targetBible = config.get<string>('targetBible');
        if (targetBible && workspaceFolder) {
            const targetPath = vscode.Uri.joinPath(targetDraftsPath, `${targetBible}.codex`);
            try {
                const document = await vscode.workspace.openTextDocument(targetPath);
                indexDocument(document);
            } catch (error) {
                console.error('Error reading target Bible:', error);
                vscode.window.showErrorMessage('Failed to read target Bible file.');
            }
        }
    }

    // Function to index target drafts
    async function indexTargetDrafts() {
        vscode.window.showInformationMessage(`Indexing target drafts`);
        if (workspaceFolder) {
            vscode.window.showInformationMessage(`Indexing target drafts`);
            const pattern = new vscode.RelativePattern(targetDraftsPath, '**/*.codex');
            const files = await vscode.workspace.findFiles(pattern);

            for (const file of files) {
                if (await hasFileChanged(file)) {
                    try {
                        const document = await vscode.workspace.openTextDocument(file);
                        indexDocument(document);
                    } catch (error) {
                        console.error(`Error reading target draft ${file.fsPath}:`, error);
                    }
                }
            }
        }
    }

    const minisearchIndexPath = vscode.Uri.file(
        `${workspaceFolder}/.vscode/minisearch_index.json`
    );

    // Function to serialize the MiniSearch index
    async function serializeIndex(miniSearch: MiniSearch) {
        vscode.window.showInformationMessage(`Serializing index`);
        const serialized = JSON.stringify(miniSearch.toJSON());

        // Write directly to the file
        await vscode.workspace.fs.writeFile(minisearchIndexPath, Buffer.from(serialized, 'utf8'));
    }

    // Function to load the serialized index
    async function loadSerializedIndex(): Promise<MiniSearch | null> {
        vscode.window.showInformationMessage(`Loading serialized index`);
        try {
            const data = await vscode.workspace.fs.readFile(minisearchIndexPath);
            const dataString = Buffer.from(data).toString('utf8');

            // Validate JSON before parsing
            JSON.parse(dataString);

            return MiniSearch.loadJSON(dataString, {
                fields: ['vref', 'book', 'chapter', 'fullVref', 'content'],
                storeFields: ['vref', 'book', 'chapter', 'fullVref', 'content', 'uri', 'line']
            });
        } catch (error) {
            console.error('Error loading serialized index:', error);

            // If there's an error, attempt to delete the corrupted file
            try {
                await vscode.workspace.fs.delete(minisearchIndexPath);
                vscode.window.showWarningMessage('Corrupted index file deleted. A new index will be created.');
            } catch (unlinkError) {
                console.error('Error deleting corrupted index file:', unlinkError);
            }

            return null;
        }
    }

    // Initialize indexing
    async function initializeIndexing() {
        vscode.window.showInformationMessage(`Initializing index`);
        const loadedIndex = await loadSerializedIndex();
        if (loadedIndex) {
            miniSearch = loadedIndex;
            vscode.window.showInformationMessage(`Loaded serialized index`);

            // Check if we need to update the index
            const needsUpdate = await checkIfIndexNeedsUpdate();
            if (needsUpdate) {
                vscode.window.showInformationMessage(`Updating existing index`);
                await updateIndex();
            }
        } else {
            vscode.window.showInformationMessage(`Building new index`);
            await rebuildFullIndex();
        }
    }

    async function rebuildFullIndex() {
        await indexSourceBible();
        await indexTargetBible();
        await indexTargetDrafts();
        vscode.workspace.textDocuments.forEach(doc => indexDocument(doc));
        await serializeIndex(miniSearch);
    }

    async function updateIndex() {
        const manifest = await loadManifest();
        const currentTime = Date.now();

        await indexSourceBible();
        await indexTargetBible();
        await indexTargetDrafts();

        // Update manifest with new timestamps
        const filesToUpdate = [
            ...await vscode.workspace.findFiles('**/*.bible'),
            ...await vscode.workspace.findFiles('**/*.codex')
        ];

        for (const file of filesToUpdate) {
            const stats = await vscode.workspace.fs.stat(file);
            manifest[file.fsPath] = stats.mtime;
        }

        manifest['lastFullReindex'] = currentTime;
        await saveManifest(manifest);
        await serializeIndex(miniSearch);
    }

    // Set up event listeners
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(debouncedUpdateIndex),
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            indexDocument(doc);
            await serializeIndex(miniSearch);
        })
    );

    async function hasFileChanged(filePath: vscode.Uri): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(filePath);
            const lastModified = stat.mtime;
            const manifest = await loadManifest();
            return !manifest[filePath.fsPath] || lastModified > manifest[filePath.fsPath];
        } catch (error) {
            console.error(`Error checking if file ${filePath.fsPath} has changed:`, error);
            return true; // Assume the file has changed if there's an error
        }
    }

    // Call initializeIndexing
    initializeIndexing().catch(error => {
        console.error('Error initializing indexing:', error);
        vscode.window.showErrorMessage('Failed to initialize indexing.');
    });

    // Function to search the index
    function searchIndex(query: string) {
        const results = miniSearch.search(query);
        processSearchResults(results, query);
        return results;
    }

    function processSearchResults(results: any[], query: string) {
        // Process the results here
        vscode.window.showInformationMessage(`Processing ${results.length} results for query: ${query}`);

        // Here we need to use the parallel passages retrieved by the text selection 
        // handler (or whatever calling process) and pass them to the LAD and 
        // autocomplete functions, then return the results to the calling process

    }

    function handleTextSelection(selectedText: string) {
        return searchIndex(selectedText);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('translators-copilot.searchIndex', (query: string) => {
            return searchIndex(query);
        })
    );

    // Add a command to force re-indexing
    context.subscriptions.push(
        vscode.commands.registerCommand('translators-copilot.forceReindex', async () => {
            vscode.window.showInformationMessage('Force re-indexing started');
            await rebuildFullIndex();
            vscode.window.showInformationMessage('Force re-indexing completed');
        })
    );

    // TODO: Implement handlers for various socket requests (search, LAD, etc.)
    // Note - we did other things with the python websocket messenger. That's what I want to implement here

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

    // Expose the search function
    return {
        handleTextSelection,
        // ... other functions or objects you want to expose
    };
}