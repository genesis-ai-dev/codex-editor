import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import {
    UnifiedImporterForm,
    type FileAnalysisStat,
} from "../../components/UnifiedImporterForm";
import {
    ImporterComponentProps,
    sequentialCellAligner,
} from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { plaintextImporter } from "./index";

const { validateFile, parseFile } = plaintextImporter;

async function analyzePlaintextFiles(files: File[]): Promise<FileAnalysisStat[]> {
    const file = files[0];
    if (!file) {
        return [];
    }
    const text = await file.text();
    const lines = text.split("\n").length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
    const words =
        text.trim().length === 0
            ? 0
            : text.trim().split(/\s+/).filter((w) => w.length > 0).length;
    return [
        { label: "Lines", value: lines },
        { label: "Paragraphs", value: paragraphs },
        { label: "Words (est.)", value: words },
    ];
}

export const PlaintextImporterForm: React.FC<ImporterComponentProps> = (props) => {
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
                throw new Error(validation.errors.join(", "));
            }
            const importResult = await parseFile(file, onProgress);
            if (!importResult.success || !importResult.notebookPair) {
                throw new Error(importResult.error || "Failed to parse file");
            }
            return importResult.notebookPair;
        },
        []
    );

    const isTranslationImport = props.wizardContext?.intent === "target";

    return (
        <UnifiedImporterForm
            title="Import Plain Text"
            description={
                isTranslationImport
                    ? "Import plain text translation that will be aligned with existing cells. Content will be inserted sequentially into empty cells."
                    : "Import plain text files with intelligent structure detection. Supports various text formats and splitting options."
            }
            icon={FileText}
            accept=".txt,.text,text/*"
            extensionBadges={[".txt", ".text"]}
            analyzeFiles={analyzePlaintextFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={sequentialCellAligner}
            showEnforceStructure
        />
    );
};
