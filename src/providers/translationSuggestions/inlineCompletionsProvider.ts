import * as vscode from "vscode";
import { llmCompletion } from "./llmCompletion";
// import { getAiTranslation } from "./aiZeroDraftProvider";
import { extractVerseRefFromLine } from '../../utils/verseRefUtils';
import { meshCompletion } from '../../utils/completionUtils';

let shouldProvideCompletion = false;
let isAutocompletingInProgress = false;
let autocompleteCancellationTokenSource: vscode.CancellationTokenSource | undefined;
const currentSourceText = "";

export const MAX_TOKENS = 4000;
export const TEMPERATURE = 0.8;
const sharedStateExtension = vscode.extensions.getExtension("project-accelerate.shared-state-store");

export interface CompletionConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    contextSize: string;
    additionalResourceDirectory: string;
    contextOmission: boolean;
    sourceBookWhitelist: string;
    maxTokens: number;
    temperature: number;
    mainChatLanguage: string;
    chatSystemMessage: string;
    numberOfFewShotExamples: number;
    debugMode: boolean;
}

export async function triggerInlineCompletion(statusBarItem: vscode.StatusBarItem) {
    if (isAutocompletingInProgress) {
        vscode.window.showInformationMessage("Autocomplete is already in progress.");
        return;
    }

    isAutocompletingInProgress = true;
    autocompleteCancellationTokenSource = new vscode.CancellationTokenSource();

    try {
        statusBarItem.text = "$(sync~spin) Autocompleting...";
        statusBarItem.show();

        const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length > 0 && isAutocompletingInProgress) {
                cancelAutocompletion("User input detected. Autocompletion cancelled.");
            }
        });

        shouldProvideCompletion = true;
        await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger", autocompleteCancellationTokenSource.token);

        disposable.dispose();
    } catch (error) {
        console.error("Error triggering inline completion", error);
        vscode.window.showErrorMessage("Error triggering inline completion. Check the output panel for details.");
    } finally {
        shouldProvideCompletion = false;
        isAutocompletingInProgress = false;
        statusBarItem.hide();
        if (autocompleteCancellationTokenSource) {
            autocompleteCancellationTokenSource.dispose();
        }
    }
}

export async function provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
): Promise<vscode.InlineCompletionItem[] | undefined> {
    try {
        if (!shouldProvideCompletion || token.isCancellationRequested) {
            return undefined;
        }

        const completionConfig = await fetchCompletionConfig();

        // Use the verseCompletion function to get completions
        const completions = await verseCompletion(document, position, completionConfig, token);

        // Create and register CodeLens if context is available
        if (completions.length > 0 && (completions[0] as any).context) {
            const codeLens = new vscode.CodeLens(new vscode.Range(position, position), {
                title: "Show Translation Context",
                command: "translators-copilot.showTranslationContext",
                arguments: [(completions[0] as any).context]
            });
            registerCodeLens(codeLens);
        }

        shouldProvideCompletion = false;
        return completions;
    } catch (error) {
        console.error("Error providing inline completion items", error);
        vscode.window.showErrorMessage("Failed to provide inline completion. Check the output panel for details.");
        return undefined;
    } finally {
        isAutocompletingInProgress = false;
        const statusBarItem = vscode.window.createStatusBarItem();
        if (statusBarItem) {
            statusBarItem.hide();
        }
    }
}

function cancelAutocompletion(message: string) {
    if (autocompleteCancellationTokenSource) {
        autocompleteCancellationTokenSource.cancel();
        autocompleteCancellationTokenSource.dispose();
        autocompleteCancellationTokenSource = undefined;
    }
    isAutocompletingInProgress = false;
    shouldProvideCompletion = false;
    vscode.window.showInformationMessage(message);

    const statusBarItem = vscode.window.createStatusBarItem();
    if (statusBarItem) {
        statusBarItem.hide();
    }
}

async function verseCompletion(document: vscode.TextDocument, position: vscode.Position, completionConfig: CompletionConfig, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    const completions: vscode.InlineCompletionItem[] = [];
    const currentLineText = document.lineAt(position.line).text;
    const currentPosition = position.character;

    const { completion, context } = await llmCompletion(document, position, completionConfig, token);
    if (!completion) {
        vscode.window.showErrorMessage("No completion returned from LLM");
        return completions;
    }

    // Create a mock completion
    // const completion = 'mock completion';
    // const context = { mock: true };

    const meshedCompletion = meshCompletion(currentLineText.substring(0, currentPosition), completion);
    const completionStart = currentPosition - meshedCompletion.length + completion.length;
    const completionRange = new vscode.Range(position.line, completionStart, position.line, currentLineText.length);

    completions.push(new vscode.InlineCompletionItem(meshedCompletion, completionRange));
    (completions[0] as any).context = context; // Store context for CodeLens

    // // Try to get AI translation
    // const vrefMatch = currentLineText.match(/^([\w\d\s:]+):/);
    // if (vrefMatch) {
    //     const vref = vrefMatch[1].trim();
    //     const aiTranslations = getAiTranslation(vref);
    //     if (aiTranslations) {
    //         aiTranslations.forEach(translation => {
    //             const meshedTranslation = meshCompletion(currentLineText.substring(0, currentPosition), translation);
    //             completions.push(new vscode.InlineCompletionItem(meshedTranslation, completionRange));
    //         });
    //     }
    // }

    return completions;
}

export async function fetchCompletionConfig(): Promise<CompletionConfig> {
    try {
        const config = vscode.workspace.getConfiguration("translators-copilot");
        if (sharedStateExtension) {
            const stateStore = sharedStateExtension.exports;
            stateStore.updateStoreState({ key: 'currentUserAPI', value: config.get("api_key") || "" });
        }

        return {
            endpoint: config.get("defaultsRecommended.llmEndpoint") || "https://api.openai.com/v1",
            apiKey: config.get("api_key") || "",
            model: config.get("defaultsRecommended.model") || "gpt-4o",
            contextSize: config.get("contextSize") || "large",
            additionalResourceDirectory: config.get("additionalResourcesDirectory") || "",
            contextOmission: config.get("defaultsRecommended.experimentalContextOmission") || false,
            sourceBookWhitelist: config.get("defaultsRecommended.sourceBookWhitelist") || "",
            maxTokens: config.get("max_tokens") || 2048,
            temperature: config.get("temperature") || 0.8,
            mainChatLanguage: config.get("main_chat_language") || "English",
            chatSystemMessage: config.get("chatSystemMessage") || "This is a chat between a helpful Bible translation assistant and a Bible translator...",
            numberOfFewShotExamples: config.get("numberOfFewShotExamples") || 30,
            debugMode: config.get("debugMode") || false
        };
    } catch (error) {
        console.error("Error getting completion configuration", error);
        throw new Error("Failed to get completion configuration");
    }
}

function registerCodeLens(codeLens: vscode.CodeLens) {
    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'scripture' }, {
        provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
            return [codeLens];
        }
    });
}