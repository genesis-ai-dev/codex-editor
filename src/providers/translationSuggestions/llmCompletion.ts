import * as vscode from "vscode";
import { CompletionConfig } from "./inlineCompletionsProvider";
import { callLLM } from "../../utils/llmUtils";
import { ChatMessage, MiniSearchVerseResult, TranslationPair } from "../../../types";
import { CodexNotebookReader, CodexNotebookCell } from "../../serializer";

export async function llmCompletion(
    documentUri: vscode.Uri,
    currentCellId: string,
    completionConfig: CompletionConfig,
    token: vscode.CancellationToken
): Promise<string> {
    const { contextSize, numberOfFewShotExamples, debugMode, chatSystemMessage } = completionConfig;

    if (!documentUri) {
        throw new Error(`No document URI provided in llmCompletion().`);
    }
    if (!currentCellId) {
        throw new Error("Current cell has no ID in llmCompletion().");
    }

    const currentNotebookReader = new CodexNotebookReader(documentUri);

    // Get the source content for the current verse
    const sourceVerse: MiniSearchVerseResult | null = await vscode.commands.executeCommand(
        "translators-copilot.getSourceVerseByVrefFromAllSourceVerses",
        currentCellId
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
        return "";
    }

    // Get preceding cells and their IDs, limited by context size
    const currentCellIndex = await currentNotebookReader.getCellIndex({ id: currentCellId });
    const contextLimit = contextSize === "small" ? 5 : contextSize === "medium" ? 10 : 50;
    const allPrecedingCells = await currentNotebookReader.cellsUpTo(currentCellIndex);
    const precedingCells = allPrecedingCells.slice(
        Math.max(0, allPrecedingCells.length - contextLimit)
    ); // FIXME: by reading from the file, the current editor content is not fresh....

    // Filter preceding cells to only include text cells
    const textPrecedingCells = precedingCells.filter(
        (cell) => cell.metadata?.type === "text" && cell.metadata?.id !== currentCellId
    );

    // Get the target language
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const targetLanguage = projectConfig.get<any>("targetLanguage")?.tag || null;

    try {
        const currentVref = currentCellId;
        const currentVrefSourceContent = sourceVerse?.content || "";

        // Generate few-shot examples
        const fewShotExamples = similarSourceVerses
            .slice(0, numberOfFewShotExamples)
            .map(
                (pair) =>
                    `${pair.targetVerse.vref}: ${pair.sourceVerse.content} -> ${pair.targetVerse.content}`
            )
            .join("\n");

        // Get preceding translation pairs (note - ensure fresh from file)
        const precedingTranslationPairs = await Promise.all(
            textPrecedingCells.slice(-5).map(async (cellFromPrecedingContext) => {
                const sourceContentForPrecedingContextCell: MiniSearchVerseResult | null =
                    await vscode.commands.executeCommand(
                        "translators-copilot.getSourceVerseByVrefFromAllSourceVerses",
                        // NOTE: we use this command to ensure the immediately preceding context is not stale in the translation pairs index, but comes right from the file.
                        cellFromPrecedingContext.metadata?.id
                    );

                if (!sourceContentForPrecedingContextCell) {
                    return null;
                }

                const cellFromPrecedingContextWithoutHTMLTags = cellFromPrecedingContext.value
                    .replace(/<[^>]*?>/g, "") // NOTE: we are removing HTML tags here. Otherwise the html gets directly inserted into the final destination context, e.g., the Quill editor, which means it is not rendered html, but raw string tags in the middle of the editor.
                    .trim();

                const result = `${cellFromPrecedingContext.metadata?.id}: ${sourceContentForPrecedingContextCell.content} -> ${cellFromPrecedingContextWithoutHTMLTags}`;
                console.log("precedingTranslationPairs", result);
                return result;
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
        systemMessage += `\n\nAlways translate from the source language to the target language, ${targetLanguage}, relying strictly on reference data and context provided by the user. The language may be an ultra-low resource language, so it is critical to follow the patterns and style of the provided reference data closely.`;
        systemMessage += `\n\n${userMessageInstructions}`;

        const userMessage = [
            "## Instructions",
            "Follow the translation patterns and style as shown.",
            "## Translation Memory",
            fewShotExamples,
            "## Current Context",
            precedingTranslationPairs.filter(Boolean).join("\n"),
            `${currentVref} ${currentVrefSourceContent} ->`,
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

        return completion;
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
