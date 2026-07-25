import React, { useCallback } from "react";
import { BookOpen } from "lucide-react";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import type { ImporterComponentProps } from "../../types/plugin";
import type { ImportProgress, NotebookPair } from "../../types/common";
import { createIdmlV2NotebookPair } from "../idml-v2/idmlV2Import";

export const BiblicaImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const analyzeFiles = useCallback(async (files: File[]): Promise<FileAnalysisStat[]> => {
        const file = files[0];
        return file
            ? [
                  { label: "File name", value: file.name },
                  { label: "Size", value: `${(file.size / 1024 / 1024).toFixed(2)} MB` },
                  { label: "Semantic profile", value: "Biblica / complete literal text" },
              ]
            : [];
    }, []);

    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair[]> => {
            const file = files[0];
            if (!file) throw new Error("No file selected");
            return [await createIdmlV2NotebookPair(file, "biblica", onProgress)];
        },
        []
    );

    return (
        <UnifiedImporterForm
            title="Biblica IDML Importer"
            description="Import Biblica IDML through the shared v2 engine. All literal text locations are retained; profile-specific presentation never drops package content."
            icon={BookOpen}
            accept=".idml"
            extensionBadges={[".idml", "IDML v2"]}
            showPreview={false}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            showEnforceStructure
        />
    );
};
