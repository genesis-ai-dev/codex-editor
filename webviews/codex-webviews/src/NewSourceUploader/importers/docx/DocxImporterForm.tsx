import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import { type ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { validateFile, parseFile } from "./index";

export const DocxImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const analyzeFiles = useCallback(async (files: File[]): Promise<FileAnalysisStat[]> => {
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        return [
            { label: "Files", value: files.length },
            {
                label: "Total size",
                value: `${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
            },
        ];
    }, []);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair | NotebookPair[]> => {
            const results: NotebookPair[] = [];
            const n = files.length;

            for (let i = 0; i < n; i++) {
                const file = files[i];
                onProgress({
                    stage: "Validation",
                    message: `Validating ${file.name} (${i + 1}/${n})...`,
                    progress: 10 + (i * 70) / n,
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

            return results.length === 1 ? results[0]! : results;
        },
        []
    );

    return (
        <UnifiedImporterForm
            title="Import DOCX Document"
            description="Import Microsoft Word .docx files with structure preserved for round-trip export. Multiple files are supported. Very large or complex documents may take longer to process."
            icon={FileText}
            accept=".docx"
            extensionBadges={[".docx"]}
            multipleFiles={true}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={sequentialCellAligner}
            showPreview={false}
            showEnforceStructure
        />
    );
};
