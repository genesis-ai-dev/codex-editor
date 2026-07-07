import * as vscode from "vscode";
import { compareHtmlStructure } from "../../../../sharedUtils/htmlStructureUtils";
import type { CompletionConfig } from "../../../utils/llmUtils";
import type { CodexCellDocument } from "../codexDocument";

export const stripMarkdownCodeFences = (content: string): string => {
    let resolved = content.trim();
    const fenceMatch = resolved.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) {
        resolved = fenceMatch[1].trim();
    }
    return resolved;
};

const buildResolvePrompt = (sourceHtml: string, targetHtml: string) => [
    {
        role: "system" as const,
        content:
            "You fix structural mismatches between a source text and its translation. " +
            "The translation is missing some non-translatable elements that exist in the source. These can be:\n" +
            "1. USFM markers in angle brackets: <\\f + \\fr 1:7. \\ft>, <\\xt>, <11:44\\xt*>, <\\f*>\n" +
            "2. Line breaks: <br/>, <br>\n" +
            "3. Formatting tags: <strong>, </strong>, <em>, </em>, <b>, </b>, <i>, </i>, " +
            "<sup>, </sup>, <sub>, </sub>\n" +
            "4. Semantic spans: <span data-tag=\"...\"> and </span> (for bold, italic, small-caps, etc.)\n" +
            "5. Headings: <h1>–<h4> and their closing tags\n" +
            "6. Paragraph tags: <p>, </p>\n" +
            "Copy ALL missing elements EXACTLY from the source and place them at the corresponding position in the translation. " +
            "Keep ALL translated text unchanged. Do NOT revert any translated words back to the source language. " +
            "Return ONLY the corrected translation, no explanation.",
    },
    {
        role: "user" as const,
        content:
            `Source (with structural elements):\n${sourceHtml}\n\n` +
            `Translation (missing elements):\n${targetHtml}\n\n` +
            "Return the translation with ALL missing structural elements inserted:",
    },
];

export const resolveHtmlStructureWithLLM = async (
    sourceHtml: string,
    targetHtml: string,
    config: CompletionConfig,
    callLLMOverride?: (
        prompt: Array<{ role: "system" | "user"; content: string }>,
        config: CompletionConfig,
    ) => Promise<{ content: string }>,
): Promise<string> => {
    const callLLM = callLLMOverride ?? (await import("../../../utils/llmUtils")).callLLM;
    const prompt = buildResolvePrompt(sourceHtml, targetHtml);
    const llmResult = await callLLM(prompt, config);
    return stripMarkdownCodeFences(llmResult.content);
};

export const getSourceCellContent = async (cellId: string): Promise<string | null> => {
    const sourceCell = (await vscode.commands.executeCommand(
        "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
        cellId,
    )) as { cellId: string; content: string } | null;

    return sourceCell?.content ?? null;
};

export type AutoResolveHtmlStructureOptions = {
    config?: CompletionConfig;
    onResolving?: () => void;
    resolveWithLLM?: (
        sourceHtml: string,
        targetHtml: string,
        config: CompletionConfig,
    ) => Promise<string>;
};

export const maybeAutoResolveHtmlStructure = async (
    cellId: string,
    translatedHtml: string,
    document: CodexCellDocument,
    options?: AutoResolveHtmlStructureOptions,
): Promise<string> => {
    const metadata = document.getNotebookMetadata();
    if (!metadata.enforceHtmlStructure) {
        return translatedHtml;
    }

    const sourceHtml = await getSourceCellContent(cellId);
    if (!sourceHtml) {
        return translatedHtml;
    }

    const diff = compareHtmlStructure(sourceHtml, translatedHtml);
    if (diff.isMatch) {
        return translatedHtml;
    }

    try {
        const { fetchCompletionConfig } = await import("../../../utils/llmUtils");
        const completionConfig = options?.config ?? (await fetchCompletionConfig());
        options?.onResolving?.();
        const resolveWithLLM = options?.resolveWithLLM ?? resolveHtmlStructureWithLLM;
        return await resolveWithLLM(sourceHtml, translatedHtml, completionConfig);
    } catch (error) {
        console.error("[maybeAutoResolveHtmlStructure] Error:", error);
        return translatedHtml;
    }
};
