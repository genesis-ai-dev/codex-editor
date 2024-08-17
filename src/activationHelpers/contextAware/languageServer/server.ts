import * as vscode from 'vscode';
import { Dictionary, DictionaryEntry, SpellCheckResult, SpellCheckDiagnostic } from "../../../../types";
import { SpellChecker, DictionaryManager } from './spellCheck';
import { getWorkSpaceUri } from '../../../utils';
import { VerseIndexer } from './verseIndexer';
import * as path from 'path';

// Types and interfaces
interface CustomDiagnostic {
    range: vscode.Range;
    message: string;
    severity: vscode.DiagnosticSeverity;
    source: string;
    relatedInformation?: vscode.DiagnosticRelatedInformation[];
}

interface CustomCompletion {
    label: string;
    kind: vscode.CompletionItemKind;
    detail?: string;
    documentation?: string | vscode.MarkdownString;
    insertText?: string;
}

interface CustomQuickFix {
    title: string;
    kind: vscode.CodeActionKind;
    edit?: vscode.WorkspaceEdit;
    command?: vscode.Command;
    isPreferred?: boolean;
    diagnostics?: vscode.Diagnostic[];
}

// EasyLanguageServer class
class EasyLanguageServer {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private completionProviders: vscode.Disposable[] = [];
    private codeActionProviders: vscode.Disposable[] = [];
    private hoverProviders: vscode.Disposable[] = [];
    private verseIndexer: VerseIndexer | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('easyLanguageServer');
        this.context.subscriptions.push(this.diagnosticCollection);

        const workspaceUri = getWorkSpaceUri();
        if (workspaceUri) {
            // const dbPath = path.join(workspaceUri.fsPath, '.vscode', 'verse_index.db');
            // this.verseIndexer = new VerseIndexer(dbPath);
            // vscode.window.showInformationMessage(`VerseIndexer initialized with dbPath: ${dbPath}`); // Added log
            // this.verseIndexer.initialize().catch(error => {
            // console.error('Failed to initialize VerseIndexer:', error);
            // });
        } else {
            console.error('Workspace URI not found');
        }
    }

    public addDiagnostic(diagnostic: CustomDiagnostic): void {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (uri) {
            const diagnostics = [...(this.diagnosticCollection.get(uri) || [])];
            diagnostics.push(new vscode.Diagnostic(
                diagnostic.range,
                diagnostic.message,
                diagnostic.severity
            ));
            this.diagnosticCollection.set(uri, diagnostics);
        }
    }

    public addCompletionProvider(provider: (document: vscode.TextDocument, position: vscode.Position) => CustomCompletion[]): void {
        const completionProvider = vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', language: '*' }, // Change 'scripture' to '*' or your specific language ID
            {
                provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                    const completions = provider(document, position);
                    return completions.map(completion => {
                        const item = new vscode.CompletionItem(completion.label, completion.kind);
                        item.detail = completion.detail;
                        item.documentation = completion.documentation;
                        item.insertText = completion.insertText;
                        return item;
                    });
                }
            }
        );
        this.completionProviders.push(completionProvider);
        this.context.subscriptions.push(completionProvider);
    }

    public addQuickFixProvider(provider: (document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) => vscode.CodeAction[]): void {
        const codeActionProvider = vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', language: 'scripture' },
            {
                provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) {
                    const diagnostics = context.diagnostics.filter(diagnostic => diagnostic.source === 'Spell-Check');
                    const actions = provider(document, range, context);
                    console.log('Code actions:', actions); // Debug log
                    return actions;
                }
            }
        );
        this.codeActionProviders.push(codeActionProvider);
        this.context.subscriptions.push(codeActionProvider);
    }

    public addHoverProvider(provider: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => vscode.ProviderResult<vscode.Hover>): void {
        const hoverProvider = vscode.languages.registerHoverProvider(
            { scheme: 'file', language: 'scripture' },
            { provideHover: provider }
        );
        this.hoverProviders.push(hoverProvider);
        this.context.subscriptions.push(hoverProvider);
    }

    public addDiagnosticsProvider(provider: (document: vscode.TextDocument) => SpellCheckDiagnostic[]): void {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                const changeDiagnostics = provider(event.document);
                this.diagnosticCollection.set(event.document.uri, changeDiagnostics);
            }),
            vscode.workspace.onDidOpenTextDocument((doc) => {
                const openDiagnostics = provider(doc);
                this.diagnosticCollection.set(doc.uri, openDiagnostics);
            })
        );
    }

    // public addVerseIndexingProvider(): void {
    //     const indexingProvider = vscode.workspace.onDidChangeTextDocument(async (event) => {
    //         if (this.verseIndexer && event.document.languageId === 'scripture') {
    //             const count = this.verseIndexer.indexDocument(event.document);
    //             console.log(`Indexed ${count} items`);
    //         }
    //     });
    //     this.context.subscriptions.push(indexingProvider);
    // }

    // public searchVerseIndex(query: string): any[] {
    //     if (this.verseIndexer) {
    //         return this.verseIndexer.searchIndex(query);
    //     }
    //     return [];
    // }

    public dispose(): void {
        // No need to close anything as MiniSearch is in-memory
    }

    public start(): void {
        // This method can be used to initialize any additional services or start background tasks
        console.log('EasyLanguageServer started');
    }

    // public async testIndexing(): Promise<void> {
    //     // Hard-code a file path for testing
    //     const testFilePath = vscode.Uri.file(path.join(this.context.extensionUri.fsPath, 'test', 'sample.bible'));
    //     try {
    //         const document = await vscode.workspace.openTextDocument(testFilePath);
    //         const count = await this.verseIndexer?.indexDocument(document, true); // Assuming it's a source Bible file
    //         console.log(`Indexed ${count} items from ${testFilePath}`);
    //     } catch (error) {
    //         console.error('Error during test indexing:', error);
    //     }
    // }

    // public async testSearch(): Promise<void> {
    //     const searchResults = this.verseIndexer?.searchIndex('Genesis 1:1');
    //     console.log('Search results:', searchResults);
    // }
}

// Usage example
export async function activate(context: vscode.ExtensionContext) {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.error('Workspace URI not found');
        return;
    }
    const dictionaryPath = vscode.Uri.joinPath(workspaceUri, 'files', 'project.dictionary');
    const server = new EasyLanguageServer(context);

    const dictionaryManager = new DictionaryManager(dictionaryPath);
    const spellChecker = new SpellChecker(dictionaryManager.dictionary);

    // Register spell check provider
    server.addDiagnosticsProvider((document: vscode.TextDocument) => {
        const diagnostics = spellChecker.provideDiagnostics(document);
        console.log('Diagnostics:', diagnostics); // Debug log
        return diagnostics;
    });

    // Register quick fix provider
    server.addQuickFixProvider((document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) => {
        const diagnostics = context.diagnostics.filter(diagnostic => diagnostic.source === 'Spell-Check');
        const actions = spellChecker.provideCodeActions(document, range, { diagnostic });
        console.log('Code actions:', actions); // Debug log
        return actions;
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('easyLanguageServer.addToDictionary', async (word: string) => {
            await dictionaryManager.addToDictionary(word);
            // Refresh diagnostics after adding to dictionary
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        })
    );

    // Add verse indexing provider
    // server.addVerseIndexingProvider();

    // // Register command for searching verse index
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('easyLanguageServer.searchVerseIndex', (query: string) => {
    //         return server.searchVerseIndex(query);
    //     })
    // );

    // // Register commands for testing
    // context.subscriptions.push(vscode.commands.registerCommand('easyLanguageServer.testIndexing', () => server.testIndexing()));
    // context.subscriptions.push(vscode.commands.registerCommand('easyLanguageServer.testSearch', () => server.testSearch()));

    // // Register command to reindex verses
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('easyLanguageServer.reindexVerses', async () => {
    //         if (server) {
    //             await server.reindexAllDocuments();
    //             vscode.window.showInformationMessage('All verses have been reindexed.');
    //         }
    //     })
    // );

    server.start();
}

export function deactivate() {
    // Clean up resources if needed
    console.log('EasyLanguageServer deactivated');
}