import OpenAI from "openai";
import { ChatMessage } from "../../types";
import { ChatCompletionMessageParam } from "openai/resources";
import { getAuthApi } from "../extension";
import * as vscode from "vscode";
import { MetadataManager } from "./metadataManager";

/**
 * Calls the Language Model (LLM) with the given messages and configuration.
 *
 * @param messages - An array of ChatMessage objects representing the conversation history.
 * @param config - The CompletionConfig object containing LLM configuration settings.
 * @param cancellationToken - Optional cancellation token to cancel the request
 * @returns A Promise that resolves to the LLM's response as a string.
 * @throws Error if the LLM response is unexpected or if there's an error during the API call.
 */
export async function callLLM(
    messages: ChatMessage[],
    config: CompletionConfig,
    cancellationToken?: vscode.CancellationToken
): Promise<string> {
    try {
        // Check for cancellation before starting
        if (cancellationToken?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        // Check if using Frontier endpoint (requires Frontier auth, not API key)
        const isFrontierEndpoint = config.endpoint.includes("frontierrnd.com");
        let llmEndpoint: string | undefined;
        let authBearerToken: string | undefined;

        // Use Frontier auth if: using Frontier endpoint OR no custom API key
        const hasCustomApiKey = config.apiKey && config.apiKey.trim().length > 0;
        const shouldUseFrontierAuth = isFrontierEndpoint || !hasCustomApiKey;

        if (shouldUseFrontierAuth) {
            try {
                const frontierApi = getAuthApi();
                if (frontierApi) {
                    llmEndpoint = await frontierApi.getLlmEndpoint();
                    authBearerToken = await frontierApi.authProvider.getToken();
                }
            } catch (error) {
                console.debug("Could not get LLM endpoint from auth API:", error);
            }

            if (llmEndpoint) {
                config.endpoint = llmEndpoint;
            }
        }

        // Check for cancellation before creating OpenAI client
        if (cancellationToken?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        // For Frontier endpoint, use auth token; for other endpoints, use API key
        const openai = new OpenAI({
            apiKey: isFrontierEndpoint ? "" : config.apiKey,
            baseURL: config.endpoint,
            defaultHeaders: authBearerToken
                ? {
                    Authorization: `Bearer ${authBearerToken}`,
                }
                : undefined,
        });

        const model = "default";
        if ((config as any)?.debugMode) {
            console.debug("[callLLM] model", model);
        }

        try {
            // Check for cancellation before making the API call
            if (cancellationToken?.isCancellationRequested) {
                throw new vscode.CancellationError();
            }

            // Create an AbortController for the fetch request if cancellation token is provided
            let abortController: AbortController | undefined;
            if (cancellationToken) {
                abortController = new AbortController();

                // Set up cancellation handler
                const cancellationListener = cancellationToken.onCancellationRequested(() => {
                    abortController?.abort();
                });

                // Clean up the listener after the request
                const cleanup = () => cancellationListener.dispose();

                // Wrap the completion call to ensure cleanup
                try {
                    const completion = await openai.chat.completions.create({
                        model,
                        messages: messages as ChatCompletionMessageParam[],
                        // Let the server decide temperature for the default model.
                        ...(model.toLowerCase() === "default" ? {} : (model.toLowerCase() === "gpt-5" ? { temperature: 1 } : { temperature: config.temperature })),
                    }, {
                        signal: abortController.signal
                    });

                    cleanup();

                    if (
                        completion.choices &&
                        completion.choices.length > 0 &&
                        completion.choices[0].message
                    ) {
                        return completion.choices[0].message.content?.trim() ?? "";
                    } else {
                        throw new Error(
                            "Unexpected response format from the LLM; callLLM() failed - case 1"
                        );
                    }
                } catch (error: any) {
                    cleanup();

                    // Check if the error is due to cancellation
                    if (error.name === 'AbortError' || cancellationToken.isCancellationRequested) {
                        throw new vscode.CancellationError();
                    }

                    throw error;
                }
            } else {
                // No cancellation token provided, use the original logic
                const completion = await openai.chat.completions.create({
                    model,
                    messages: messages as ChatCompletionMessageParam[],
                    ...(model.toLowerCase() === "default" ? {} : (model.toLowerCase() === "gpt-5" ? { temperature: 1 } : { temperature: config.temperature })),
                });

                if (
                    completion.choices &&
                    completion.choices.length > 0 &&
                    completion.choices[0].message
                ) {
                    return completion.choices[0].message.content?.trim() ?? "";
                } else {
                    throw new Error(
                        "Unexpected response format from the LLM; callLLM() failed - case 1"
                    );
                }
            }
        } catch (error: any) {
            if (error instanceof vscode.CancellationError) {
                throw error; // Re-throw cancellation errors as-is
            }

            const status = (error?.response?.status ?? error?.status) as number | undefined;
            const isAuthError = status === 401 || String(error?.message || "").includes("401");
            if (isAuthError) {
                // Throttle the auth error toast
                try {
                    const now = Date.now();
                    const key = "codex.lastAuthErrorTs";
                    const last = (globalThis as any)[key] as number | undefined;
                    if (!last || now - last > 5000) {
                        vscode.window.showErrorMessage(
                            "Authentication failed for LLM. Set an API key or sign in to your LLM provider."
                        );
                        (globalThis as any)[key] = now;
                    }
                } catch {
                    // no-op
                }
                // Treat as a cancellation to avoid noisy error logs up the stack
                throw new vscode.CancellationError();
            }
            throw error;
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            throw error; // Re-throw cancellation errors as-is
        }

        console.error("[callLLM] Error calling LLM:", error);
        throw new Error("Failed to get a response from the LLM; callLLM() failed - case 2");
    }
}

export async function performReflection(
    text_to_refine: string,
    text_context: string,
    num_improvers: number,
    number_of_loops: number,
    chatReflectionConcern: string,
    config: CompletionConfig,
    cancellationToken?: vscode.CancellationToken
): Promise<string> {
    async function generateImprovement(text: string): Promise<string> {
        let systemContent = "";
        systemContent +=
            "You are an AI that is responsible for grading an answer according to a Christian perspective.\n";
        if (chatReflectionConcern) {
            systemContent += "Specified Concern: " + chatReflectionConcern + "\n";
        }
        systemContent +=
            "Provide a grade from 0 to 100 where 0 is the lowest grade and 100 is the highest grade and a grade comment.\n";

        const response = await callLLM(
            [
                {
                    role: "system",
                    content: systemContent,
                },
                {
                    role: "user",
                    content: `Context: ${text_context}\nAnswer to grade: ${text}\nGrade:`,
                },
            ],
            config,
            cancellationToken
        );

        return response;
    }

    async function generateSummary(improvements: Promise<string>[]): Promise<string> {
        const results = await Promise.all(improvements);
        const summarizedContent = results.join("\n\n");
        const summary = await callLLM(
            [
                {
                    role: "system",
                    //The comment about the original person is not available is to keep the reflection from fabricating a "personal" naritive to support a discussion.
                    content:
                        "You are an AI tasked with summarizing suggested improvements according to a Christian perspective. List each suggested improvement as a concise bullet point. Maintain a clear and distinct list format without losing any specifics from each suggested improvement.  Drop any requests for personal testimony or stories, the original person is no longer available.",
                },
                {
                    role: "user",
                    content: `Comments containing improvements: ${summarizedContent}\nSummary:`,
                },
            ],
            config,
            cancellationToken
        );
        return summary.trim();
    }

    async function implementImprovements(
        text: string,
        improvements: Promise<string> | string
    ): Promise<string> {
        try {
            const improvedText = Promise.resolve(improvements).then((result) => {
                // Apply the improvement logic here. For simplicity, let's assume we append the improvements.
                return callLLM(
                    [
                        {
                            role: "system",
                            content: `You are an AI tasked with implementing the requested changes to a text from a Christian perspective.  Don't lengthen or change the text except as needed for implementing the listed improvements if any. Do not comply with adding first-person naratives even if requested. The improvements requested are: "${result}".`,
                        },
                        {
                            role: "user",
                            content: text,
                        },
                    ],
                    config,
                    cancellationToken
                );
            });
            return await improvedText;
        } catch (error) {
            console.error("Error implementing improvements:", error);
            throw new Error("Failed to implement improvements");
        }
    }

    async function distillText(textToDistill: string): Promise<string> {
        return await callLLM(
            [
                {
                    role: "system",
                    content: `You are an AI tasked with distilling text from a Christian perspective.`,
                },
                {
                    role: "user",
                    content: `Text to distill: ${textToDistill}\nDistilled text: `,
                },
            ],
            config,
            cancellationToken
        )
            .then((distilledText) => {
                // Some basic post-processing to remove any trailing whitespace
                return distilledText.trim();
            })
            .catch((error) => {
                console.error("Error implementing improvements:", error);
                throw new Error("Failed to implement improvements");
            });
    }

    let text: string = text_to_refine;

    for (let i = 0; i < number_of_loops; i++) {
        const improvements: Promise<string>[] = [];
        for (let j = 0; j < num_improvers; j++) {
            //improvements.push(Promise.resolve(await generateImprovement(text)));
            improvements.push(generateImprovement(text));
        }

        const summarized_improvements =
            num_improvers == 1
                ? Promise.resolve(improvements[0])
                : await generateSummary(improvements);

        console.log(
            "Reflection Iteration " + (i + 1) + ": summarized_improvements",
            summarized_improvements
        );

        text = await implementImprovements(text, summarized_improvements);

        console.log("Reflection Iteration " + (i + 1) + ": improved_text", text);
    }

    //now distill the text back down.
    text = await distillText(text);

    console.log("Reflection Distilled text", text);

    return text;
}

export interface CompletionConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    contextSize: string;
    additionalResourceDirectory: string;
    contextOmission: boolean;
    sourceBookWhitelist: string;
    temperature: number;
    mainChatLanguage: string;
    chatSystemMessage: string;
    numberOfFewShotExamples: number;
    debugMode: boolean;
    useOnlyValidatedExamples: boolean;
    allowHtmlPredictions?: boolean; // whether to preserve HTML in examples and predictions
    fewShotExampleFormat: string; // format for few-shot examples: 'source-and-target' or 'target-only'
}
export async function fetchCompletionConfig(): Promise<CompletionConfig> {
    try {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples") ?? false;
        // if (sharedStateExtension) {
        //     const stateStore = sharedStateExtension.exports;
        //     stateStore.updateStoreState({
        //         key: "currentUserAPI",
        //         value: config.get("api_key", undefined, true) || "",
        //     });
        // }
        const completionConfig: CompletionConfig = {
            endpoint: (config.get("llmEndpoint") as string) || "https://api.frontierrnd.com/api/v1",
            apiKey: (config.get("api_key") as string) || "",
            model: "default",
            contextSize: (config.get("contextSize") as string) || "large",
            additionalResourceDirectory: (config.get("additionalResourcesDirectory") as string) || "",
            contextOmission: (config.get("experimentalContextOmission") as boolean) || false,
            sourceBookWhitelist: (config.get("sourceBookWhitelist") as string) || "",
            temperature: (config.get("temperature") as number) || 0.8,
            mainChatLanguage: (config.get("main_chat_language") as string) || "English",
            chatSystemMessage: await MetadataManager.getChatSystemMessage(),
            numberOfFewShotExamples: (config.get("numberOfFewShotExamples") as number) || 30,
            debugMode: config.get("debugMode") === true || config.get("debugMode") === "true",
            useOnlyValidatedExamples: useOnlyValidatedExamples as boolean,
            allowHtmlPredictions: (config.get("allowHtmlPredictions") as boolean) || false,
            fewShotExampleFormat: (config.get("fewShotExampleFormat") as string) || "source-and-target",
        };
        return completionConfig;
    } catch (error) {
        console.error("Error getting completion configuration", error);
        throw new Error("Failed to get completion configuration");
    }
}
