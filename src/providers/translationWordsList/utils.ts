import { DownloadedResource } from "../obs/resources/types";
import * as vscode from "vscode";
import { parseTwlTsv, tsvToChapterVerseRef } from "./tsv";
import { TwlBooksWithChaptersAndVerses } from "./types";
import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { fileExists } from "../obs/CreateProject/utilities/obs";

export const getVerseTranslationWordsList = async (
    resource: DownloadedResource,
    verseRef: string,
) => {
    const { bookID, chapter, verse } = extractBookChapterVerse(verseRef);
    if (!vscode.workspace.workspaceFolders?.[0]) {
        vscode.window.showErrorMessage(
            "No workspace is open. Please open a workspace.",
        );
        return;
    }
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath,
    );

    const bookUri = vscode.Uri.joinPath(resourceDirUri, `twl_${bookID}.tsv`);
    const bookContent = await vscode.workspace.fs.readFile(bookUri);

    const bookContentString = bookContent.toString();

    const tsvData = parseTwlTsv(bookContentString);

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

    const chapterVerseRef = tsvToChapterVerseRef(
        TsvDataWithTwUri as NonNullable<(typeof TsvDataWithTwUri)[number]>[],
    );

    // Removing the ones which don't have files on the disk
    const wordsWithExistsOnDisk = await Promise.all(
        chapterVerseRef[chapter]?.[verse]?.map(async (word) => ({
            ...word,
            existsOnDisk: await fileExists(
                vscode.Uri.from({ path: word.twUriPath, scheme: "file" }),
            ),
        })),
    );

    return wordsWithExistsOnDisk ?? [];
};

// export const getResourceTwl = async (resource: DownloadedResource) => {
//     if (!vscode.workspace.workspaceFolders?.[0]) {
//         vscode.window.showErrorMessage(
//             "No workspace is open. Please open a workspace.",
//         );
//         return;
//     }
//     const resourceDirUri = vscode.Uri.joinPath(
//         vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
//         resource.localPath,
//     );

//     const resourceDir = await vscode.workspace.fs.readDirectory(resourceDirUri);

//     const tsvFiles = resourceDir.filter(
//         (file) => file[1] === vscode.FileType.File && file[0].endsWith(".tsv"),
//     );

//     const twlFiles = tsvFiles.filter((file) => file[0].includes("twl"));

//     const twlFilesUris = twlFiles
//         .map((file) => ({
//             name: file[0],
//             uri: vscode.Uri.joinPath(resourceDirUri, file[0]),
//         }))
//         .slice(0, 2); // TODO: Remove the slice. This is just for testing

//     const twlBooksWithChaptersAndVerses: TwlBooksWithChaptersAndVerses = {};

//     const twlContentsPromises = twlFilesUris.map(async (file) => {
//         const bookUri = twlFilesUris[0].uri;

//         const bookContent = await vscode.workspace.fs.readFile(bookUri);

//         const bookContentString = bookContent.toString();

//         const tsvData = parseTwlTsv(bookContentString);
//         console.log("tsvData to log: ", tsvData);

//         const tsvDataWithTwUri = await Promise.all(
//             tsvData.map(async (row) => ({
//                 ...row,
//                 twUriPath: (
//                     await convertTwlRCUriToScribeResourceUri(
//                         resource,
//                         row.TWLink,
//                     )
//                 ).path,
//             })),
//         );

//         const chapterVerseRef = twlTsvToChapterVerseRef(tsvDataWithTwUri);

//         const bookId = file.name.split("_")[1].split(".")[0];

//         twlBooksWithChaptersAndVerses[bookId] = chapterVerseRef;
//     });

//     await Promise.all(twlContentsPromises);

//     return twlBooksWithChaptersAndVerses;
// };

export const convertTwlRCUriToScribeResourceUri = async (
    resource: DownloadedResource,
    uri: string = "",
): Promise<vscode.Uri> => {
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0]
        .uri as vscode.Uri;

    const resourcesUri = vscode.Uri.joinPath(
        workspaceRootUri,
        ".scribe/resources",
    );

    const twlResourceMetaUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
        "metadata.json",
    );

    const twlResourceMetaFile =
        await vscode.workspace.fs.readFile(twlResourceMetaUri);

    const twlResourceLanguage = JSON.parse(twlResourceMetaFile.toString())?.meta
        ?.language;

    const twResourcesUri = vscode.Uri.joinPath(
        resourcesUri,
        `${twlResourceLanguage}_tw`,
    );

    const twPath = uri.replace("rc://*/tw/dict", twResourcesUri.path);

    return vscode.Uri.from({
        scheme: "file",
        path: `${twPath}.md`,
    });
};
