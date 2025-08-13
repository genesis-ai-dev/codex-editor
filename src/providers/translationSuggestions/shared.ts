import * as vscode from "vscode";
import { ChatMessage, MinimalCellResult, TranslationPair } from "../../../types";
import { CodexNotebookReader } from "../../serializer";
import { CodexCellTypes } from "../../../types/enums";
import { tokenizeText } from "../../utils/nlpUtils";

export async function fetchFewShotExamples(
  sourceContent: string,
  currentCellId: string,
  numberOfFewShotExamples: number,
  useOnlyValidatedExamples: boolean
): Promise<TranslationPair[]> {
  const initialCandidateCount = Math.max(numberOfFewShotExamples * 6, 30);
  const similarSourceCells: TranslationPair[] = await vscode.commands.executeCommand(
    "codex-editor-extension.getTranslationPairsFromSourceCellQuery",
    sourceContent || "empty",
    initialCandidateCount,
    useOnlyValidatedExamples
  );

  const filteredSimilarSourceCells = (similarSourceCells || []).filter((pair) => {
    if (!pair || pair.cellId === currentCellId) return false;

    const pairSourceContent = pair.sourceCell?.content || "";
    if (!pairSourceContent) return false;

    const currentTokens = tokenizeText({ method: "whitespace_and_punctuation", text: sourceContent });
    const pairTokens = tokenizeText({ method: "whitespace_and_punctuation", text: pairSourceContent });
    return currentTokens.some((token) => pairTokens.includes(token));
  });

  return filteredSimilarSourceCells.slice(0, numberOfFewShotExamples);
}

export async function getPrecedingTranslationPairs(
  notebookReader: CodexNotebookReader,
  currentCellId: string,
  currentCellIndex: number,
  contextSize: string,
  allowHtml: boolean = false
): Promise<(string | null)[]> {
  const contextLimit = contextSize === "small" ? 5 : contextSize === "medium" ? 10 : 50;
  const allPrecedingCells = await notebookReader.cellsUpTo(currentCellIndex);
  const precedingCells = allPrecedingCells.slice(Math.max(0, allPrecedingCells.length - contextLimit));

  const textPrecedingCells = precedingCells.filter(
    (cell) => cell.metadata?.type === CodexCellTypes.TEXT && cell.metadata?.id !== currentCellId
  );

  const precedingTranslationPairs = await Promise.all(
    textPrecedingCells.slice(-5).map(async (cellFromPrecedingContext) => {
      const cellIndex = await notebookReader.getCellIndex({ id: cellFromPrecedingContext.metadata?.id });
      const cellIds = await notebookReader.getCellIds(cellIndex);

      const sourceContents = await Promise.all(
        cellIds.map(
          (id) =>
            vscode.commands.executeCommand(
              "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
              id
            ) as Promise<MinimalCellResult | null>
        )
      );

      if (sourceContents.some((content) => content === null)) {
        return null;
      }

      const combinedSourceContent = sourceContents
        .filter(Boolean)
        .map((cell) => cell!.content)
        .join(" ");

      const notTranslatedYetMessage =
        "[not translated yet; do not try to translate this cell but focus on the final cell below]";

      const cellContent = await notebookReader.getEffectiveCellContent(cellIndex);
      const maybeHtmlOrPlain = allowHtml ? (cellContent || "").trim() : stripHtmlTags(cellContent).trim();
      const safeContent = maybeHtmlOrPlain || notTranslatedYetMessage;

      const targetInner = allowHtml ? wrapCdata(safeContent) : xmlEscape(safeContent);
      const sourceInner = allowHtml ? wrapCdata(combinedSourceContent) : xmlEscape(combinedSourceContent);
      return `<contextItem><source>${sourceInner}</source><target>${targetInner}</target></contextItem>`;
    })
  );

  return precedingTranslationPairs;
}

export function buildFewShotExamplesText(pairs: TranslationPair[], allowHtml: boolean = false): string {
  const examplesInner = pairs
    .map((pair) => {
      const sourceRaw = pair.sourceCell?.content ?? "";
      const targetRaw = pair.targetCell?.content ?? "";
      const target = allowHtml ? targetRaw.trim() : stripHtmlTags(targetRaw).trim();
      const targetInner = allowHtml ? wrapCdata(target) : xmlEscape(target);
      const sourceInner = allowHtml ? wrapCdata(sourceRaw) : xmlEscape(sourceRaw);
      return `<example><source>${sourceInner}</source><target>${targetInner}</target></example>`;
    })
    .join("\n");
  return `<examples>\n${examplesInner}\n</examples>`;
}

export function buildMessages(
  targetLanguage: string | null,
  chatSystemMessage: string,
  userInstructions: string[],
  fewShotExamples: string,
  precedingContextPairs: (string | null)[],
  currentCellSourceContent: string,
  allowHtml: boolean = false
): ChatMessage[] {
  let systemMessage = chatSystemMessage || `You are a helpful assistant`;
  systemMessage += `\n\nInput sections for examples and context are provided in XML. Only use values within <source> and <target> tags. Ignore any arrows (->) that may appear in text. Return only the completed translation for the current task without XML wrappers.`;
  // Preserve line breaks and specify output format
  if (allowHtml) {
    systemMessage += `\n\nYou may include inline HTML tags when appropriate (e.g., <span>, <i>, <b>) consistent with examples. Preserve original line breaks from <currentTask><source> by returning text with the same number of lines separated by newline characters. Do not include XML in your answer.`;
  } else {
    systemMessage += `\n\nReturn plain text only (no XML/HTML). Preserve original line breaks from <currentTask><source> by returning text with the same number of lines separated by newline characters.`;
  }
  systemMessage += `\n\nAlways translate from the source language to the target language, ${targetLanguage || ""
    }, relying strictly on reference data and context provided by the user. The language may be an ultra-low resource language, so it is critical to follow the patterns and style of the provided reference data closely.`;
  systemMessage += `\n\n${userInstructions.join("\n")}`;

  const contextXml = `<context>\n${precedingContextPairs.filter(Boolean).join("\n")}\n</context>`;
  const currentTaskXml = allowHtml
    ? `<currentTask><source>${wrapCdata(currentCellSourceContent)}</source></currentTask>`
    : `<currentTask><source>${xmlEscape(currentCellSourceContent)}</source></currentTask>`;

  const userMessage = [
    "## Instructions",
    "Follow the translation patterns and style as shown.",
    "## Translation Memory (XML)",
    fewShotExamples,
    "## Current Context (XML)",
    contextXml,
    "## Current Task (XML)",
    currentTaskXml,
  ].join("\n\n");

  return [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ] as ChatMessage[];
}

export function stripHtmlTags(html: string): string {
  try {
    return (html || "").replace(/<[^>]*?>/g, "");
  } catch {
    return html || "";
  }
}

export function xmlEscape(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function wrapCdata(content: string): string {
  const safe = (content || "").replace(/]]>/g, "]]&gt;");
  return `<![CDATA[${safe}]]>`;
}

export async function writeDebugMessages(messages: ChatMessage[], response: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  const messagesFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "copilot-messages.log");
  const messagesContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

  await vscode.workspace.fs.writeFile(
    messagesFilePath,
    new TextEncoder().encode(messagesContent + "\n\nAPI Response:\n" + response)
  );
}


