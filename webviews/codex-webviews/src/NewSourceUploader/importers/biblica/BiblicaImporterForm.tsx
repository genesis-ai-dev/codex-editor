/**
 * Biblica Importer Form — study Bible notes from InDesign IDML (custom IDML parsing).
 */

import React, { useCallback } from "react";
import { BookOpen } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { CustomNotebookCellData } from "types";
import { CodexCellTypes } from "types/enums";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import { ImporterComponentProps, sequentialCellAligner } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { IDMLParser } from "./biblicaParser";
import { HTMLMapper } from "./htmlMapper";
import {
    sanitizeFileName,
    addMilestoneCellsToNotebookPair,
    createCodexCellsFromSource,
} from "../../utils/workflowHelpers";
import { createCellsFromStories } from "./biblicaCellBuilder";
import { isBiblicaFrontBackMatterDocument } from "./biblicaImportUtils";

async function processBiblicaIdml(
    studyBibleFile: File,
    onProgress: (progress: ImportProgress) => void
): Promise<NotebookPair[]> {
    onProgress({ stage: "Read", message: "Reading IDML file…", progress: 15 });

    const arrayBuffer = await studyBibleFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const firstBytes = Array.from(uint8Array.slice(0, 4))
        .map((b) => String.fromCharCode(b))
        .join("");
    if (firstBytes !== "PK\u0003\u0004") {
        throw new Error(
            "The selected file does not appear to be a valid IDML file. IDML files should be ZIP-compressed starting with PK"
        );
    }

    onProgress({ stage: "Parse", message: "Parsing Study Bible IDML…", progress: 35 });
    const parser = new IDMLParser({
        preserveAllFormatting: true,
        preserveObjectIds: true,
        validateRoundTrip: false,
        strictMode: false,
    });

    let document: Awaited<ReturnType<IDMLParser["parseIDML"]>>;
    try {
        document = await parser.parseIDML(arrayBuffer);
    } catch (parseError) {
        throw parseError instanceof Error ? parseError : new Error(String(parseError));
    }

    if (document.stories.length === 0) {
        throw new Error(
            "No stories found in the Study Bible IDML file. The file may be corrupted or empty."
        );
    }

    let totalParagraphs = 0;
    for (const story of document.stories) {
        totalParagraphs += story.paragraphs.length;
    }
    if (totalParagraphs === 0) {
        throw new Error(
            "No paragraphs found in the Study Bible IDML file. The file may be corrupted or empty."
        );
    }

    onProgress({ stage: "Convert", message: "Converting to HTML representation…", progress: 55 });
    const htmlMapper = new HTMLMapper();
    const htmlRepresentation = htmlMapper.convertToHTML(document);

    // Front/back matter volumes (contents, dictionary, timelines, maps, cover) carry no
    // verses, and their text lives in layout styles rather than intro/* note styles.
    const isFrontBackMatter = isBiblicaFrontBackMatterDocument(document.stories);
    const contentType = isFrontBackMatter ? "frontBackMatter" : "notes";

    onProgress({
        stage: "Cells",
        message: isFrontBackMatter
            ? "Creating notebook cells from front/back matter…"
            : "Creating notebook cells from study notes…",
        progress: 75,
    });
    const allCells = await createCellsFromStories(
        document.stories,
        htmlRepresentation,
        studyBibleFile.name,
        { includeAllTextStyles: isFrontBackMatter }
    );

    // Some front/back volumes are pure artwork (maps, plates) and hold no editable text.
    // They still import so the file stays part of the project and round-trips unchanged.
    if (allCells.length === 0 && !isFrontBackMatter) {
        throw new Error(
            "No cells were created from the parsed content. Check the cell creation logic."
        );
    }

    const noteCells = allCells;

    onProgress({ stage: "Finalize", message: "Building notebook pair…", progress: 90 });

    const simplifiedNoteCells = noteCells.map((cell) => ({
        id: cell.id,
        content: cell.content,
        images: cell.images,
        metadata: cell.metadata,
    }));

    if (simplifiedNoteCells.length === 0) {
        // Artwork-only volume: a lone milestone keeps the notebook well-formed so the file
        // is still listed in the project and exports back byte-for-byte.
        const milestoneId = uuidv4();
        simplifiedNoteCells.push({
            id: milestoneId,
            content: "1",
            images: [],
            metadata: {
                id: milestoneId,
                type: CodexCellTypes.MILESTONE,
                edits: [],
            } as CustomNotebookCellData["metadata"],
        });
    }

    const rawBaseName = studyBibleFile.name.replace(/\.idml$/i, "");
    const cleanBaseName = rawBaseName.replace(/[-_]?notes$/i, "");
    const baseName = sanitizeFileName(cleanBaseName);
    const originalFileName = studyBibleFile.name;

    const notebookPairs: NotebookPair[] = [];

    if (simplifiedNoteCells.length > 0) {
        notebookPairs.push({
            source: {
                name: baseName,
                cells: simplifiedNoteCells,
                metadata: {
                    id: uuidv4(),
                    originalFileName,
                    sourceFile: originalFileName,
                    originalFileData: arrayBuffer,
                    importerType: "biblica",
                    createdAt: new Date().toISOString(),
                    importContext: {
                        importerType: "biblica",
                        fileName: originalFileName,
                        originalFileName,
                        originalHash: document.originalHash,
                        documentId: document.id,
                        importTimestamp: new Date().toISOString(),
                        contentType,
                    },
                    documentId: document.id,
                    storyCount: document.stories.length,
                    originalHash: document.originalHash,
                    totalCells: simplifiedNoteCells.length,
                    fileType: "biblica",
                    contentType,
                },
            },
            codex: {
                name: baseName,
                cells: createCodexCellsFromSource(simplifiedNoteCells),
                metadata: {
                    id: uuidv4(),
                    originalFileName,
                    sourceFile: originalFileName,
                    importerType: "biblica",
                    createdAt: new Date().toISOString(),
                    importContext: {
                        importerType: "biblica",
                        fileName: originalFileName,
                        originalFileName,
                        originalHash: document.originalHash,
                        documentId: document.id,
                        importTimestamp: new Date().toISOString(),
                        contentType,
                    },
                    documentId: document.id,
                    storyCount: document.stories.length,
                    originalHash: document.originalHash,
                    totalCells: simplifiedNoteCells.length,
                    fileType: "biblica",
                    isCodex: true,
                    contentType,
                },
            },
        });
    }

    const notebookPairsWithMilestones = notebookPairs.map((pair) =>
        addMilestoneCellsToNotebookPair(pair)
    );

    onProgress({ stage: "Complete", message: "Import ready", progress: 100 });

    return notebookPairsWithMilestones;
}

async function analyzeBiblicaFiles(files: File[]): Promise<FileAnalysisStat[]> {
    const file = files[0];
    if (!file) {
        return [];
    }
    return [
        { label: "File name", value: file.name },
        { label: "Size", value: `${(file.size / 1024 / 1024).toFixed(2)} MB` },
    ];
}

export const BiblicaImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const processFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair[]> => {
            const studyBibleFile = files[0];
            if (!studyBibleFile) {
                throw new Error("No file selected");
            }
            if (!studyBibleFile.name.toLowerCase().endsWith(".idml")) {
                throw new Error("Please select a valid IDML file (.idml extension)");
            }
            return processBiblicaIdml(studyBibleFile, onProgress);
        },
        []
    );

    const isTranslationImport = props.wizardContext?.intent === "target";

    return (
        <UnifiedImporterForm
            title="Biblica Importer"
            description={
                isTranslationImport
                    ? "Import Biblica study Bible notes from IDML for alignment with an existing source notebook."
                    : "Import Biblica study Bible notes from InDesign IDML. Verse references are detected for note metadata; add translated scripture later with Bible Swapper."
            }
            icon={BookOpen}
            accept=".idml"
            extensionBadges={[".idml"]}
            showPreview={false}
            analyzeFiles={analyzeBiblicaFiles}
            processFiles={processFiles}
            importerProps={props}
            cellAligner={sequentialCellAligner}
            showEnforceStructure
        />
    );
};
