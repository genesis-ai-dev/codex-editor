import React, { useCallback } from "react";
import { BookOpen } from "lucide-react";
import {
    UnifiedImporterForm,
    type FileAnalysisStat,
} from "../../components/UnifiedImporterForm";
import type { ImporterComponentProps } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { usfmExperimentalImporter } from "./index";
import { usfmCellAligner } from "./usfmCellAligner";

const { validateFile, parseFile } = usfmExperimentalImporter;

export const UsfmImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const isTranslationImport = props.wizardContext?.intent === "target";

    const analyzeFiles = useCallback(async (files: File[]): Promise<FileAnalysisStat[]> => {
        const names =
            files.length <= 5
                ? files.map((f) => f.name).join(", ")
                : `${files
                      .slice(0, 5)
                      .map((f) => f.name)
                      .join(", ")} and ${files.length - 5} more`;
        return [
            { label: "Files", value: files.length },
            { label: "File names", value: names },
        ];
    }, []);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair[]> => {
            const notebookPairs: NotebookPair[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                onProgress({
                    stage: "Processing",
                    message: `Processing ${file.name} (${i + 1}/${files.length})...`,
                    progress: (i / files.length) * 60,
                });

                const validation = await validateFile(file);
                if (!validation.isValid) {
                    console.warn(`Skipping invalid file ${file.name}:`, validation.errors);
                    continue;
                }

                const importResult = await parseFile(file, onProgress, isTranslationImport);

                if (importResult.success && importResult.notebookPair) {
                    notebookPairs.push(importResult.notebookPair);
                } else {
                    console.warn(`Failed to parse ${file.name}:`, importResult.error);
                }
            }

            if (notebookPairs.length === 0) {
                throw new Error("No valid USFM files could be processed");
            }

            return notebookPairs;
        },
        [isTranslationImport]
    );

    const description = isTranslationImport
        ? "Import USFM translation files that will be aligned with existing cells. Content will be matched by verse references or inserted sequentially."
        : "Import Unified Standard Format Marker (USFM) files used for biblical texts. Supports round-trip export with structure preservation.";

    return (
        <UnifiedImporterForm
            title="Import USFM Files"
            description={description}
            icon={BookOpen}
            accept=".usfm,.sfm,.SFM,.USFM"
            extensionBadges={[".usfm", ".sfm"]}
            multipleFiles={true}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={usfmCellAligner}
            showPreview={true}
            showEnforceStructure
        />
    );
};
