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
  contextSize: string
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
      const cellContentWithoutHTMLTags = stripHtmlTags(cellContent).trim() || notTranslatedYetMessage;

      return `${combinedSourceContent} -> ${cellContentWithoutHTMLTags}`;
    })
  );

  return precedingTranslationPairs;
}

export function buildFewShotExamplesText(pairs: TranslationPair[]): string {
  return pairs
    .map(
      (pair) => `${pair.sourceCell?.content ?? ""} -> ${stripHtmlTags(pair.targetCell?.content ?? "").trim()}`
    )
    .join("\n");
}

export function buildMessages(
  targetLanguage: string | null,
  chatSystemMessage: string,
  userInstructions: string[],
  fewShotExamples: string,
  precedingContextPairs: (string | null)[],
  currentCellSourceContent: string
): ChatMessage[] {
  let systemMessage = chatSystemMessage || `You are a helpful assistant`;
  systemMessage += `\n\nAlways translate from the source language to the target language, ${
    targetLanguage || ""
  }, relying strictly on reference data and context provided by the user. The language may be an ultra-low resource language, so it is critical to follow the patterns and style of the provided reference data closely.`;
  systemMessage += `\n\n${userInstructions.join("\n")}`;

  const userMessage = [
    "## Instructions",
    "Follow the translation patterns and style as shown.",
    "## Translation Memory",
    fewShotExamples,
    "## Current Context",
    precedingContextPairs.filter(Boolean).join("\n"),
    `${currentCellSourceContent} ->`,
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


