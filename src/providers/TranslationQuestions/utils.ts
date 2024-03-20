import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { DownloadedResource } from "../obs/resources/types";

import * as vscode from "vscode";
import { parseTwlTsv, tsvToChapterVerseRef } from "../translationWordsList/tsv";

export const getVerseTranslationQuestions = async (
    resource: DownloadedResource,
    verseRef: string,
) => {
    const { bookID, chapter, verse } = extractBookChapterVerse(verseRef);
    if (!vscode.workspace.workspaceFolders?.[0]) {
        console.error("No workspace is open. Please open a workspace.");
        return;
    }
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath,
    );

    const bookUri = vscode.Uri.joinPath(resourceDirUri, `tq_${bookID}.tsv`);
    const bookContent = await vscode.workspace.fs.readFile(bookUri);

    const bookContentString = bookContent.toString();

    const tsvData = parseTwlTsv(bookContentString);

    const chapterVerseRef = tsvToChapterVerseRef(tsvData);

    const questions = chapterVerseRef[chapter]?.[verse];

    return questions ?? [];
};
