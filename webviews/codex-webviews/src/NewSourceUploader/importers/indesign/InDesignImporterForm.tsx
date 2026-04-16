/**
 * InDesign Importer Form — IDML import via UnifiedImporterForm
 */

import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { UnifiedImporterForm, type FileAnalysisStat } from "../../components/UnifiedImporterForm";
import type { ImporterComponentProps } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import { IDMLParser } from "./idmlParser";
import { HTMLMapper } from "./htmlMapper";
import {
    createProcessedCell,
    sanitizeFileName,
    addMilestoneCellsToNotebookPair,
} from "../../utils/workflowHelpers";
import { extractImagesFromHtml } from "../../utils/imageProcessor";
import {
    createIndesignVerseCellMetadata,
    createIndesignParagraphCellMetadata,
} from "./cellMetadata";
import type {
    IDMLCharacterStyleRange,
    IDMLDocument,
    IDMLHTMLRepresentation,
    IDMLStory,
} from "./types";

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function buildInlineHTMLFromRanges(ranges: IDMLCharacterStyleRange[]): string {
    if (!Array.isArray(ranges) || ranges.length === 0) return "";
    return ranges
        .map((r) => {
            const style = (r?.appliedCharacterStyle || "").toString();
            const text = (r?.content || "").toString().replace(/\n/g, "<br />");
            const safeStyle = escapeHtml(style);
            const safeText = text
                .split("<br />")
                .map((part: string) => escapeHtml(part))
                .join("<br />");
            return `<span class="idml-char" data-character-style="${safeStyle}">${safeText}</span>`;
        })
        .join("");
}

function deriveBookCode(sourceName: string): string {
    const match = sourceName.match(/[0-9]{2}([A-Z]{3})/);
    if (match && match[1]) return match[1];
    const alt = sourceName.match(/\b([A-Z]{3})\b/);
    if (alt && alt[1]) return alt[1];
    return "BOOK";
}

function isNumericToken(token: string): boolean {
    return /^\d{1,3}$/.test(token.trim());
}

async function createCellsFromStories(
    stories: IDMLStory[],
    htmlRepresentation: IDMLHTMLRepresentation,
    document: IDMLDocument,
    fileName: string
) {
    const cells: ReturnType<typeof createProcessedCell>[] = [];
    const bookCode = deriveBookCode(fileName);

    for (const story of stories) {
        for (let i = 0; i < story.paragraphs.length; i++) {
            const paragraph = story.paragraphs[i];
            const content = paragraph.paragraphStyleRange.content;
            const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;

            const cleanText = content
                .replace(/[\r\n]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            if (!cleanText) {
                continue;
            }

            const ranges = paragraph.characterStyleRanges || [];
            if (ranges.length >= 3) {
                const first = (ranges[0]?.content || "").trim();
                const last = (ranges[ranges.length - 1]?.content || "").trim();
                if (isNumericToken(first) && isNumericToken(last) && first === last) {
                    const verseNum = first;
                    const middleRanges = ranges.slice(1, ranges.length - 1);
                    const middleText = middleRanges
                        .map((r) => r.content || "")
                        .join(" ")
                        .replace(/[\s\u00A0]+/g, " ")
                        .trim();
                    if (middleText) {
                        const { cellId, metadata: cellMetadata } = createIndesignVerseCellMetadata({
                            bookCode,
                            chapter: "1",
                            verseNumber: verseNum,
                            originalContent: middleText,
                            storyId: story.id || "",
                            paragraphId: paragraph.id || "",
                            appliedParagraphStyle: paragraphStyle,
                            paragraph,
                            fileName,
                            originalHash: htmlRepresentation.originalHash,
                        });
                        const inlineHTML = buildInlineHTMLFromRanges(middleRanges);
                        const htmlContent = `<p class="indesign-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${inlineHTML}</p>`;
                        const cell = createProcessedCell(cellId, htmlContent, cellMetadata);
                        const images = await extractImagesFromHtml(htmlContent);
                        cell.images = images;
                        cells.push(cell);
                        continue;
                    }
                }
            }

            const { cellId, metadata: cellMetadata } = createIndesignParagraphCellMetadata({
                cellLabel: undefined,
                originalContent: cleanText,
                storyId: story.id || "",
                paragraphId: paragraph.id || "",
                appliedParagraphStyle: paragraphStyle,
                paragraph,
                stories,
                paragraphIndex: i,
                fileName,
                originalHash: htmlRepresentation.originalHash,
            });
            const inlineHTML =
                ranges.length > 0 ? buildInlineHTMLFromRanges(ranges) : escapeHtml(cleanText);
            const htmlContent = `<p class="indesign-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${inlineHTML}</p>`;
            const cell = createProcessedCell(cellId, htmlContent, cellMetadata);
            const images = await extractImagesFromHtml(htmlContent);
            cell.images = images;
            cells.push(cell);
        }
    }
    return cells;
}

async function processIdmlFiles(
    files: File[],
    onProgress: (progress: ImportProgress) => void
): Promise<NotebookPair> {
    const selectedFile = files[0];
    if (!selectedFile) {
        throw new Error("No file selected");
    }
    if (!selectedFile.name.toLowerCase().endsWith(".idml")) {
        throw new Error("Please select a valid IDML file (.idml extension)");
    }

    onProgress({ stage: "Read", message: "Reading IDML file...", progress: 10 });
    const arrayBuffer = await selectedFile.arrayBuffer();

    const uint8Array = new Uint8Array(arrayBuffer);
    const firstBytes = Array.from(uint8Array.slice(0, 4))
        .map((b) => String.fromCharCode(b))
        .join("");
    if (firstBytes !== "PK\u0003\u0004") {
        throw new Error(
            "The selected file does not appear to be a valid InDesign (IDML) file. Please make sure you selected the correct file."
        );
    }

    onProgress({ stage: "Parse", message: "Parsing IDML content...", progress: 30 });
    const parser = new IDMLParser({
        preserveAllFormatting: true,
        preserveObjectIds: true,
        validateRoundTrip: false,
        strictMode: false,
    });

    let document: IDMLDocument;
    try {
        document = await parser.parseIDML(arrayBuffer);
    } catch (parseError) {
        throw parseError instanceof Error ? parseError : new Error("Failed to parse IDML content");
    }

    if (document.stories.length === 0) {
        throw new Error("No stories found in the IDML file. The file may be corrupted or empty.");
    }

    let totalParagraphs = 0;
    for (const story of document.stories) {
        totalParagraphs += story.paragraphs.length;
    }
    if (totalParagraphs === 0) {
        throw new Error(
            "No paragraphs found in the IDML file. The file may be corrupted or empty."
        );
    }

    onProgress({
        stage: "HTML",
        message: "Converting to HTML representation...",
        progress: 50,
    });
    const htmlMapper = new HTMLMapper();
    const htmlRepresentation = htmlMapper.convertToHTML(document);

    onProgress({ stage: "Cells", message: "Creating notebook cells...", progress: 70 });
    let cells;
    try {
        cells = await createCellsFromStories(
            document.stories,
            htmlRepresentation,
            document,
            selectedFile.name
        );
    } catch (cellError) {
        throw cellError instanceof Error
            ? cellError
            : new Error("Failed to create cells from IDML stories");
    }

    if (cells.length === 0) {
        throw new Error(
            "No cells were created from the parsed content. Check the cell creation logic."
        );
    }

    onProgress({ stage: "Complete", message: "Import completed successfully!", progress: 100 });

    const simplifiedCells = cells.map((cell) => ({
        id: cell.id,
        content: cell.content,
        metadata: cell.metadata,
    }));

    const baseName = sanitizeFileName(selectedFile.name);

    const result: NotebookPair = {
        source: {
            name: baseName,
            cells: simplifiedCells,
            metadata: {
                id: uuidv4(),
                originalFileName: selectedFile.name,
                sourceFile: selectedFile.name,
                originalFileData: arrayBuffer,
                importerType: "indesign",
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: "indesign",
                    fileName: selectedFile.name,
                    originalFileName: selectedFile.name,
                    originalHash: document.originalHash,
                    documentId: document.id,
                    importTimestamp: new Date().toISOString(),
                },
                documentId: document.id,
                storyCount: document.stories.length,
                originalHash: document.originalHash,
                totalCells: simplifiedCells.length,
                fileType: "indesign",
            },
        },
        codex: {
            name: baseName,
            cells: simplifiedCells.map((cell) => ({
                id: cell.id,
                content: "",
                metadata: {
                    ...cell.metadata,
                    originalContent: cell.content,
                },
            })),
            metadata: {
                id: uuidv4(),
                originalFileName: selectedFile.name,
                sourceFile: selectedFile.name,
                importerType: "indesign",
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: "indesign",
                    fileName: selectedFile.name,
                    originalFileName: selectedFile.name,
                    originalHash: document.originalHash,
                    documentId: document.id,
                    importTimestamp: new Date().toISOString(),
                },
                documentId: document.id,
                storyCount: document.stories.length,
                originalHash: document.originalHash,
                totalCells: simplifiedCells.length,
                fileType: "indesign",
                isCodex: true,
            },
        },
    };

    return addMilestoneCellsToNotebookPair(result);
}

export const InDesignImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const analyzeFiles = useCallback(async (fileList: File[]): Promise<FileAnalysisStat[]> => {
        const f = fileList[0];
        if (!f) return [];
        return [
            { label: "File name", value: f.name },
            { label: "Size", value: `${(f.size / 1024).toFixed(1)} KB` },
        ];
    }, []);

    const processFiles = useCallback(
        async (fileList: File[], onProgress: (progress: ImportProgress) => void) => {
            return processIdmlFiles(fileList, onProgress);
        },
        []
    );

    return (
        <UnifiedImporterForm
            title="Import InDesign File"
            description="Import Adobe InDesign Markup Language (IDML) packages. IDML is a ZIP-based format that contains stories and layout; Codex turns stories into cells for translation."
            icon={FileText}
            accept=".idml"
            extensionBadges={[".idml", "IDML"]}
            multipleFiles={false}
            analyzeFiles={analyzeFiles}
            processFiles={processFiles}
            importerProps={props}
            showPreview={false}
            showEnforceStructure
        />
    );
};
