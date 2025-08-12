import * as vscode from "vscode";
import { CompletionConfig } from "@/utils/llmUtils";
import { callLLM } from "../../utils/llmUtils";
import { ChatMessage, MinimalCellResult, TranslationPair } from "../../../types";
import { CodexNotebookReader } from "../../serializer";
import { CodexCellTypes } from "../../../types/enums";
import { getAutoCompleteStatusBarItem } from "../../extension";
import { tokenizeText } from "../../utils/nlpUtils";
import { buildFewShotExamplesText, buildMessages, fetchFewShotExamples, getPrecedingTranslationPairs } from "./shared";
// A/B testing disabled for now

export interface LLMCompletionResult {
    variants: string[]; // Always present; length 1 for non-AB scenarios
    isABTest: boolean; // True only when variants.length > 1
    testId?: string;
}

export async function llmCompletion(
    currentNotebookReader: CodexNotebookReader, // FIXME: if we just read the file as CodexNotebookAsJSONData (or whatever it's called), we can speed this up a lot because the notebook deserializer is really slow
    currentCellId: string,
    completionConfig: CompletionConfig,
    token: vscode.CancellationToken,
    returnHTML: boolean = true
): Promise<LLMCompletionResult> {
    const { contextSize, numberOfFewShotExamples, debugMode, chatSystemMessage } = completionConfig;

    if (!currentCellId) {
        throw new Error("Current cell has no ID in llmCompletion().");
    }

    const statusBarItem = getAutoCompleteStatusBarItem();
    statusBarItem.show();

    try {
        // Get the source content for the current cell(s)
        const currentCellIndex = await currentNotebookReader.getCellIndex({ id: currentCellId });
        const currentCellIds = await currentNotebookReader.getCellIds(currentCellIndex);

        const sourceCells = await Promise.all(
            currentCellIds.map(async (id) => {
                const result = await vscode.commands.executeCommand(
                    "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                    id
                ) as MinimalCellResult | null;

                if (!result) {
                    console.warn(`[llmCompletion] No source content found for cell ID: ${id}`);
                }

                return result;
            })
        );

        const validSourceCells = sourceCells.filter(Boolean);
        if (validSourceCells.length === 0) {
            console.error(`[llmCompletion] No source content found for any of the cell IDs: ${currentCellIds.join(", ")}`);
            throw new Error(`No source content found for cell ${currentCellId}. The search index may be incomplete. Try running "Force Complete Rebuild" from the command palette.`);
        }

        const sourceContent = validSourceCells
            .map((cell) => cell!.content)
            .join(" ");

        // Get few-shot examples (existing behavior encapsulated)
        const finalExamples = await fetchFewShotExamples(
            sourceContent,
            currentCellId,
            numberOfFewShotExamples,
            completionConfig.useOnlyValidatedExamples
        );

        // Get preceding cells and their IDs, limited by context size
        const contextLimit = contextSize === "small" ? 5 : contextSize === "medium" ? 10 : 50;
        const allPrecedingCells = await currentNotebookReader.cellsUpTo(currentCellIndex);
        const precedingCells = allPrecedingCells.slice(
            Math.max(0, allPrecedingCells.length - contextLimit)
        ); // FIXME: by reading from the file, the current editor content is not fresh....

        // Filter preceding cells to only include text cells
        const textPrecedingCells = precedingCells.filter(
            (cell) =>
                cell.metadata?.type === CodexCellTypes.TEXT && cell.metadata?.id !== currentCellId
        );

        const precedingTranslationPairs = await getPrecedingTranslationPairs(
            currentNotebookReader,
            currentCellId,
            currentCellIndex,
            contextSize
        );

        // Get the target language
        const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
        const targetLanguage = projectConfig.get<any>("targetLanguage")?.tag || null;

        try {
            const currentCellId = currentCellIds.join(", ");
            const currentCellSourceContent = sourceContent;

            // Generate few-shot examples
            const fewShotExamples = buildFewShotExamplesText(finalExamples);

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
            // Note: Do not attempt to reduce reasoning via prompt text to avoid unintended behavior

            // Note: Validation filtering is now implemented via the useOnlyValidatedExamples setting
            // This controls whether only validated translation pairs are used in few-shot examples
            // The setting can be toggled in the copilot settings UI

            const messages = buildMessages(
                targetLanguage,
                systemMessage,
                userMessageInstructions.split("\n"),
                fewShotExamples,
                precedingTranslationPairs,
                currentCellSourceContent
            );

            // A/B testing disabled: call LLM once, return single variant
            const completion = await callLLM(messages, completionConfig, token);
            return {
                variants: returnHTML ? [`<span>${completion}</span>`] : [completion],
                isABTest: false,
            };
        } catch (error) {
            // Check if this is a cancellation error and re-throw as-is
            if (error instanceof vscode.CancellationError ||
                (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'))) {
                console.info(`[llmCompletion] Translation cancelled for cell ${currentCellId}`);
                throw error; // Re-throw cancellation errors without wrapping
            }

            console.error("Error in llmCompletion:", error);
            throw new Error(
                `An error occurred while generating the completion. ${JSON.stringify(error)}`
            );
        } finally {
            statusBarItem.hide();
        }
    } catch (error) {
        // Check if this is a cancellation error and re-throw as-is
        if (error instanceof vscode.CancellationError ||
            (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'))) {
            console.info(`[llmCompletion] Translation cancelled for cell ${currentCellId}`);
            throw error; // Re-throw cancellation errors without wrapping
        }

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
                        "codex-editor-extension.debugMode"
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
    const warningMessage = "No relevant translated cells found for context.";
    const detailedWarning =
        "Unable to find any relevant cells that have already been translated. This may affect the quality of the translation suggestion.";

    vscode.window.showWarningMessage(warningMessage, "More Info", "Dismiss").then((selection) => {
        if (selection === "More Info") {
            vscode.window
                .showInformationMessage(detailedWarning, "Refresh Index", "How to Fix")
                .then((selection) => {
                    if (selection === "Refresh Index") {
                        vscode.commands.executeCommand("codex-editor-extension.forceReindex");
                    } else if (selection === "How to Fix") {
                        vscode.window.showInformationMessage(
                            "Try translating more cells in nearby sections or chapters to provide better context for future suggestions."
                        );
                    }
                });
        }
    });
}
