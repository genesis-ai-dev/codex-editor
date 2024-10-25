import * as vscode from "vscode";
import { NotebookPreview, ValidationResult, FileType } from "../../types";
import { WebVTTParser } from "webvtt-parser";
import { ParsedUSFM, USFMParser } from "usfm-grammar";
import { getFileType } from "../utils/fileTypeUtils";
import { extractVerseRefFromLine, verseRefRegex } from "../utils/verseRefUtils";
import { CodexCellTypes } from "../../types/enums";
import * as path from "path";

export class SourceTransformer {
    async transformToNotebooks(fileUri: vscode.Uri): Promise<{
        sourceNotebooks: NotebookPreview[];
        codexNotebooks: NotebookPreview[];
        validationResults: ValidationResult[];
    }> {
        const fileType = getFileType(fileUri);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = new TextDecoder().decode(content);
        
        // Get base name without extension for notebook name
        const fileName = path.parse(fileUri.fsPath).name;

        switch (fileType) {
            case "subtitles":
                return this.transformWebVTT(textContent, fileName);
            case "usfm":
                return this.transformUSFM(textContent, fileName);
            case "plaintext":
                return this.transformPlainText(textContent, fileName);
            default:
                throw new Error(`Unsupported file type: ${fileType}`);
        }
    }

    private async transformWebVTT(content: string, baseName: string) {
        const parser = new WebVTTParser();
        const parsed = parser.parse(content);

        const sourceNotebook = this.createNotebookPreview("source", baseName);
        const codexNotebook = this.createNotebookPreview("codex", baseName);

        for (const cue of parsed.cues) {
            // Add cells to source notebook
            sourceNotebook.cells.push({
                value: cue.text,
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: `cue-${cue.startTime}-${cue.endTime}`,
                    type: "text",
                    data: {
                        startTime: cue.startTime,
                        endTime: cue.endTime,
                    },
                },
            });

            // Add empty cells to codex notebook
            codexNotebook.cells.push({
                value: "",
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: `cue-${cue.startTime}-${cue.endTime}`,
                    type: "text",
                    data: {
                        startTime: cue.startTime,
                        endTime: cue.endTime,
                    },
                },
            });
        }

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private async transformUSFM(content: string, baseName: string) {
        // Use the grammar import from codexNotebookUtils.ts
        const parser = new USFMParser(content);
        const parsed = parser.toJSON() as unknown as ParsedUSFM;
        // FIXME: verify use of usfm grammar as per codexNotebookUtils.ts

        const notebookName = parsed.book || baseName;

        const sourceNotebook = this.createNotebookPreview("source", notebookName);
        const codexNotebook = this.createNotebookPreview("codex", notebookName);

        // Process each verse
        for (const chapter of parsed.chapters) {
            for (const verse of chapter.contents) {
                const verseRef = `${parsed.book} ${chapter.chapterNumber}:${verse.verseNumber}`;

                // Add to source notebook
                sourceNotebook.cells.push({
                    value: verse.contents?.join("\n") ?? "",
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    metadata: {
                        id: verseRef,
                        type: "text",
                        data: {
                            book: parsed.book,
                            chapter: chapter.chapterNumber,
                            verse: verse.verseNumber,
                        },
                    },
                });

                // Add empty cell to codex notebook
                codexNotebook.cells.push({
                    value: "",
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    metadata: {
                        id: verseRef,
                        type: "text",
                        data: {
                            book: parsed.book,
                            chapter: chapter.chapterNumber,
                            verse: verse.verseNumber,
                        },
                    },
                });
            }
        }

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private async transformPlainText(content: string, baseName: string) {
        const lines = content.split("\n");
        const sourceNotebook = this.createNotebookPreview("source", baseName);
        const codexNotebook = this.createNotebookPreview("codex", baseName);

        for (const line of lines) {
            const verseRef = extractVerseRefFromLine(line);
            if (!verseRef) continue;

            const verseContent = line.replace(verseRefRegex, "").trim();

            // Add to source notebook
            sourceNotebook.cells.push({
                value: verseContent,
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: verseRef,
                    type: "text",
                    data: {},
                },
            });

            // Add empty cell to codex notebook
            codexNotebook.cells.push({
                value: "",
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: verseRef,
                    type: "text",
                    data: {},
                },
            });
        }

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private createNotebookPreview(type: "source" | "codex", name: string): NotebookPreview {
        return {
            name, // Set the name from the parameter
            cells: [],
            metadata: {
                id: name, // Also use the name as the ID
                originalName: name,
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                gitStatus: "untracked",
                corpusMarker: "",
            },
        };
    }
}
