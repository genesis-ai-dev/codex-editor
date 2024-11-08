import OpenAI from "openai";
import { CompletionConfig } from "../providers/translationSuggestions/inlineCompletionsProvider";
import { ChatMessage } from "../../types";
import * as vscode from "vscode";

/**
 * Calls the Language Model (LLM) with the given messages and configuration.
 *
 * @param messages - An array of ChatMessage objects representing the conversation history.
 * @param config - The CompletionConfig object containing LLM configuration settings.
 * @returns A Promise that resolves to the LLM's response as a string.
 * @throws Error if the LLM response is unexpected or if there's an error during the API call.
 */
export async function callLLM(messages: ChatMessage[], config: CompletionConfig): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.endpoint,
        });

        let model = config.model;
        if (model === "custom") {
            model = config.customModel;
        }

        console.log("model", model);

        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                max_tokens: config.maxTokens,
                temperature: config.temperature,
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
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                vscode.window.showErrorMessage(
                    "Authentication failed. Please add a valid API key for the copilot if you are using a remote LLM."
                );
                return "";
            }
            throw error;
        }
    } catch (error) {
        console.error("Error calling LLM:", error);
        throw new Error("Failed to get a response from the LLM; callLLM() failed - case 2");
    }
}



export async function performReflection( text_to_refine: string, text_context: string, num_improvers: number, number_of_loops: number, chatReflectionConcern: string, config: CompletionConfig ): Promise<string> {

  async function generateImprovement(text: string): Promise<string> {
    let systemContent = "";
    systemContent += "You are an AI that is responsible for grading an answer according to a Christian perspective.\n";
    if( chatReflectionConcern ) {
      systemContent += "Specified Concern: " + chatReflectionConcern + "\n";
    }
    systemContent += "Provide a grade from 0 to 100 where 0 is the lowest grade and 100 is the highest grade and a grade comment.\n";
    
    const response = await callLLM([
      {
        role: "system",
        content: systemContent
      },
      {
        role: "user",
        content: `Context: ${text_context}\nAnswer to grade: ${text}\nGrade:`,
      },
    ], config);

    return response;
  }

  async function generateSummary(improvements: Promise<string>[]): Promise<string> {
    const results = await Promise.all(improvements);
    const summarizedContent = results.join("\n\n");
    const summary = await callLLM(
      [
        {
          role: "system",
          content:  //The comment about the original person is not available is to keep the reflection from fabricating a "personal" naritive to support a discussion.
            "You are an AI tasked with summarizing suggested improvements according to a Christian perspective. List each suggested improvement as a concise bullet point. Maintain a clear and distinct list format without losing any specifics from each suggested improvement.  Drop any requests for personal testimony or stories, the original person is no longer available."
        },
        {
          role: "user",
          content: `Comments containing improvements: ${summarizedContent}\nSummary:`,
        },
      ],
      config
    );
    return summary.trim();
  }

  async function implementImprovements(text: string, improvements: Promise<string> | string): Promise<string> {
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
          config
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
      config
    ).then((distilledText) => {
      // Some basic post-processing to remove any trailing whitespace
      return distilledText.trim();
    }).catch((error) => {
      console.error("Error implementing improvements:", error);
      throw new Error("Failed to implement improvements");
    });
  }

  let text : string = text_to_refine;

  for (let i = 0; i < number_of_loops; i++) {
    const improvements: Promise<string>[] = [];
    for (let j = 0; j < num_improvers; j++) {
      //improvements.push(Promise.resolve(await generateImprovement(text)));
      improvements.push(generateImprovement(text));
    }

    const summarized_improvements = num_improvers == 1 ? 
        Promise.resolve(improvements[0]) : 
        await generateSummary(improvements);

    console.log("Reflection Iteration " + (i+1) + ": summarized_improvements", summarized_improvements);

    text = await implementImprovements(text, summarized_improvements);

    console.log("Reflection Iteration " + (i+1) + ": improved_text", text);
  }

  //now distill the text back down.
  text = await distillText(text);

  console.log( "Reflection Distilled text", text);

  return text;
}