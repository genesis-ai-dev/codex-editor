import { useMemo } from "react";
import { CodexNotebookAsJSONData, QuillCellContent } from "@types";
import { removeHtmlTags } from "./subtitleUtils";
import { ExportOptions } from "./exportHandler";
import * as vscode from "vscode";
export const generateVttData = (
    cells: CodexNotebookAsJSONData["cells"],
    includeStyles: boolean,
    filePath: string
): string => {
    if (!cells.length) return "";

    const formatTime = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        return date.toISOString().substr(11, 12);
    };

    const cues = cells
        .filter((unit) => !!unit.metadata?.data?.startTime)
        .map((unit, index) => {
            const startTime = unit.metadata?.data?.startTime ?? index;
            const endTime = unit.metadata?.data?.endTime ?? index + 1;
            return `${unit.metadata?.id}
${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}
${includeStyles ? unit.value : removeHtmlTags(unit.value)}

`;
        })
        .join("\n");

    if (cues.length === 0) {
        vscode.window.showInformationMessage("No cues found in the " + filePath);
    }

    return `WEBVTT

${cues}`;
};
