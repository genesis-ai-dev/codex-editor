import * as vscode from "vscode";
import { verseRefRegex } from "../../utils/verseRefUtils";

const config = vscode.workspace.getConfiguration("translators-copilot");
const endpoint = config.get("llmEndpoint"); // NOTE: config.endpoint is reserved so we must have unique name
const apiKey = config.get("api_key");
const model = config.get("model");
const temperature = config.get("temperature");
const maxTokens = config.get("max_tokens");
const maxLength = 4000;
let shouldProvideCompletion = false;
export async function provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
): Promise<vscode.InlineCompletionItem[] | undefined> {
    vscode.window.showInformationMessage("provideInlineCompletionItems called");
    if (!shouldProvideCompletion) {
        return undefined;
    }
    const text =
        (model as string).startsWith("gpt") &&
            ((endpoint as string).startsWith("https://api") ||
                (endpoint as string).startsWith("https://localhost"))
            ? await getCompletionTextGPT(document, position)
            : await getCompletionText(document, position);
    const completionItem = new vscode.InlineCompletionItem(
        text ?? "",
        new vscode.Range(position, position)
    );
    completionItem.range = new vscode.Range(position, position);
    shouldProvideCompletion = false;
    return [completionItem];
}

// Preprocess the document
function preprocessDocument(docText: string) {
    // Split all lines
    const lines = docText.split("\r\n");
    // Apply preprocessing rules to each line except the last
    for (let i = 0; i < lines.length; i++) {
        if (i > 0 && lines[i - 2].trim() !== "" && isStartWithComment(lines[i])) {
            lines[i] = "\r\n" + lines[i];
        }
    }
    // Merge all lines
    return lines.join("\r\n");
    function isStartWithComment(line: string): boolean {
        const trimLine = line.trim();
        // Define a list of comment start symbols
        const commentStartSymbols = ["//", "#", "/*", "<!--", "{/*"];
        for (const symbol of commentStartSymbols) {
            if (trimLine.startsWith(symbol)) return true;
        }
        return false;
    }
}
async function getCompletionText(
    document: vscode.TextDocument,
    position: vscode.Position
) {
    // Retrieve the language ID of the current document to use in the prompt for language-specific completions.
    const language = document.languageId;
    // Extract the text from the beginning of the document up to the current cursor position.
    let textBeforeCursor = document.getText(
        new vscode.Range(new vscode.Position(0, 0), position)
    );
    // If the extracted text is longer than the maximum allowed length, truncate it to fit.
    textBeforeCursor =
        textBeforeCursor.length > maxLength
            ? textBeforeCursor.substr(textBeforeCursor.length - maxLength)
            : textBeforeCursor;

    // Apply preprocessing to the text before the cursor to ensure it's in the correct format for processing.
    textBeforeCursor = preprocessDocument(textBeforeCursor);

    // Initialize the prompt variable that will be used to hold the text sent for completion.
    let prompt = "";
    // Define a set of stop sequences that signal the end of a completion suggestion.
    const stop = ["\n", "\n\n", "\r\r", "\r\n\r", "\n\r\n", "```"];

    // Extract the most recent vref from the text content to the left of the cursor
    const vrefs = textBeforeCursor.match(verseRefRegex);
    const mostRecentVref = vrefs ? vrefs[vrefs.length - 1] : null;
    if (mostRecentVref) {
        // If a vref is found, extract the book part (e.g., "MAT" from "MAT 1:1") and add it to the stop symbols
        const bookPart = mostRecentVref.split(" ")[0];
        stop.push(bookPart);
    }

    // Retrieve the content of the current line up to the cursor position and trim any whitespace.
    const lineContent = document.lineAt(position.line).text;
    const leftOfCursor = lineContent.substr(0, position.character).trim();
    // If there is text to the left of the cursor on the same line, add a line break to the stop sequences.
    if (leftOfCursor !== "") {
        stop.push("\r\n");
    }

    // If there is text before the cursor, format it as a code block with the document's language for the completion engine.
    if (textBeforeCursor) {
        prompt = "```" + language + "\r\n" + textBeforeCursor;
    } else {
        // If there is no text before the cursor, exit the function without providing a completion.
        return;
    }

    const data: {
        prompt: string;
        max_tokens: number;
        temperature: unknown;
        stream: boolean;
        stop: string[];
        n: number;
        model: string | undefined;
    } = {
        prompt: prompt,
        max_tokens: 10,
        temperature: temperature,
        stream: false,
        stop: stop,
        n: 1,
        model: undefined,
    };
    if (model && typeof model === 'string') {
        data.model = model;
    }
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey || ""}`, // Ensures the Authorization header works with an empty apiKey
    };
    const config = {
        method: "POST",
        url: endpoint + "/completions",
        headers,
        data: JSON.stringify(data),
    };

    const requestBody = JSON.stringify(data);

    try {
        const response = await fetch(endpoint + "/completions", {
            method: "POST",
            headers: headers,
            body: requestBody,
        });
        const responseData = await response.json();
        if (
            responseData &&
            responseData.choices &&
            responseData.choices.length > 0
        ) {
            return postProcessResponse(responseData.choices[0].text); //.replace(/[\r\n]+$/g, "");
        }
    } catch (error) {
        console.log("Error:", error);
        vscode.window.showErrorMessage("LLM service access failed.");
    }
}

function postProcessResponse(text: string) {
    // Filter out vrefs from text using verseRefRegex
    const vrefs = text.match(verseRefRegex);
    if (vrefs) {
        for (const vref of vrefs) {
            text = text.replace(vref, "");
        }
    }
    return text;
}

async function getCompletionTextGPT(
    document: vscode.TextDocument,
    position: vscode.Position
) {
    vscode.window.showInformationMessage("getCompletionTextGPT called");
    let textBeforeCursor = document.getText(
        new vscode.Range(new vscode.Position(0, 0), position)
    );
    textBeforeCursor =
        textBeforeCursor.length > maxLength
            ? textBeforeCursor.substr(textBeforeCursor.length - maxLength)
            : textBeforeCursor;
    textBeforeCursor = preprocessDocument(textBeforeCursor);
    const url = endpoint + "/chat/completions";
    console.log({ url });
    const messages = [
        {
            role: "system",
            content:
                "No communication! Just continue writing the text provided by the user in the language they are using.",
        },
        { role: "user", content: textBeforeCursor },
    ];
    const data = {
        max_tokens: maxTokens,
        temperature,
        model,
        stream: false,
        messages,
        stop: ["\n\n", "\r\r", "\r\n\r", "\n\r\n"],
    };
    const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
    };
    let text = "";
    const requestBody = JSON.stringify(data);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: requestBody,
        });
        const responseData = await response.json();
        if (
            responseData &&
            responseData.choices &&
            responseData.choices.length > 0
        ) {
            text = responseData.choices[0].message.content;

            if (text.startsWith("```")) {
                const textLines = text.split("\n");
                const startIndex = textLines.findIndex((line) =>
                    line.startsWith("```")
                );
                const endIndex = textLines
                    .slice(startIndex + 1)
                    .findIndex((line) => line.startsWith("```"));
                text =
                    endIndex >= 0
                        ? textLines
                            .slice(startIndex + 1, startIndex + endIndex + 1)
                            .join("\n")
                        : textLines.slice(startIndex + 1).join("\n");
            }
        }
    } catch (error) {
        console.log("Error:", error);
        vscode.window.showErrorMessage("LLM service access failed.");
    }
    return text;
}

export function triggerInlineCompletion() {
    shouldProvideCompletion = true;
    vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
}