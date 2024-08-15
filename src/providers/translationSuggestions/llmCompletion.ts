import * as vscode from 'vscode';
import { CompletionConfig } from './inlineCompletionsProvider';
import { extractVerseRefFromLine, verseRefRegex } from '../../utils/verseRefUtils';
import { callLLM } from '../../utils/llmUtils';
import { ChatMessage } from '../../../types';

export async function llmCompletion(document: vscode.TextDocument, position: vscode.Position, completionConfig: CompletionConfig, token: vscode.CancellationToken): Promise<string> {
    // Get the current line content
    const lineContent = document.lineAt(position.line).text;

    // Use the line content as the query string
    const query = lineContent.trim();

    // Get all preceding content in the document
    const precedingContent = document.getText(new vscode.Range(0, 0, position.line, position.character));

    // Find all preceding vrefs
    const precedingVrefs = precedingContent.match(verseRefRegex) || [];

    // Extract the current line vref
    const currentLineVref = extractVerseRefFromLine(lineContent);

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

    // Call the search index command
    try {
        const results = await vscode.commands.executeCommand('translators-copilot.searchIndex', query) as any[];

        if (Array.isArray(results) && results.length > 0) {
            const currentVref = currentLineVref || '';
            const currentVrefSourceContent = results.find(r => r.vref === currentVref && r.isSourceBible)?.content || '';

            // Generate few-shot examples from the results
            const fewShotExamples = results
                .filter(r => r.vref !== currentVref)
                .slice(0, numberOfFewShotExamples)
                .map(r => `${r.vref} ${r.isSourceBible ? r.content : ''}`)
                .join('\n');

            // Create the prompt
            const userMessageInstructions = [
                "1. Analyze the provided reference data to understand the translation patterns and style.",
                "2. Complete the partial or complete translation of the line.",
                "3. Ensure your translation fits seamlessly with the existing partial translation.",
                "4. Your task is to provide only the completed translation without any additional commentary, backticks, additional quotation marks, etc.",
                "5. Be sure you translate only into the target language, not into the source language, or into any other language.",
                "6. Pay careful, detailed attention to the provided reference data.",
                "7. This translation data could put lives at risk if you do not carefully match the patterns and style of the provided reference data. If in doubt, err on the side of literalness, and the human translator will adjust for naturalness."
            ].join('\n');

            const userMessage = [
                "## Instructions",
                userMessageInstructions,
                "## Task",
                `Translate all the following pairs:`,
                `${fewShotExamples}`,
                `${currentVref} ${currentVrefSourceContent}`,
            ].join('\n');
            const messages: ChatMessage[] = [
                { role: 'system', content: chatSystemMessage },
                { role: 'user', content: userMessage }
            ];

            const completion = await callLLM(messages, completionConfig);

            return `LLM Translation for ${currentVref}:\n${completion}\n\nContext: Found ${results.length} relevant results. Current line vref: ${currentVref}. Preceding vrefs: ${allPrecedingVrefs.join(', ')}`;
        } else {
            return `No results found for "${query}". Current line vref: ${currentLineVref || 'None'}. Preceding vrefs: ${allPrecedingVrefs.join(', ')}`;
        }
    } catch (error) {
        console.error("Error in llmCompletion:", error);
        throw new Error("An error occurred while generating the completion.");
    }
}