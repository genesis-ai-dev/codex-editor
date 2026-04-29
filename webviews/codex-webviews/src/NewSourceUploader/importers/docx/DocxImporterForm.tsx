import React, { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import { type ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { validateFile, parseFile } from "./index";
import { DEFAULT_IDEAL_CELL_LENGTH } from "../../utils/textSplitter";

export const DocxImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const [idealCellLength, setIdealCellLength] = useState<number>(DEFAULT_IDEAL_CELL_LENGTH);

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

                const importResult = await parseFile(file, onProgress, { idealCellLength });
                if (!importResult.success || !importResult.notebookPair) {
                    throw new Error(importResult.error || `Failed to parse ${file.name}`);
                }

                results.push(importResult.notebookPair);
            }

            return results.length === 1 ? results[0]! : results;
        },
        [idealCellLength]
    );

    const advancedSettings = (
        <>
            <div className="flex items-center gap-3">
                <label
                    htmlFor="ideal-cell-length"
                    className="text-sm font-medium whitespace-nowrap"
                >
                    Ideal cell length (in characters)
                </label>
                <input
                    id="ideal-cell-length"
                    type="number"
                    min={0}
                    step={10}
                    value={idealCellLength}
                    onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 0) setIdealCellLength(v);
                    }}
                    className="w-24 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
            </div>
            <p className="text-xs text-gray-500">
                Long paragraphs are split into smaller cells at sentence boundaries. Set to 0 to
                disable splitting.
            </p>
        </>
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
            advancedSettings={advancedSettings}
        />
    );
};
