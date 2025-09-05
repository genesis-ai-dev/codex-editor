import OpenAI from "openai";
import { ChatMessage } from "../../types";
import { ChatCompletionMessageParam } from "openai/resources";
import { getAuthApi } from "../extension";
import * as vscode from "vscode";

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

        // Get the LLM endpoint from auth API if available
        let llmEndpoint: string | undefined;
        let authBearerToken: string | undefined;
        try {
            const frontierApi = getAuthApi();
            if (frontierApi) {
                llmEndpoint = await frontierApi.getLlmEndpoint();
                // Get auth token from the auth provider
                authBearerToken = await frontierApi.authProvider.getToken();
            }
        } catch (error) {
            console.debug("Could not get LLM endpoint from auth API:", error);
        }

        if (llmEndpoint) {
            config.endpoint = llmEndpoint;
        }

        // Check for cancellation before creating OpenAI client
        if (cancellationToken?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.endpoint,
            defaultHeaders: authBearerToken
                ? {
                    Authorization: `Bearer ${authBearerToken}`,
                }
                : undefined,
        });

        let model = config.model;
        if (model === "custom") {
            model = config.customModel;
        }

        console.log("model", model);

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
                        model: model,
                        messages: messages as ChatCompletionMessageParam[],
                        // GPT-5: temperature must be 1; keep defaults for others
                        ...(model?.toLowerCase?.() === "gpt-5" ? { temperature: 1 } : { temperature: config.temperature }),
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
                    model: model,
                    messages: messages as ChatCompletionMessageParam[],
                    ...(model?.toLowerCase?.() === "gpt-5" ? { temperature: 1 } : { temperature: config.temperature }),
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

            if (error.response && error.response.status === 401) {
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
                return "";
            }
            throw error;
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            throw error; // Re-throw cancellation errors as-is
        }

        console.error("Error calling LLM:", error);
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
    customModel: string;
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
    abTestingEnabled: boolean; // legacy flag; kept for type compatibility
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
            endpoint: (config.get("llmEndpoint") as string) || "https://api.openai.com/v1",
            apiKey: (config.get("api_key") as string) || "",
            model: (config.get("model") as string) || "gpt-4o",
            customModel: (config.get("customModel") as string) || "",
            contextSize: (config.get("contextSize") as string) || "large",
            additionalResourceDirectory: (config.get("additionalResourcesDirectory") as string) || "",
            contextOmission: (config.get("experimentalContextOmission") as boolean) || false,
            sourceBookWhitelist: (config.get("sourceBookWhitelist") as string) || "",
            temperature: (config.get("temperature") as number) || 0.8,
            mainChatLanguage: (config.get("main_chat_language") as string) || "English",
            chatSystemMessage: (config.get("chatSystemMessage") as string) ||
                "This is a chat between a helpful Bible translation assistant and a Bible translator...",
            numberOfFewShotExamples: (config.get("numberOfFewShotExamples") as number) || 30,
            debugMode: config.get("debugMode") === true || config.get("debugMode") === "true",
            useOnlyValidatedExamples: useOnlyValidatedExamples as boolean,
            // A/B testing flag kept for compatibility; registry handles gating
            abTestingEnabled: (config.get("abTestingEnabled") as boolean) ?? true,
            allowHtmlPredictions: (config.get("allowHtmlPredictions") as boolean) || false,
            fewShotExampleFormat: (config.get("fewShotExampleFormat") as string) || "source-and-target",
        };
        return completionConfig;
    } catch (error) {
        console.error("Error getting completion configuration", error);
        throw new Error("Failed to get completion configuration");
    }
}
