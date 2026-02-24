import * as vscode from "vscode";
import { CompletionConfig } from "@/utils/llmUtils";
import { callLLM } from "../../utils/llmUtils";
import { ChatMessage, MinimalCellResult } from "../../../types";
import { CodexNotebookReader } from "../../serializer";
import { CodexCellTypes } from "../../../types/enums";
import { getAutoCompleteStatusBarItem } from "../../extension";
import { tokenizeText } from "../../utils/nlpUtils";
import { buildFewShotExamplesText, buildMessages, fetchFewShotExamples, getPrecedingTranslationPairs, parseFinalAnswer } from "./shared";
import { abTestingRegistry } from "../../utils/abTestingRegistry";

// Helper function to build A/B test context object
function buildABTestContext(
    extConfig: vscode.WorkspaceConfiguration,
    currentCellId: string,
    currentCellSourceContent: string,
    numberOfFewShotExamples: number,
    completionConfig: CompletionConfig,
    fewShotExampleFormat: string,
    targetLanguage: string | null,
    chatSystemMessage: string,
    precedingTranslationPairs: any[],
    sourceLanguage: string | null,
    token: vscode.CancellationToken
): any {
    return {
        vscodeWorkspaceConfig: extConfig,
        executeCommand: vscode.commands.executeCommand,
        currentCellId: currentCellId,
        currentCellSourceContent,
        numberOfFewShotExamples,
        useOnlyValidatedExamples: Boolean(completionConfig.useOnlyValidatedExamples),
        allowHtmlPredictions: Boolean(completionConfig.allowHtmlPredictions),
        fewShotExampleFormat: fewShotExampleFormat || "source-and-target",
        targetLanguage,
        chatSystemMessage,
        sourceLanguage,
        precedingTranslationPairs,
        completionConfig,
        token,
    };
}

// Helper function to post-process A/B test result text
function postProcessABTestResult(
    txt: string,
    allowHtml: boolean,
    returnHTML: boolean
): string {
    const parsed = parseFinalAnswer(txt || "");
    const lines = parsed.split(/\r?\n/);
    const processed = lines.map((line) => line.trimEnd()).join(allowHtml || returnHTML ? "<br/>" : "\n");
    return allowHtml ? processed : (returnHTML ? `<span>${processed}</span>` : processed);
}

// Helper function to handle A/B test result
function handleABTestResult(
    result: {
        variants: string[];
        testName?: string;
        isAttentionCheck?: boolean;
        correctIndex?: number;
        decoyCellId?: string;
    } | null,
    currentCellId: string,
    testIdPrefix: string,
    completionConfig: CompletionConfig,
    returnHTML: boolean
): LLMCompletionResult | null {
    if (result && Array.isArray(result.variants) && result.variants.length === 2) {
        const allowHtml = Boolean(completionConfig.allowHtmlPredictions);
        const variants = result.variants.map((txt) => postProcessABTestResult(txt, allowHtml, returnHTML));
        return {
            variants,
            isABTest: true,
            testId: `${currentCellId}-${testIdPrefix}-${Date.now()}`,
            testName: result.testName,
            isAttentionCheck: result.isAttentionCheck,
            correctIndex: result.correctIndex,
            decoyCellId: result.decoyCellId,
        };
    }
    return null;
}

export interface LLMCompletionResult {
    variants: string[];
    isABTest: boolean;
    testId?: string;
    testName?: string;
    isAttentionCheck?: boolean;
    correctIndex?: number;
    decoyCellId?: string;
}

export async function llmCompletion(
    currentNotebookReader: CodexNotebookReader, // FIXME: if we just read the file as CodexNotebookAsJSONData (or whatever it's called), we can speed this up a lot because the notebook deserializer is really slow
    currentCellId: string,
    completionConfig: CompletionConfig,
    token: vscode.CancellationToken,
    returnHTML: boolean = true,
    isBatchOperation: boolean = false
): Promise<LLMCompletionResult> {
    const { contextSize, numberOfFewShotExamples, debugMode, chatSystemMessage, fewShotExampleFormat } = completionConfig;

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

        // Sanitize HTML content to extract plain text (handles transcription spans, etc.)
        const sanitizeHtmlContent = (html: string): string => {
            if (!html) return '';
            return html
                .replace(/<sup[^>]*class=["']footnote-marker["'][^>]*>[\s\S]*?<\/sup>/gi, '')
                .replace(/<sup[^>]*data-footnote[^>]*>[\s\S]*?<\/sup>/gi, '')
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
                .replace(/<\/p>/gi, ' ')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&#\d+;/g, ' ')
                .replace(/&[a-zA-Z]+;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const sourceContent = validSourceCells
            .map((cell) => sanitizeHtmlContent(cell!.content || ""))
            .join(" ");

        // Get few-shot examples (existing behavior encapsulated)
        if (completionConfig.debugMode) {
            console.debug(`[llmCompletion] Fetching few-shot examples with query: "${sourceContent}", cellId: ${currentCellId}, count: ${numberOfFewShotExamples}, onlyValidated: ${completionConfig.useOnlyValidatedExamples}`);
        }
        const finalExamples = await fetchFewShotExamples(
            sourceContent,
            currentCellId,
            numberOfFewShotExamples,
            completionConfig.useOnlyValidatedExamples
        );
        if (completionConfig.debugMode) {
            console.debug(`[llmCompletion] Retrieved ${finalExamples.length} few-shot examples:`, finalExamples.map(ex => ({ cellId: ex.cellId, source: ex.sourceCell?.content?.substring(0, 50) + '...', target: ex.targetCell?.content?.substring(0, 50) + '...' })));
        }

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
            contextSize,
            Boolean(completionConfig.allowHtmlPredictions)
        );

        // Get the source and target languages
        const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
        const targetLanguage = projectConfig.get<any>("targetLanguage")?.tag || null;
        const sourceLanguage = projectConfig.get<any>("sourceLanguage")?.tag || null;

        try {
            const currentCellIdString = currentCellIds.join(", ");
            const currentCellSourceContent = sourceContent;

            // Generate few-shot examples
            const fewShotExamples = buildFewShotExamplesText(
                finalExamples, 
                Boolean(completionConfig.allowHtmlPredictions), 
                fewShotExampleFormat || "source-and-target"
            );
            console.log(`[llmCompletion] Built few-shot examples text (${fewShotExamples.length} chars, format: ${fewShotExampleFormat}):`, fewShotExamples.substring(0, 200) + '...');

            // Build messages — buildMessages is the single source of truth for
            // system message construction. Pass the raw chatSystemMessage and let
            // buildMessages append instructions exactly once.
            const messages = buildMessages(
                targetLanguage,
                chatSystemMessage,
                fewShotExamples,
                precedingTranslationPairs,
                currentCellSourceContent,
                Boolean(completionConfig.allowHtmlPredictions),
                fewShotExampleFormat || "source-and-target",
                sourceLanguage
            );

            // Unified AB testing via registry with random test selection (global gating)
            // A/B testing is disabled during batch operations (chapter autocomplete, batch transcription)
            // to avoid interrupting the user with variant selection UI
            const extConfig = vscode.workspace.getConfiguration("codex-editor-extension");
            const abEnabled = Boolean(extConfig.get("abTestingEnabled") ?? true) && !isBatchOperation;
            const abProbabilityRaw = extConfig.get<number>("abTestingProbability");
            const abProbability = Math.max(0, Math.min(1, typeof abProbabilityRaw === "number" ? abProbabilityRaw : 0.01));
            const randomValue = Math.random();
            const triggerAB = abEnabled && randomValue < abProbability;

            if (completionConfig.debugMode) {
                console.debug(`[llmCompletion] A/B testing: enabled=${abEnabled}, isBatchOperation=${isBatchOperation}, probability=${abProbability}, random=${randomValue.toFixed(3)}, trigger=${triggerAB}`);
            }

            if (!triggerAB && completionConfig.debugMode) {
                if (isBatchOperation) {
                    console.debug(`[llmCompletion] A/B testing disabled during batch operation`);
                } else if (!abEnabled) {
                    console.debug(`[llmCompletion] A/B testing disabled in settings`);
                } else {
                    console.debug(`[llmCompletion] A/B test not triggered (random ${randomValue.toFixed(3)} >= probability ${abProbability})`);
                }
            }

            if (triggerAB) {
                const testName = "Attention Check";

                if (completionConfig.debugMode) {
                    console.debug(`[llmCompletion] Running A/B test: ${testName}`);
                }

                try {
                    const ctx = buildABTestContext(
                        extConfig,
                        currentCellId,
                        currentCellSourceContent,
                        numberOfFewShotExamples,
                        completionConfig,
                        fewShotExampleFormat || "source-and-target",
                        targetLanguage,
                        chatSystemMessage,
                        precedingTranslationPairs,
                        sourceLanguage,
                        token
                    );

                    const result = await abTestingRegistry.run<typeof ctx, string>(testName, ctx);

                    if (completionConfig.debugMode) {
                        console.debug(`[llmCompletion] A/B test result: ${result ? `got ${result.variants?.length || 0} variants` : "null"}`);
                    }

                    const testResult = handleABTestResult(
                        result,
                        currentCellId,
                        "attention",
                        completionConfig,
                        returnHTML
                    );

                    if (testResult) {
                        return testResult;
                    }
                } catch (e) {
                    console.warn(`[llmCompletion] Attention Check failed; falling back`, e);
                }
            }

            // A/B testing not triggered (or failed): call LLM once, return two identical variants
            const completion = await callLLM(messages, completionConfig, token);
            const allowHtml = Boolean(completionConfig.allowHtmlPredictions);

            // Extract translation from <final_answer> tags, fallback to full response
            const parsed = parseFinalAnswer(completion || "");
            const lines = parsed.split(/\r?\n/);
            const processed = lines
                .map((line) => line.trimEnd())
                .join(allowHtml || returnHTML ? "<br/>" : "\n");

            const singleVariant = allowHtml
                ? processed
                : (returnHTML ? `<span>${processed}</span>` : processed);
            const variants = [singleVariant, singleVariant];

            if (debugMode) {
                logDebugMessages(messages, completion, variants);
            }

            return {
                variants,
                isABTest: false, // Identical variants – UI should hide A/B controls
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

async function logDebugMessages(messages: ChatMessage[], completion: string, variants: string[]) {
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
            new TextEncoder().encode(JSON.stringify({
                messages: messagesContent,
                apiResponse: completion,
                variants: variants
            }, null, 2))
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
