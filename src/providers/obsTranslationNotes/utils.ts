import { OBSRef } from "../../../types";
import { DownloadedResource } from "../obs/resources/types";
import * as vscode from "vscode";
import { parseObsTsv, tsvToStoryParagraphRef } from "./tsv";
import {
    directoryExists,
    fileExists,
} from "../obs/CreateProject/utilities/obs";

export const getObsRefTranslationNotes = async (
    resource: DownloadedResource,
    ref: OBSRef,
) => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        console.error("No workspace is open. Please open a workspace.");
        return;
    }
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath,
    );

    const tnTsvUri = vscode.Uri.joinPath(resourceDirUri, `tn_OBS.tsv`);

    if (await fileExists(tnTsvUri)) {
        const tnTsvContent = await vscode.workspace.fs.readFile(tnTsvUri);

        const tsvContentString = tnTsvContent.toString();

        const tsvData = parseObsTsv(tsvContentString);

        const storyParagraph = tsvToStoryParagraphRef(tsvData);

        const notes =
            storyParagraph[Number(ref.storyId).toString()]?.[ref.paragraph];

        return notes ?? [];
    }

    const contentDirUri = vscode.Uri.joinPath(resourceDirUri, "content");

    if (await directoryExists(contentDirUri)) {
        const storyNoteUri = vscode.Uri.joinPath(
            contentDirUri,
            Number(ref.storyId).toString().padStart(2, "0"),
            `${Number(ref.paragraph).toString().padStart(2, "0")}.md`,
        );

        if (await fileExists(storyNoteUri)) {
            const noteContent =
                await vscode.workspace.fs.readFile(storyNoteUri);
            return [
                {
                    Note: noteContent.toString(),
                },
            ];
        }
    }

    vscode.window.showErrorMessage(`No translation notes found Resource`);

    return [];
};
