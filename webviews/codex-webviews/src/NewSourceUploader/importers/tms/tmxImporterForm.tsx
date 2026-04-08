import React, { useCallback, useMemo } from "react";
import { FileCode } from "lucide-react";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import { type ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { validateFile, parseFile } from "./index";

function detectFormatFromName(fileName: string): "TMX" | "XLIFF" | "Unknown" {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "tmx") {
        return "TMX";
    }
    if (ext === "xliff" || ext === "xlf") {
        return "XLIFF";
    }
    return "Unknown";
}

function refineFormatFromContent(
    text: string,
    fromExtension: "TMX" | "XLIFF" | "Unknown"
): "TMX" | "XLIFF" | "Unknown" {
    const hasTmxRoot = text.includes("<tmx") || text.includes("<TMX");
    const hasXliffRoot = text.includes("<xliff") || text.includes("<XLIFF");
    if (hasTmxRoot && !hasXliffRoot) {
        return "TMX";
    }
    if (hasXliffRoot && !hasTmxRoot) {
        return "XLIFF";
    }
    return fromExtension;
}

async function analyzeTmsFiles(files: File[]): Promise<FileAnalysisStat[]> {
    const file = files[0];
    if (!file) {
        return [];
    }

    const fromName = detectFormatFromName(file.name);
    const text = await file.text();
    const format = refineFormatFromContent(text, fromName);

    const tuMatches = text.match(/<tu(?:\s|>)/gi);
    const transUnitMatches = text.match(/<trans-unit(?:\s|>)/gi);
    const tuCount = tuMatches?.length ?? 0;
    const transUnitCount = transUnitMatches?.length ?? 0;

    const stats: FileAnalysisStat[] = [
        { label: "Detected format", value: format },
        { label: "<tu> elements (approx.)", value: tuCount },
        { label: "<trans-unit> elements (approx.)", value: transUnitCount },
    ];

    return stats;
}

export const TmxImporterForm: React.FC<ImporterComponentProps> = (importerProps) => {
    const isTranslationImport = importerProps.wizardContext?.intent === "target";
    const selectedSource = importerProps.wizardContext?.selectedSource;

    const description = useMemo(() => {
        if (isTranslationImport && selectedSource) {
            return `Import target translation from a TMX or XLIFF file for "${selectedSource.name}". Target language text will be extracted and aligned with the source notebook.`;
        }
        return "Import source text from a TMX or XLIFF translation memory file. Translation units are converted to editable codex cells.";
    }, [isTranslationImport, selectedSource?.name]);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair> => {
            const file = files[0];
            if (!file) {
                throw new Error("No file selected");
            }

            const validation = await validateFile(file);
            if (!validation.isValid) {
                throw new Error(validation.errors.join("; "));
            }

            const importResult = await parseFile(file, onProgress, isTranslationImport);
            if (!importResult.success || !importResult.notebookPair) {
                throw new Error(importResult.error ?? "Import failed");
            }
            return importResult.notebookPair;
        },
        [isTranslationImport]
    );

    return (
        <UnifiedImporterForm
            title="Import Translation Files"
            description={description}
            icon={FileCode}
            accept=".tmx,.xliff,.xlf"
            extensionBadges={[".tmx", ".xliff", ".xlf"]}
            analyzeFiles={analyzeTmsFiles}
            processFiles={processFiles}
            importerProps={importerProps}
            cellAligner={sequentialCellAligner}
            showPreview={true}
            showEnforceStructure
        />
    );
};
