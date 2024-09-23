import { OBSRef } from "../../../types";
import { fileExists } from "../obs/CreateProject/utilities/obs";
import { DownloadedResource } from "../obs/resources/types";
import * as vscode from "vscode";

export const getStoryData = async (resource: DownloadedResource, ref: OBSRef) => {
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath
    );

    let storyUri = vscode.Uri.joinPath(resourceDirUri, "content", `${ref.storyId}.md`);

    if (await fileExists(storyUri)) {
        const storyContent = await vscode.workspace.fs.readFile(storyUri);
        return storyContent.toString();
    }

    storyUri = vscode.Uri.joinPath(resourceDirUri, "ingredients", `${ref.storyId}.md`);

    if (await fileExists(storyUri)) {
        const storyContent = await vscode.workspace.fs.readFile(storyUri);
        return storyContent.toString();
    }

    throw new Error("Unable to find story content! Please check the resource or contact support.");
};
