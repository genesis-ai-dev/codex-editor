import * as vscode from 'vscode';
import { CompletionConfig } from './inlineCompletionsProvider';
import { extractVerseRefFromLine, verseRefRegex } from '../../utils/verseRefUtils';

export function llmCompletion(document: vscode.TextDocument, position: vscode.Position, completionConfig: CompletionConfig, token: vscode.CancellationToken): Promise<string> {
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

    // Call the search index command
    return new Promise<string>((resolve, reject) => {
        vscode.commands.executeCommand('translators-copilot.searchIndex', query)
            .then((results) => {
                if (Array.isArray(results) && results.length > 0) {
                    const resultCount = results.length;
                    const formattedResults = results.map(result =>
                        `${result.vref} (${result.isSourceBible ? 'Source' : 'Target'}): ${result.content.substring(0, 50)}...`
                    ).join('\n');

                    resolve(`Found ${resultCount} relevant results for "${query}":\n${formattedResults}\n\nCurrent line vref: ${currentLineVref || 'None'}. Preceding vrefs: ${allPrecedingVrefs.join(', ')}`);
                } else {
                    resolve(`No results found for "${query}". Current line vref: ${currentLineVref || 'None'}. Preceding vrefs: ${allPrecedingVrefs.join(', ')}`);
                }
            }, (error: Error) => {
                console.error("Error searching index:", error);
                reject(new Error("An error occurred while searching the index."));
            });
    });
}