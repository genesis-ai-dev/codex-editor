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

  // Sanitize HTML content for consistent comparison (handles transcription spans, etc.)
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
      // Sanitize pair source content to match the sanitized query content
      const pairSourceContentRaw = pair.sourceCell?.content || "";
      const pairSourceContentSanitized = sanitizeHtmlContent(pairSourceContentRaw);
      const pairTokens = tokenizeText({ method: "whitespace_and_punctuation", text: pairSourceContentSanitized });
      
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

      const sanitizedSourceContent = allowHtml ? combinedSourceContent.trim() : stripHtmlTags(combinedSourceContent).trim();
      const targetInner = allowHtml ? wrapCdata(safeContent) : xmlEscape(safeContent);
      const sourceInner = allowHtml ? wrapCdata(sanitizedSourceContent) : xmlEscape(sanitizedSourceContent);
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
  console.debug(`[buildFewShotExamplesText] Building ${pairs.length} examples in '${exampleFormat}' format, allowHtml=${allowHtml}`);

  const examplesInner = pairs
    .map((pair, idx) => {
      const sourceRaw = allowHtml ? (pair.sourceCell?.rawContent || pair.sourceCell?.content || "") : (pair.sourceCell?.content ?? "");
      const targetRaw = allowHtml ? (pair.targetCell?.rawContent || pair.targetCell?.content || "") : (pair.targetCell?.content ?? "");
      const target = allowHtml ? targetRaw.trim() : stripHtmlTags(targetRaw).trim();
      const source = allowHtml ? sourceRaw.trim() : stripHtmlTags(sourceRaw).trim();
      if (allowHtml && idx < 3) {
        const hasHtmlInTarget = /<[a-z][^>]*>/i.test(target);
        const hasHtmlInSource = /<[a-z][^>]*>/i.test(source);
        console.log(`[buildFewShotExamplesText] Example ${idx}: hasHtmlInSource=${hasHtmlInSource}, hasHtmlInTarget=${hasHtmlInTarget}, targetRawContent=${pair.targetCell?.rawContent ? 'present' : 'MISSING'}, target preview="${target.substring(0, 100)}"`);
      }
      const targetInner = allowHtml ? wrapCdata(target) : xmlEscape(target);
      const sourceInner = allowHtml ? wrapCdata(source) : xmlEscape(source);
      
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

export function parseFinalAnswer(response: string): string {
  const match = response.match(/<final_answer>([\s\S]*?)<\/final_answer>/);
  return match ? match[1].trim() : response.trim();
}

export function buildMessages(
  targetLanguage: string | null,
  chatSystemMessage: string,
  fewShotExamples: string,
  precedingContextPairs: (string | null)[],
  currentCellSourceContent: string,
  allowHtml: boolean = false,
  exampleFormat: string = "source-and-target",
  sourceLanguage: string | null = null
): ChatMessage[] {
  const sourceLangText = sourceLanguage ? `${sourceLanguage}` : "the source language";
  const targetLangText = targetLanguage || "the target language";

  // Build a focused system message: critical output format first, then translation guidance
  const parts: string[] = [];

  // User's custom instructions (from metadata.json) come first
  if (chatSystemMessage) {
    parts.push(chatSystemMessage);
  }

  // Translation direction and approach
  parts.push(`Translate from ${sourceLangText} to ${targetLangText}. This may be an ultra-low resource language — follow the patterns, style, and vocabulary of the provided reference data closely. When in doubt, err on the side of literalness.`);

  // HTML preservation — always instruct to preserve HTML based on source
  parts.push(`If the source text contains HTML formatting (e.g., <span>, <i>, <b> tags), preserve that HTML structure in your translation. Match the formatting of the source.`);

  // Line preservation
  parts.push(`Preserve original line breaks from <currentTask><source> by returning text with the same number of lines.`);

  // Output format
  parts.push(`Wrap your final translation in <final_answer>...</final_answer> tags. Provide only the translation — no commentary, explanations, or metadata.`);

  // Data format hint
  if (exampleFormat === "target-only") {
    parts.push(`Reference translations are provided in XML <target> tags. Use these as examples of the translation style and patterns to follow.`);
  } else {
    parts.push(`Examples and context are provided in XML with <source> and <target> tags.`);
  }

  const systemMessage = parts.join("\n\n");

  const contextXml = `<context>\n${precedingContextPairs.filter(Boolean).join("\n")}\n</context>`;
  const currentTaskXml = allowHtml
    ? `<currentTask><source>${wrapCdata(currentCellSourceContent)}</source></currentTask>`
    : `<currentTask><source>${xmlEscape(currentCellSourceContent)}</source></currentTask>`;

  const userMessage = [
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

