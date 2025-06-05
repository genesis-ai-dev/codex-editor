import { FileData } from "./indexes/fileReaders";
import * as vscode from "vscode";
import { verseRefRegex } from "../../../utils/verseRefUtils";
import { getWorkSpaceUri } from "../../../utils";

export async function updateCompleteDrafts(targetFiles: FileData[]): Promise<void> {
    const workspaceFolderUri = getWorkSpaceUri();
    if (!workspaceFolderUri) {
        throw new Error("Workspace folder not found.");
    }

    const completeDrafts: string[] = [];

    for (const file of targetFiles) {
        for (const cell of file.cells) {
            if (cell.metadata?.type === "text" && cell.metadata?.id && cell.value.trim() !== "") {
                completeDrafts.push(cell.value);
            }
        }
    }

    const completeDraftPath = vscode.Uri.joinPath(
        workspaceFolderUri,
        ".project",
        "complete_drafts.txt"
    );
    if (completeDraftPath) {
        await vscode.workspace.fs.writeFile(
            completeDraftPath,
            Buffer.from(completeDrafts.join("\n"), "utf8")
        );
    }
}
