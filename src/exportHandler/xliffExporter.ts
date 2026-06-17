import * as vscode from "vscode";
import { basename } from "path";
import { CodexNotebookAsJSONData } from "../../types";
import { readCodexNotebookFromUri, getActiveCells, isContentCellType } from "./exportHandlerUtils";
import type { ExportOptions } from "./exportHandler";
import type { ExportProgressReporter } from "./exportProgress";

const DEBUG = false;
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[XliffExporter]", ...args);
    }
}

/**
 * Escapes a string for safe use in XML (XLIFF) content
 */
function escapeXmlForXliff(text: string): string {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Strips HTML tags from content for plain text export
 */
function stripHtmlForExport(html: string): string {
    if (!html) return "";
    return html.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

export async function exportCodexContentAsXliff(
    userSelectedPath: string,
    filesToExport: string[],
    reporter: ExportProgressReporter,
    options?: ExportOptions,
    token?: vscode.CancellationToken
) {
    try {
        debug("Starting exportCodexContentAsXliff function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            reporter.error("No project folder found. Please open a project first.");
            return;
        }

        const projectConfig = vscode.workspace.getConfiguration(
            "codex-project-manager"
        );
        const sourceLanguage = projectConfig.get("sourceLanguage") as
            | { refName: string; }
            | undefined;
        const targetLanguage = projectConfig.get("targetLanguage") as
            | { refName: string; }
            | undefined;

        if (!sourceLanguage?.refName || !targetLanguage?.refName) {
            reporter.error(
                "Source and target languages must be set in project settings before exporting to XLIFF."
            );
            return;
        }

        const selectedFiles = filesToExport.map((fp) => vscode.Uri.file(fp));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            reporter.error("No files selected for export.");
            return;
        }

        let totalUnits = 0;

        const exportFolder = vscode.Uri.file(userSelectedPath);
        await vscode.workspace.fs.createDirectory(exportFolder);

        for (const [index, file] of selectedFiles.entries()) {
            if (token?.isCancellationRequested) return;
            reporter.report({
                stage: "writing",
                message: `Processing file ${index + 1}/${selectedFiles.length}`,
                file: basename(file.fsPath),
                current: index + 1,
                total: selectedFiles.length,
            });

            debug(`Processing file: ${file.fsPath}`);

            const fileBaseName =
                basename(file.fsPath).split(".")[0] || "export";

            const sourceFileName = `${fileBaseName}.source`;
            const sourceFile = vscode.Uri.joinPath(
                vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                ".project",
                "sourceTexts",
                sourceFileName
            );

            let sourceData: Uint8Array | null = null;
            try {
                sourceData = await vscode.workspace.fs.readFile(sourceFile);
            } catch (error) {
                reporter.fileMissing(`${fileBaseName} (source not found)`, "source-not-found");
                continue;
            }

            const sourceNotebook = JSON.parse(
                Buffer.from(sourceData).toString()
            ) as CodexNotebookAsJSONData;
            const codexNotebook = await readCodexNotebookFromUri(file);

            debug(`File has ${codexNotebook.cells.length} cells`);

            const sourceTextCells = getActiveCells(
                sourceNotebook.cells
            ).filter(
                (cell) =>
                    (cell.kind === 2 || cell.kind === 1) &&
                    isContentCellType((cell.metadata as any)?.type)
            );
            const codexTextCells = getActiveCells(
                codexNotebook.cells
            ).filter(
                (cell) =>
                    (cell.kind === 2 || cell.kind === 1) &&
                    isContentCellType((cell.metadata as any)?.type)
            );

            const units: Array<{
                unitId: string;
                source: string;
                target: string;
            }> = [];
            const pairCount = Math.min(
                sourceTextCells.length,
                codexTextCells.length
            );

            for (let i = 0; i < pairCount; i++) {
                const sourceCell = sourceTextCells[i];
                const codexCell = codexTextCells[i];

                let sourceContent = sourceCell.value?.trim() || "";
                const sourceMeta = sourceCell.metadata as any;
                if (sourceMeta?.data?.originalContent) {
                    sourceContent = sourceMeta.data.originalContent;
                }
                if (sourceMeta?.data?.originalText) {
                    sourceContent = sourceMeta.data.originalText;
                }

                const targetContent = codexCell.value?.trim() || "";

                if (!sourceContent && !targetContent) continue;

                const unitId =
                    (codexCell.metadata as any)?.id ||
                    `${fileBaseName}_${i + 1}`;

                units.push({
                    unitId: String(unitId),
                    source: stripHtmlForExport(sourceContent),
                    target: stripHtmlForExport(targetContent),
                });
                totalUnits++;
            }

            const unitsXml = units
                .map(
                    (u) => `
<unit id="${escapeXmlForXliff(u.unitId)}">
    <segment>
        <source>${escapeXmlForXliff(u.source)}</source>
        <target>${escapeXmlForXliff(u.target)}</target>
    </segment>
</unit>`
                )
                .join("");

            const xliffContent = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="${escapeXmlForXliff(sourceLanguage.refName)}" trgLang="${escapeXmlForXliff(targetLanguage.refName)}">
    <file id="${escapeXmlForXliff(fileBaseName)}" original="${escapeXmlForXliff(fileBaseName)}.codex">${unitsXml}
    </file>
</xliff>`;

            const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-");
            const exportFileName = `${fileBaseName}_${timestamp}.xliff`;
            const exportFile = vscode.Uri.joinPath(
                exportFolder,
                exportFileName
            );
            await vscode.workspace.fs.writeFile(
                exportFile,
                Buffer.from(xliffContent)
            );
            debug(`XLIFF file created: ${exportFile.fsPath}`);
        }

        reporter.complete({
            exportPath: userSelectedPath,
            filesExported: selectedFiles.length,
            extraMessages: [
                `${totalUnits} translation unit(s) from ${selectedFiles.length} file(s) exported.`,
            ],
        });
    } catch (error) {
        console.error("XLIFF Export failed:", error);
        reporter.error(`XLIFF Export failed: ${error}`);
    }
}
