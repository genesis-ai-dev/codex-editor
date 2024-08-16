import * as vscode from 'vscode';
import { Dictionary, DictionaryEntry, SpellCheckResult, SpellCheckDiagnostic } from "../../../../types";
import { SpellChecker, DictionaryManager } from './spellCheck';
import { getWorkSpaceUri } from '../../../utils';

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

    constructor(private context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('easyLanguageServer');
        this.context.subscriptions.push(this.diagnosticCollection);
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
        const diagnosticsProvider = vscode.workspace.onDidChangeTextDocument((event) => {
            const diagnostics = provider(event.document);
            this.diagnosticCollection.set(event.document.uri, diagnostics);
        });
        this.context.subscriptions.push(diagnosticsProvider);
    }

    public start(): void {
        // This method can be used to initialize any additional services or start background tasks
        console.log('EasyLanguageServer started');
    }
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
        const actions = spellChecker.provideCodeActions(document, range, { diagnostics });
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

    server.start();
}

export function deactivate() {
    // Clean up resources if needed
    console.log('EasyLanguageServer deactivated');
}