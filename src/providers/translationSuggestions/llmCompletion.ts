import * as vscode from "vscode";
import { CompletionConfig } from "./inlineCompletionsProvider";
import { extractVerseRefFromLine, verseRefRegex } from "../../utils/verseRefUtils";
import { callLLM } from "../../utils/llmUtils";
import { ChatMessage, MiniSearchVerseResult, TranslationPair } from "../../../types";

export async function llmCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    completionConfig: CompletionConfig,
    token: vscode.CancellationToken
): Promise<{ completion: string; context: any }> {
    const { contextSize, numberOfFewShotExamples, debugMode, chatSystemMessage } = completionConfig;

    const lineContent = document.lineAt(position.line).text;
    const currentLineVref = extractVerseRefFromLine(lineContent);
    // Get the source content for the current verse
    const sourceVerse: MiniSearchVerseResult | null = await vscode.commands.executeCommand(
        "translators-copilot.getSourceVerseByVrefFromAllSourceVerses",
        currentLineVref
    );
    const sourceContent = sourceVerse?.content || "";

    // Get similar source verses

    const similarSourceVerses: TranslationPair[] = await vscode.commands.executeCommand(
        "translators-copilot.getTranslationPairsFromSourceVerseQuery",
        sourceContent,
        numberOfFewShotExamples
    );

    if (!similarSourceVerses || similarSourceVerses.length === 0) {
        showNoResultsWarning();
        return { completion: "", context: null };
    }

    // Get preceding content
    const precedingContentLimit =
        contextSize === "small" ? 100 : contextSize === "medium" ? 200 : 500;
    const precedingContent = document
        .getText(new vscode.Range(0, 0, position.line, position.character))
        .slice(0, precedingContentLimit);
    const precedingVrefs = precedingContent.match(verseRefRegex) || [];
    const allPrecedingVrefs = precedingVrefs.filter((vref) => vref !== currentLineVref);

    // Get the target language
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const targetLanguage = projectConfig.get<any>("targetLanguage")?.tag || null;

    try {
        if (similarSourceVerses.length > 0) {
            const currentVref = currentLineVref || "";
            const currentVrefSourceContent = sourceVerse?.content || "";

            // Generate few-shot examples
            const fewShotExamples = similarSourceVerses
                .slice(0, numberOfFewShotExamples)
                .map(
                    (pair) =>
                        `${pair.targetVerse.vref}: ${pair.targetVerse.content} -> ${pair.targetVerse.content}`
                )
                .join("\n");

            // Get preceding translation pairs
            const precedingTranslationPairs = await Promise.all(
                allPrecedingVrefs.slice(-5).map(async (vref) => {
                    const pair: TranslationPair = await vscode.commands.executeCommand(
                        "translators-copilot.getTranslationPairFromProject",
                        vref
                    );
                    return pair
                        ? `${vref}: ${pair.sourceVerse.content} -> ${pair.targetVerse.content}`
                        : null;
                })
            );

            // Create the prompt
            const userMessageInstructions = [
                "1. Analyze the provided reference data to understand the translation patterns and style.",
                "2. Complete the partial or complete translation of the line.",
                "3. Ensure your translation fits seamlessly with the existing partial translation.",
                "4. Provide only the completed translation without any additional commentary or metadata.",
                `5. Translate only into the target language ${targetLanguage}.`,
                "6. Pay careful attention to the provided reference data.",
                "7. If in doubt, err on the side of literalness.",
            ].join("\n");

            let systemMessage = chatSystemMessage || `You are a helpful assistant`;

            systemMessage =
                systemMessage +
                `\n\nAlways translate from the source language to the target language, ${targetLanguage}, relying strictly on reference data and context provided by the user. The language may be an ultra-low resource language, so it is critical to follow the patterns and style of the provided reference data closely.`;

            systemMessage = systemMessage + `\n\n${userMessageInstructions}`;

            const userMessage = [
                "## Instructions",
                "Follow the translation patterns and style as shown.",
                "## Translation Memory",
                fewShotExamples,
                "## Current Context",
                precedingTranslationPairs.filter(Boolean).join("\n"),
                `${currentVref} ${currentVrefSourceContent} -> `,
            ].join("\n\n");

            const messages = [
                { role: "system", content: systemMessage },
                { role: "user", content: userMessage },
            ] as ChatMessage[];

            const completion = await callLLM(messages, completionConfig);

            // Debug mode logging
            if (debugMode) {
                await logDebugMessages(messages, completion);
            }

            return {
                completion,
                context: {
                    similarVerses: similarSourceVerses.length,
                    currentVref: currentVref,
                    precedingVerses: allPrecedingVrefs,
                },
            };
        } else {
            // Show warning for no results
            showNoResultsWarning();
            return { completion: "", context: null };
        }
    } catch (error) {
        console.error("Error in llmCompletion:", error);
        throw new Error(
            `An error occurred while generating the completion. ${JSON.stringify(error)}`
        );
    }
}

// Helper functions

async function logDebugMessages(messages: ChatMessage[], completion: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const messagesFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "copilot-messages.log");
    const messagesContent = messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");

    try {
        await vscode.workspace.fs.writeFile(
            messagesFilePath,
            new TextEncoder().encode(messagesContent + "\n\nAPI Response:\n" + completion)
        );
        console.log("Messages written to copilot-messages.log");

        vscode.window
            .showInformationMessage(
                `Debug messages stored in ${messagesFilePath.fsPath}`,
                "Open Log",
                "Disable Debug Mode"
            )
            .then((selection) => {
                if (selection === "Open Log") {
                    vscode.workspace.openTextDocument(messagesFilePath).then((doc) => {
                        vscode.window.showTextDocument(doc);
                    });
                } else if (selection === "Disable Debug Mode") {
                    vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "translators-copilot.debugMode"
                    );
                    vscode.window.showInformationMessage("Opening settings for debug mode.");
                }
            });
    } catch (error) {
        console.error("Error writing messages to copilot-messages.log:", error);
        throw new Error("Failed to write messages to copilot-messages.log");
    }
}

function showNoResultsWarning() {
    const warningMessage = "No relevant translated sentences found for context.";
    const detailedWarning =
        "Unable to find any relevant sentences that have already been translated. This may affect the quality of the translation suggestion.";

    vscode.window.showWarningMessage(warningMessage, "More Info", "Dismiss").then((selection) => {
        if (selection === "More Info") {
            vscode.window
                .showInformationMessage(detailedWarning, "How to Fix")
                .then((selection) => {
                    if (selection === "How to Fix") {
                        vscode.window.showInformationMessage(
                            "Try translating more sentences in nearby verses or chapters to provide better context for future suggestions."
                        );
                    }
                });
        }
    });
}
