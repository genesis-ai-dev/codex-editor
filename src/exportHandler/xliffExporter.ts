import * as vscode from "vscode";
import { basename } from "path";
import { CodexCellTypes } from "../../types/enums";
import { CodexNotebookAsJSONData } from "../../types";
import { readCodexNotebookFromUri, getActiveCells } from "./exportHandlerUtils";
import type { ExportOptions } from "./exportHandler";

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
    options?: ExportOptions
) {
    try {
        debug("Starting exportCodexContentAsXliff function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const projectConfig = vscode.workspace.getConfiguration(
            "codex-project-manager"
        );
        const sourceLanguage = projectConfig.get("sourceLanguage") as
            | { refName: string }
            | undefined;
        const targetLanguage = projectConfig.get("targetLanguage") as
            | { refName: string }
            | undefined;

        if (!sourceLanguage?.refName || !targetLanguage?.refName) {
            vscode.window.showErrorMessage(
                "Source and target languages must be configured before exporting to XLIFF."
            );
            return;
        }

        const selectedFiles = filesToExport.map((fp) => vscode.Uri.file(fp));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            vscode.window.showInformationMessage(
                "No files selected for export."
            );
            return;
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Codex Content as XLIFF",
                cancellable: false,
            },
            async (progress) => {
                let totalUnits = 0;
                const increment = 100 / selectedFiles.length;

                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
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
                        sourceData = await vscode.workspace.fs.readFile(
                            sourceFile
                        );
                    } catch (error) {
                        vscode.window.showWarningMessage(
                            `Source file not found for ${fileBaseName} at ${sourceFile.fsPath}, skipping...`
                        );
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
                            (cell.metadata as any)?.type === CodexCellTypes.TEXT
                    );
                    const codexTextCells = getActiveCells(
                        codexNotebook.cells
                    ).filter(
                        (cell) =>
                            (cell.kind === 2 || cell.kind === 1) &&
                            (cell.metadata as any)?.type === CodexCellTypes.TEXT
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

                vscode.window.showInformationMessage(
                    `XLIFF Export completed: ${totalUnits} units from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("XLIFF Export failed:", error);
        vscode.window.showErrorMessage(`XLIFF Export failed: ${error}`);
    }
}
