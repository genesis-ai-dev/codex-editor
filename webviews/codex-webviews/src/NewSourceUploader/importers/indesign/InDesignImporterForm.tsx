import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import type { ImporterComponentProps } from "../../types/plugin";
import type { ImportProgress } from "../../types/common";
import { createIdmlV2NotebookPair } from "../idml-v2/idmlV2Import";

export const InDesignImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const analyzeFiles = useCallback(async (files: File[]): Promise<FileAnalysisStat[]> => {
        const file = files[0];
        return file
            ? [
                  { label: "File name", value: file.name },
                  { label: "Size", value: `${(file.size / 1024).toFixed(1)} KB` },
                  { label: "Round-trip engine", value: "IDML v2 (protected anchors)" },
              ]
            : [];
    }, []);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void,
            signal?: AbortSignal
        ) => {
            const file = files[0];
            if (!file) throw new Error("No file selected");
            return createIdmlV2NotebookPair(
                file,
                "generic",
                onProgress,
                undefined,
                signal
            );
        },
        []
    );

    return (
        <UnifiedImporterForm
            title="Import InDesign IDML"
            description="Import every literal IDML text location with protected formatting anchors. Native fidelity remains experimental until Adobe validation passes."
            icon={FileText}
            accept=".idml"
            extensionBadges={[".idml", "IDML v2"]}
            multipleFiles={false}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            showPreview={false}
            showEnforceStructure
        />
    );
};
