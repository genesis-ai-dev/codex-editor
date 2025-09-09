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
  // Request a large pool of candidates to ensure we have enough complete pairs to rank
  // Use a higher multiplier since many candidates may be incomplete pairs
  const initialCandidateCount = Math.max(numberOfFewShotExamples * 10, 100);
  console.debug(`[fetchFewShotExamples] Starting search with query: "${sourceContent}" (length: ${sourceContent?.length || 0}), requesting ${initialCandidateCount} candidates, validated only: ${useOnlyValidatedExamples}`);
  
  let similarSourceCells: TranslationPair[] = [];
  try {
    similarSourceCells = await vscode.commands.executeCommand(
      "codex-editor-extension.getTranslationPairsFromSourceCellQuery",
      sourceContent || "empty",
      initialCandidateCount,
      useOnlyValidatedExamples
    ) || [];
    console.debug(`[fetchFewShotExamples] Raw search returned ${similarSourceCells.length} results`);
  } catch (error) {
    console.error(`[fetchFewShotExamples] Command execution failed:`, error);
    console.error(`[fetchFewShotExamples] Query was: "${sourceContent}", candidates: ${initialCandidateCount}, validated: ${useOnlyValidatedExamples}`);
  }

  // Instead of filtering, rank all valid complete pairs by relevance
  const currentTokens = tokenizeText({ method: "whitespace_and_punctuation", text: sourceContent });
  
  const rankedPairs = (similarSourceCells || [])
    .filter((pair) => {
      // Basic validity filters only
      if (!pair || pair.cellId === currentCellId) {
        if (pair?.cellId === currentCellId) {
          console.debug(`[fetchFewShotExamples] Filtering out current cell: ${currentCellId}`);
        }
        return false;
      }
      
      // Must have both source and target content for complete pairs
      const pairSourceContent = pair.sourceCell?.content || "";
      const pairTargetContent = pair.targetCell?.content || "";
      if (!pairSourceContent.trim() || !pairTargetContent.trim()) {
        console.debug(`[fetchFewShotExamples] Filtering out pair ${pair.cellId} - incomplete pair (missing source or target)`);
        return false;
      }
      
      return true;
    })
    .map((pair) => {
      // Calculate relevance score based on token overlap
      const pairSourceContent = pair.sourceCell?.content || "";
      const pairTokens = tokenizeText({ method: "whitespace_and_punctuation", text: pairSourceContent });
      
      // Calculate overlap ratio
      const overlapCount = currentTokens.filter(token => pairTokens.includes(token)).length;
      const overlapRatio = currentTokens.length > 0 ? overlapCount / currentTokens.length : 0;
      
      console.debug(`[fetchFewShotExamples] Pair ${pair.cellId} - overlap: ${overlapCount}/${currentTokens.length} = ${(overlapRatio * 100).toFixed(1)}%`);
      
      return {
        pair,
        overlapRatio,
        overlapCount
      };
    })
    .sort((a, b) => {
      // Sort by overlap ratio first, then by absolute overlap count
      if (a.overlapRatio !== b.overlapRatio) {
        return b.overlapRatio - a.overlapRatio;
      }
      return b.overlapCount - a.overlapCount;
    });
  
  console.debug(`[fetchFewShotExamples] Ranked ${rankedPairs.length} complete pairs by relevance`);
  
  // Take the top N most relevant complete pairs
  const filteredSimilarSourceCells = rankedPairs
    .slice(0, numberOfFewShotExamples)
    .map(ranked => ranked.pair);

  console.debug(`[fetchFewShotExamples] Returning ${filteredSimilarSourceCells.length} top-ranked examples (requested: ${numberOfFewShotExamples})`);
  
  if (filteredSimilarSourceCells.length === 0) {
    console.debug(`[fetchFewShotExamples] No complete translation pairs found. Source length: ${sourceContent?.length || 0}`);
    console.debug(`[fetchFewShotExamples] Database may contain only incomplete pairs (source-only or target-only).`);
  } else if (filteredSimilarSourceCells.length < numberOfFewShotExamples) {
    console.debug(`[fetchFewShotExamples] Found fewer examples than requested: ${filteredSimilarSourceCells.length}/${numberOfFewShotExamples}`);
  }
  
  return filteredSimilarSourceCells;
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

export function buildFewShotExamplesText(
  pairs: TranslationPair[], 
  allowHtml: boolean = false, 
  exampleFormat: string = "source-and-target"
): string {
  console.debug(`[buildFewShotExamplesText] Building ${pairs.length} examples in '${exampleFormat}' format`);
  
  const examplesInner = pairs
    .map((pair) => {
      const sourceRaw = pair.sourceCell?.content ?? "";
      const targetRaw = pair.targetCell?.content ?? "";
      const target = allowHtml ? targetRaw.trim() : stripHtmlTags(targetRaw).trim();
      const targetInner = allowHtml ? wrapCdata(target) : xmlEscape(target);
      const sourceInner = allowHtml ? wrapCdata(sourceRaw) : xmlEscape(sourceRaw);
      
      // Format examples based on the setting
      if (exampleFormat === "target-only") {
        return `<example><target>${targetInner}</target></example>`;
      } else {
        // Default: source-and-target format
        return `<example><source>${sourceInner}</source><target>${targetInner}</target></example>`;
      }
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
  allowHtml: boolean = false,
  exampleFormat: string = "source-and-target"
): ChatMessage[] {
  let systemMessage = chatSystemMessage || `You are a helpful assistant`;
  
  if (exampleFormat === "target-only") {
    systemMessage += `\n\nReference translations are provided in XML <target> tags. Use these as examples of the translation style and patterns you should follow. Return only the completed translation for the current task without XML wrappers.`;
  } else {
    systemMessage += `\n\nInput sections for examples and context are provided in XML. Only use values within <source> and <target> tags. Ignore any arrows (->) that may appear in text. Return only the completed translation for the current task without XML wrappers.`;
  }
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

