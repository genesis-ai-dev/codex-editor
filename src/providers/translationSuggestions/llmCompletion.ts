import * as vscode from 'vscode';
import { CompletionConfig } from './inlineCompletionsProvider';
import { extractVerseRefFromLine, verseRefRegex } from '../../utils/verseRefUtils';
import { callLLM } from '../../utils/llmUtils';
import { ChatMessage, MiniSearchVerseResult, TranslationPair } from '../../../types';

export async function llmCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    completionConfig: CompletionConfig,
    token: vscode.CancellationToken
): Promise<{ completion: string; context: any }> {
    // Get the current line content
    // FIXME: we should be searching by the corresponding source verse content, since there is no target verse content in this context
    const lineContent = document.lineAt(position.line).text;
    console.log('hiuhiueh, line content:', lineContent);
    // Use the line content as the query string
    const currentLineVref = extractVerseRefFromLine(lineContent);
    console.log('hiuhiueh, currentLineVref:', currentLineVref);
    const sourceVerse: MiniSearchVerseResult = await vscode.commands.executeCommand('translators-copilot.getSourceVerseByVref', currentLineVref);

    console.log('hiuhiueh, source verse:', sourceVerse);
    // Ensure sourceVerse.content is a string
    const sourceContent = typeof sourceVerse.content === 'string' ? sourceVerse.content : JSON.stringify(sourceVerse.content);
    console.log('hiuhiueh sourceContent:', sourceContent);
    const translationPairs: TranslationPair[] = await vscode.commands.executeCommand('translators-copilot.getTranslationPairsFromSourceVerseQuery', sourceContent);
    console.log('hiuhiueh, translation pairs for similar verses:', translationPairs);

    // Get all preceding content in the document
    const precedingContent = document.getText(new vscode.Range(0, 0, position.line, position.character));

    // Find all preceding vrefs
    const precedingVrefs = precedingContent.match(verseRefRegex) || [];

    // Extract the current line vref

    // Separate the current line vref from the list of preceding vrefs
    const allPrecedingVrefs = precedingVrefs.filter(vref => vref !== currentLineVref);

    const {
        endpoint,
        apiKey,
        model,
        contextSize,
        additionalResourceDirectory,
        contextOmission,
        sourceBookWhitelist,
        maxTokens,
        temperature,
        mainChatLanguage,
        chatSystemMessage,
        numberOfFewShotExamples,
        debugMode
    } = completionConfig;

    // Get the target language from the configuration
    const config = vscode.workspace.getConfiguration('codex-project-manager');
    const targetLanguageConfig = config.get<any>('targetLanguage');
    const targetLanguage = targetLanguageConfig?.tag || null;

    // Call the search index command
    try {

        if (Array.isArray(translationPairs) && translationPairs.length > 0) {
            const currentVref = currentLineVref || '';
            const currentVrefSourceContent = translationPairs.find(r => r.sourceVerse.vref === currentVref)?.sourceVerse.content || '';

            // Generate few-shot examples from the translationPairs
            const fewShotExamples = translationPairs
                .filter(pair => pair.sourceVerse.vref !== currentVref)
                .slice(0, numberOfFewShotExamples)
                .map(pair => `${pair.sourceVerse.vref}: ${pair.sourceVerse.content} -> ${pair.targetVerse.content}`)
                .join('\n');

            // Get preceding content (up to n characters specified in contextSize)
            const precedingContentLimit = contextSize === 'small' ? 100 : contextSize === 'medium' ? 200 : 500;
            const vrefsInPrecedingContent = Array.from(precedingContent.match(new RegExp(verseRefRegex, 'g')) || []);
            const limitedPrecedingContent = precedingContent.slice(-precedingContentLimit).replace(vrefsInPrecedingContent[vrefsInPrecedingContent.length - 1] || '', '').trim(); // Remove the last vref, which is the one we are completing

            // Adjust the preceding content to show translation pairs
            const precedingTranslationPairsPromises = vrefsInPrecedingContent.map(async vref => {
                try {
                    const translationPair: TranslationPair | null = await vscode.commands.executeCommand('translators-copilot.getTranslationPairFromProject', vref);
                    console.log('TRANSLATION PAIR:', translationPair);
                    // Directly return the formatted string since data integrity is confirmed
                    return `${vref}: ${translationPair?.sourceVerse.content} -> ${translationPair?.targetVerse.content}`;
                } catch (error) {
                    console.error(`Error fetching translation pair for ${vref}:`, error);
                    return `${vref}: Error retrieving content`; // Keep error handling for unexpected issues
                }
            });
            console.log('BEFORE RESOLVE:', precedingTranslationPairsPromises);
            const precedingTranslationPairs = (await Promise.all(precedingTranslationPairsPromises)).join('\n');
            console.log('AFTER RESOLVE:', precedingTranslationPairs);

            // Create the prompt
            const userMessageInstructions = [
                "1. Analyze the provided reference data to understand the translation patterns and style.",
                "2. Complete the partial or complete translation of the line.",
                "3. Ensure your translation fits seamlessly with the existing partial translation.",
                "4. Your task is to provide only the completed translation without any additional commentary, backticks, additional quotation marks, etc.",
                "5. Do not output any verse references, verse numbers, or other metadata, even if they are provided in the reference data. Only the translation is needed.",
                `5. Be sure you translate only into the target language ${targetLanguage}, not into the source language, or into any other language.`,
                "6. Pay careful, detailed attention to the provided reference data.",
                "7. This translation data could put lives at risk if you do not carefully match the patterns and style of the provided reference data. If in doubt, err on the side of literalness, and the human translator will adjust for naturalness."
            ].join('\n');

            const systemMessage = [
                `You are a helpful assistant that translates from the source language`,
                `to the target language, ${targetLanguage}, relying strictly on reference`,
                `data and context provided by the user. The language may be an ultra-low`,
                `resource language, so it is critical to follow the patterns and style`,
                `of the provided reference data closely.`,
                '\n\n',
                userMessageInstructions
            ].join(' ');

            const userMessage = [
                "## Instructions",
                "Follow the translation patterns and style as shown.",
                "## Translation Memory",
                fewShotExamples,
                "## Current Context",
                precedingTranslationPairs,
                `${currentVref} ${currentVrefSourceContent} -> `
            ].join('\n\n');

            const messages = [ // TODO: experiment without the system message
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ] as ChatMessage[];

            const completion = await callLLM(messages, completionConfig);

            // Check for debug mode and log messages if enabled
            const debugMode = completionConfig.debugMode;
            if (debugMode) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    throw new Error('No workspace folder is open.');
                }
                const messagesFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, 'copilot-messages.log');
                const messagesContent = messages.map(message => `${message.role}: ${message.content}`).join('\n\n');

                try {
                    await vscode.workspace.fs.writeFile(messagesFilePath, new TextEncoder().encode(messagesContent + "\n\nAPI Response:\n" + completion));
                    console.log('Messages written to copilot-messages.log');

                    // Show information message to the user
                    vscode.window.showInformationMessage(`Debug messages stored in ${messagesFilePath.fsPath}`, 'Open Log', 'Disable Debug Mode')
                        .then(selection => {
                            if (selection === 'Open Log') {
                                vscode.workspace.openTextDocument(messagesFilePath).then(doc => {
                                    vscode.window.showTextDocument(doc);
                                });
                            } else if (selection === 'Disable Debug Mode') {
                                vscode.commands.executeCommand('workbench.action.openSettings', 'translators-copilot.debugMode');
                                vscode.window.showInformationMessage('Opening settings for debug mode.');
                            }
                        });
                } catch (error) {
                    console.error('Error writing messages to copilot-messages.log:', error);
                    throw new Error('Failed to write messages to copilot-messages.log');
                }
            }

            // Return the completion and context
            return {
                completion,
                context: {
                    resultsCount: translationPairs.length,
                    currentVref: currentVref,
                    precedingVerses: vrefsInPrecedingContent
                }
            };
        } else {
            // Show warning message for no results
            const warningMessage = 'No relevant translated sentences found for context.';
            const detailedWarning = 'Unable to find any relevant sentences that have already been translated. This may affect the quality of the translation suggestion.';

            vscode.window.showWarningMessage(warningMessage, 'More Info', 'Dismiss').then(selection => {
                if (selection === 'More Info') {
                    vscode.window.showInformationMessage(detailedWarning, 'How to Fix').then(selection => {
                        if (selection === 'How to Fix') {
                            vscode.window.showInformationMessage('Try translating more sentences in nearby verses or chapters to provide better context for future suggestions.');
                        }
                    });
                }
            });

            // Return an empty string and context when no results are found
            return { completion: '', context: null };
        }
    } catch (error) {
        console.error("Error in llmCompletion:", error);
        throw new Error("An error occurred while generating the completion.");
    }
}