import * as vscode from "vscode";
import {
    compareHtmlStructure,
    extractPlainTextFromHtml,
    tryDeterministicStructureFix,
} from "../../../../sharedUtils/htmlStructureUtils";
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
            "The translation's tag structure must exactly match the source's. Structural elements can be:\n" +
            "1. USFM markers in angle brackets: <\\f + \\fr 1:7. \\ft>, <\\xt>, <11:44\\xt*>, <\\f*>\n" +
            "2. Line breaks: <br/>, <br>\n" +
            "3. Formatting tags: <strong>, </strong>, <em>, </em>, <b>, </b>, <i>, </i>, " +
            "<sup>, </sup>, <sub>, </sub>\n" +
            "4. Semantic spans: <span data-tag=\"...\">, <span style=\"...\">, and </span>\n" +
            "5. Headings: <h1>–<h4> and their closing tags\n" +
            "6. Paragraph tags: <p>, </p>\n" +
            "Apply these rules:\n" +
            "- If the translation is MISSING elements that exist in the source, copy them EXACTLY " +
            "from the source and place them at the corresponding position in the translation.\n" +
            "- If the translation has EXTRA elements that do not exist in the source, remove those " +
            "tags but KEEP the text inside them.\n" +
            "- Keep ALL translated text unchanged. Never re-translate, add, or remove any words. " +
            "Never replace translated text with source-language text.\n" +
            "Return ONLY the corrected translation, no explanation.",
    },
    {
        role: "user" as const,
        content:
            `Source (with the required structure):\n${sourceHtml}\n\n` +
            `Translation (structure does not match):\n${targetHtml}\n\n` +
            "Return the translation with its structure corrected to match the source:",
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

/**
 * Validate a resolved translation before it is saved:
 * - its structure must now match the source, and
 * - its text must not have reverted to the source-language text.
 *
 * Returns the content when valid, otherwise null.
 */
export const verifyResolvedContent = (
    sourceHtml: string,
    originalTargetHtml: string,
    resolvedHtml: string,
): string | null => {
    if (!resolvedHtml) return null;
    if (!compareHtmlStructure(sourceHtml, resolvedHtml).isMatch) return null;

    const sourceText = extractPlainTextFromHtml(sourceHtml);
    const originalText = extractPlainTextFromHtml(originalTargetHtml);
    const resolvedText = extractPlainTextFromHtml(resolvedHtml);
    const revertedToSource = resolvedText === sourceText && originalText !== sourceText;
    return revertedToSource ? null : resolvedHtml;
};

export type StructureResolveOutcome =
    | { status: "resolved"; content: string; method: "deterministic" | "llm" }
    | { status: "already-matched" }
    | { status: "missing-content" }
    | { status: "unresolved" };

/**
 * Resolve a cell's structure mismatch. Tries a deterministic fix first (no
 * LLM); falls back to the LLM and verifies the result before returning it.
 */
export const resolveCellHtmlStructure = async (
    cellId: string,
    document: CodexCellDocument,
    config?: CompletionConfig,
): Promise<StructureResolveOutcome> => {
    const sourceHtml = await getSourceCellContent(cellId);
    if (!sourceHtml) {
        return { status: "missing-content" };
    }

    const targetCell = document.getCellContent(cellId);
    if (!targetCell?.cellContent) {
        return { status: "missing-content" };
    }
    const targetHtml = targetCell.cellContent;

    if (compareHtmlStructure(sourceHtml, targetHtml).isMatch) {
        return { status: "already-matched" };
    }

    const deterministicFix = tryDeterministicStructureFix(sourceHtml, targetHtml);
    if (deterministicFix !== null) {
        return { status: "resolved", content: deterministicFix, method: "deterministic" };
    }

    try {
        const { fetchCompletionConfig } = await import("../../../utils/llmUtils");
        const completionConfig = config ?? (await fetchCompletionConfig());
        const llmResult = await resolveHtmlStructureWithLLM(
            sourceHtml,
            targetHtml,
            completionConfig,
        );
        const verified = verifyResolvedContent(sourceHtml, targetHtml, llmResult);
        if (verified !== null) {
            return { status: "resolved", content: verified, method: "llm" };
        }
    } catch (error) {
        console.error("[resolveCellHtmlStructure] LLM resolve failed:", error);
    }

    return { status: "unresolved" };
};

export const getSourceCellContent = async (cellId: string): Promise<string | null> => {
    const sourceCell = (await vscode.commands.executeCommand(
        "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
        cellId,
    )) as { cellId: string; content: string } | null;

    return sourceCell?.content ?? null;
};

/**
 * Deterministic-only structure repair for user saves from the cell editor.
 *
 * Quill drops any markup it has no registered format for (e.g. docx
 * `<p style="line-height: …">` and `<span style="font-family: …">` wrappers),
 * so saving a cell that was open in the editor would otherwise strip the
 * source's wrappers and create a mismatch. This re-applies the deterministic
 * fixes (never an LLM call, never a text change) and returns the original
 * content untouched when no safe fix applies.
 */
export const maybeRepairStructureDeterministically = async (
    cellId: string,
    html: string,
    document: CodexCellDocument,
): Promise<string> => {
    if (!html?.trim()) return html;
    const metadata = document.getNotebookMetadata();
    if (!metadata.enforceHtmlStructure) return html;

    const sourceHtml = await getSourceCellContent(cellId);
    if (!sourceHtml) return html;
    if (compareHtmlStructure(sourceHtml, html).isMatch) return html;

    return tryDeterministicStructureFix(sourceHtml, html) ?? html;
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

/**
 * Normalize/repair a freshly generated translation before it is written to the
 * cell, so that (when enforcement is on) mismatches never land in the document
 * in the first place. Deterministic fixes are attempted before the LLM, and
 * any LLM output is verified; on failure the original translation is returned
 * unchanged (the cell will simply show the mismatch warning).
 */
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

    if (compareHtmlStructure(sourceHtml, translatedHtml).isMatch) {
        return translatedHtml;
    }

    const deterministicFix = tryDeterministicStructureFix(sourceHtml, translatedHtml);
    if (deterministicFix !== null) {
        return deterministicFix;
    }

    try {
        const { fetchCompletionConfig } = await import("../../../utils/llmUtils");
        const completionConfig = options?.config ?? (await fetchCompletionConfig());
        options?.onResolving?.();
        const resolveWithLLM = options?.resolveWithLLM ?? resolveHtmlStructureWithLLM;
        const llmResult = await resolveWithLLM(sourceHtml, translatedHtml, completionConfig);
        return verifyResolvedContent(sourceHtml, translatedHtml, llmResult) ?? translatedHtml;
    } catch (error) {
        console.error("[maybeAutoResolveHtmlStructure] Error:", error);
        return translatedHtml;
    }
};
