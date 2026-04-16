import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import {
    UnifiedImporterForm,
    type FileAnalysisStat,
} from "../../components/UnifiedImporterForm";
import { type ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { markdownImporter } from "./index";

const { validateFile, parseFile } = markdownImporter;

function analyzeMarkdownText(text: string): {
    headings: number;
    paragraphs: number;
    estimatedCells: number;
} {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");

    const headings = lines.filter((line) => {
        const t = line.trimStart();
        return t.startsWith("#");
    }).length;

    const blocks = normalized
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean);

    let paragraphCount = 0;
    let codeFenceBlocks = 0;
    for (const block of blocks) {
        const firstNonEmpty =
            block.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
        if (!firstNonEmpty) continue;
        if (firstNonEmpty.startsWith("```")) {
            codeFenceBlocks += 1;
            continue;
        }
        if (/^#{1,6}\s/.test(firstNonEmpty)) continue;
        if (/^[-*+]\s/.test(firstNonEmpty) || /^\d+\.\s/.test(firstNonEmpty)) {
            continue;
        }
        paragraphCount += 1;
    }

    const listItemLines = lines.filter((line) => {
        const t = line.trim();
        return /^(\s*)([-*+]|\d+\.)\s/.test(t);
    }).length;

    const estimatedCells = headings + paragraphCount + listItemLines + codeFenceBlocks;

    return {
        headings,
        paragraphs: paragraphCount,
        estimatedCells,
    };
}

export const MarkdownImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const analyzeFiles = useCallback(async (files: File[]): Promise<FileAnalysisStat[]> => {
        let totalHeadings = 0;
        let totalParagraphs = 0;
        let totalEstCells = 0;

        for (const file of files) {
            const text = await file.text();
            const stats = analyzeMarkdownText(text);
            totalHeadings += stats.headings;
            totalParagraphs += stats.paragraphs;
            totalEstCells += stats.estimatedCells;
        }

        const stats: FileAnalysisStat[] = [
            { label: "Headings", value: totalHeadings },
            { label: "Paragraphs", value: totalParagraphs },
            { label: "Est. cells", value: totalEstCells },
        ];

        if (files.length > 1) {
            stats.unshift({ label: "Files", value: files.length });
        }

        return stats;
    }, []);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair | NotebookPair[]> => {
            const results: NotebookPair[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                onProgress({
                    stage: "Validation",
                    message: `Validating ${file.name} (${i + 1}/${files.length})...`,
                    progress: 10 + (i * 70) / files.length,
                });

                const validation = await validateFile(file);
                if (!validation.isValid) {
                    throw new Error(`${file.name}: ${validation.errors.join(", ")}`);
                }

                const importResult = await parseFile(file, onProgress);
                if (!importResult.success || !importResult.notebookPair) {
                    throw new Error(importResult.error || `Failed to parse ${file.name}`);
                }

                results.push(importResult.notebookPair);
            }

            return results.length === 1 ? results[0] : results;
        },
        []
    );

    return (
        <UnifiedImporterForm
            title="Import Markdown Document"
            description="Import Markdown documents with formatting, images, links, and structure preserved. Supports GitHub Flavored Markdown (GFM)."
            icon={FileText}
            accept=".md,.markdown,.mdown,.mkd,.mdx"
            extensionBadges={[".md", ".markdown", ".mdx"]}
            multipleFiles={true}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={sequentialCellAligner}
            showPreview={true}
            showEnforceStructure
        />
    );
};
