import * as vscode from "vscode";
import { DownloadedResource } from "../types";
import { TranslationWordsProvider } from "../../../translationWords/provider";
import { TranslationWordsListProvider } from "../../../translationWordsList/provider";
import { TranslationQuestionsProvider } from "../../../TranslationQuestions/provider";
import { TnProvider } from "../../../translationNotes/provider";
import { USFMViewerProvider } from "../../../usfm-viewer/provider";

enum ViewTypes {
    OBS = "scribe.obs",
    BIBLE = "default",
    TRANSLATION_HELPER = "resources.translationHelper",
    TN = "codex.translationNotesEditor",
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
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) => {
    const usfmProvider = new USFMViewerProvider(context, resource);
    const usfmViewer = await usfmProvider.startWebview();

    return {
        viewColumn: usfmViewer.viewColumn,
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
// TODO: delete this function once the new provider works
// export const openTn = async (resource: DownloadedResource, bookID: string) => {
//     const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;
//     if (!workspaceRootUri) {
//         return;
//     }
//     const resourceRootUri = vscode.Uri.joinPath(
//         workspaceRootUri,
//         resource.localPath,
//     );

//     const noteUri = vscode.Uri.joinPath(resourceRootUri, `tn_${bookID}.tsv`);

//     const existingViewCols = vscode.window.tabGroups.all.map(
//         (editor) => editor.viewColumn,
//     );

//     await vscode.commands.executeCommand(
//         "vscode.openWith",
//         noteUri,
//         ViewTypes.TN, // use resource type to load the according view
//         { viewColumn: vscode.ViewColumn.Beside, preview: true },
//     );

//     // get the view cols and tab id of the opened resource

//     const newViewCols = vscode.window.tabGroups.all.map(
//         (tabGroup) => tabGroup.viewColumn,
//     );

//     const newViewCol = newViewCols.find(
//         (col) => !existingViewCols.includes(col),
//     );

//     return {
//         viewColumn: newViewCol,
//     };
// };

export const openTn = async (
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) => {
    const tnProvider = new TnProvider(context, resource);
    const tn = await tnProvider.startWebviewPanel();

    return {
        viewColumn: tn.viewColumn,
    };
};

export const openTw = async (
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) => {
    const twProvider = new TranslationWordsProvider(context, resource);

    return await twProvider.startWebview();
};

export const openTwl = async (
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) => {
    const twlProvider = new TranslationWordsListProvider(context, resource);
    const twl = await twlProvider.startWebview();

    return {
        viewColumn: twl.viewColumn,
    };
};

export const openTq = async (
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) => {
    const tqProvider = new TranslationQuestionsProvider(context, resource);

    return await tqProvider.startWebview();
};

export const openTnAcademy = async (resource: DownloadedResource) => {
    await vscode.commands.executeCommand(
        "codex-editor-extension.openTnAcademy",
        resource,
    );
};
