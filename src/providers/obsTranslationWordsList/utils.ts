import { DownloadedResource } from "../obs/resources/types";
import * as vscode from "vscode";
import { parseTwlTsv, tsvToChapterVerseRef } from "../translationWordsList/tsv";
import { fileExists } from "../obs/CreateProject/utilities/obs";
import { OBSRef } from "../../../types";
import { convertTwlRCUriToScribeResourceUri } from "../translationWordsList/utils";
import { tsvToStoryParagraphRef } from "../obsTranslationNotes/tsv";

export const getTranslationWordsListByObsRef = async (
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

    const tsvFileUri = vscode.Uri.joinPath(resourceDirUri, `twl_OBS.tsv`);
    const tsvFileContent = await vscode.workspace.fs.readFile(tsvFileUri);

    const tsvFileContentString = tsvFileContent.toString();

    const tsvData = parseTwlTsv(tsvFileContentString);

    const tsvDataWithTwUriPromises = await Promise.allSettled(
        tsvData.map(async (row) => ({
            ...row,
            twUriPath: (
                await convertTwlRCUriToScribeResourceUri(resource, row.TWLink)
            ).path,
        })),
    );

    const TsvDataWithTwUri = tsvDataWithTwUriPromises
        .map((p) => (p.status === "fulfilled" ? p.value : null))
        .filter(Boolean);

    const obsRefData = tsvToStoryParagraphRef(
        TsvDataWithTwUri as NonNullable<(typeof TsvDataWithTwUri)[number]>[],
    );

    // Removing the ones which don't have files on the disk
    const wordsWithExistsOnDisk = await Promise.all(
        obsRefData[ref.storyId]?.[ref.paragraph]?.map(async (word) => ({
            ...word,
            existsOnDisk: await fileExists(
                vscode.Uri.from({ path: word.twUriPath, scheme: "file" }),
            ),
        })),
    );

    return wordsWithExistsOnDisk ?? [];
};
