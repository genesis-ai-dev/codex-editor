import * as vscode from "vscode";
import { DownloadedResource } from "../types";

enum ViewTypes {
    OBS = "scribe.obs",
    BIBLE = "default",
    TRANSLATION_HELPER = "resources.translationHelper",
}

export const openOBS = async (
    resource: DownloadedResource,
    storyId?: string,
) => {
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRootUri) {
        return;
    }
    const resourceRootUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
    );

    const resourceStoryUri = vscode.Uri.joinPath(
        resourceRootUri,
        "content",
        `${storyId ?? "01"}.md`,
    );

    const existingViewCols = vscode.window.tabGroups.all.map(
        (editor) => editor.viewColumn,
    );

    await vscode.commands.executeCommand(
        "vscode.openWith",
        resourceStoryUri,
        ViewTypes.OBS, // use resource type to load the according view
        { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );

    // get the view cols and tab id of the opened resource

    const newViewCols = vscode.window.tabGroups.all.map(
        (tabGroup) => tabGroup.viewColumn,
    );

    const newViewCol = newViewCols.find(
        (col) => !existingViewCols.includes(col),
    );

    return {
        viewColumn: newViewCol,
    };
};

export const openBible = async (
    resource: DownloadedResource,
    bibleBook?: string,
) => {
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRootUri) {
        return;
    }
    const resourceRootUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
    );

    const bookUri = vscode.Uri.joinPath(
        resourceRootUri,
        `${bibleBook ?? "01-GEN"}.usfm`,
    );

    const existingViewCols = vscode.window.tabGroups.all.map(
        (editor) => editor.viewColumn,
    );

    await vscode.commands.executeCommand(
        "vscode.openWith",
        bookUri,
        ViewTypes.BIBLE, // use resource type to load the according view
        { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );

    // get the view cols and tab id of the opened resource

    const newViewCols = vscode.window.tabGroups.all.map(
        (tabGroup) => tabGroup.viewColumn,
    );

    const newViewCol = newViewCols.find(
        (col) => !existingViewCols.includes(col),
    );

    return {
        viewColumn: newViewCol,
    };
};

export const openTranslationHelper = async (resource: DownloadedResource) => {
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRootUri) {
        return;
    }
    const resourceRootUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
    );

    const translationHelperUri = vscode.Uri.joinPath(
        resourceRootUri,
        "metadata.json",
    );
    // .with({ scheme: ViewTypes.TRANSLATION_HELPER });

    const existingViewCols = vscode.window.tabGroups.all.map(
        (editor) => editor.viewColumn,
    );

    await vscode.commands.executeCommand(
        "vscode.openWith",
        translationHelperUri,
        ViewTypes.TRANSLATION_HELPER, // use resource type to load the according view
        { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );

    // get the view cols and tab id of the opened resource

    const newViewCols = vscode.window.tabGroups.all.map(
        (tabGroup) => tabGroup.viewColumn,
    );

    const newViewCol = newViewCols.find(
        (col) => !existingViewCols.includes(col),
    );

    return {
        viewColumn: newViewCol,
    };
};

export const openTn = async (
    resource: DownloadedResource,
    bibleBook?: string,
) => {
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRootUri) {
        return;
    }
    const resourceRootUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
    );

    const resourceMdUri = vscode.Uri.joinPath(resourceRootUri, "metadata.json");

    const md = await vscode.workspace.fs.readFile(resourceMdUri);
    const metadata = JSON.parse(md.toString());

    const firstNotePath = metadata.projects[0]?.path;

    const firstNoteUri = vscode.Uri.joinPath(resourceRootUri, firstNotePath);

    const existingViewCols = vscode.window.tabGroups.all.map(
        (editor) => editor.viewColumn,
    );

    await vscode.commands.executeCommand(
        "vscode.openWith",
        firstNoteUri,
        ViewTypes.BIBLE, // use resource type to load the according view
        { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );

    // get the view cols and tab id of the opened resource

    const newViewCols = vscode.window.tabGroups.all.map(
        (tabGroup) => tabGroup.viewColumn,
    );

    const newViewCol = newViewCols.find(
        (col) => !existingViewCols.includes(col),
    );

    return {
        viewColumn: newViewCol,
    };
};
