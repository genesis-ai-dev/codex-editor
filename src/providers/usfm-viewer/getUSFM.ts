import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { DownloadedResource } from "../obs/resources/types";
import { sanitizeUSFM } from "./usfmSanitize";
import { Uri } from "vscode";

import * as vscode from "vscode";

interface USFMDocument {
    bookUri: Uri;
    usfmString: string;
    chapter: number;
    verse: number;
}

export const getUSFMDocument = async (resource: DownloadedResource, verseRef: string) => {
    console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
    const { bookID, chapter, verse } = extractBookChapterVerse(verseRef);
    console.log({ bookID, chapter, verse });
    const bookName = getFileName(bookID);
    console.log({ bookName });
    if (!vscode.workspace.workspaceFolders?.[0]) {
        console.log("No workspace is open. Please open a workspace.");
        vscode.window.showErrorMessage("No workspace is open. Please open a workspace.");
        return;
    }
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath
    );
    console.log({ resourceDirUri });
    const bookUri = vscode.Uri.joinPath(resourceDirUri, `${bookName}.usfm`);
    const bookContent = await vscode.workspace.fs.readFile(bookUri);
    const sanitizedContent = sanitizeUSFM(bookContent.toString());
    console.log({ bookUri, sanitizedContent, chapter, verse, bookID });
    return { bookUri, usfmString: sanitizedContent, chapter, verse, bookID };
};

interface BookNamestoFiles {
    [key: string]: string;
}

export const bookNamestoFilename: BookNamestoFiles = {
    GEN: "01-GEN",
    EXO: "02-EXO",
    LEV: "03-LEV",
    NUM: "04-NUM",
    DEU: "05-DEU",
    JOS: "06-JOS",
    JDG: "07-JDG",
    RUT: "08-RUT",
    "1SA": "09-1SA",
    "2SA": "10-2SA",
    "1KI": "11-1KI",
    "2KI": "12-2KI",
    "1CH": "13-1CH",
    "2CH": "14-2CH",
    EZR: "15-EZR",
    NEH: "16-NEH",
    EST: "17-EST",
    JOB: "18-JOB",
    PSA: "19-PSA",
    PRO: "20-PRO",
    ECC: "21-ECC",
    SNG: "22-SNG",
    ISA: "23-ISA",
    JER: "24-JER",
    LAM: "25-LAM",
    EZK: "26-EZK",
    DAN: "27-DAN",
    HOS: "28-HOS",
    JOL: "29-JOL",
    AMO: "30-AMO",
    OBA: "31-OBA",
    JON: "32-JON",
    MIC: "33-MIC",
    NAM: "34-NAM",
    HAB: "35-HAB",
    ZEP: "36-ZEP",
    HAG: "37-HAG",
    ZEC: "38-ZEC",
    MAL: "39-MAL",
    MAT: "41-MAT",
    MRK: "42-MRK",
    LUK: "43-LUK",
    JHN: "44-JHN",
    ACT: "45-ACT",
    ROM: "46-ROM",
    "1CO": "47-1CO",
    "2CO": "48-2CO",
    GAL: "49-GAL",
    EPH: "50-EPH",
    PHP: "51-PHP",
    COL: "52-COL",
    "1TH": "53-1TH",
    "2TH": "54-2TH",
    "1TI": "55-1TI",
    "2TI": "56-2TI",
    TIT: "57-TIT",
    PHM: "58-PHM",
    HEB: "59-HEB",
    JAS: "60-JAS",
    "1PE": "61-1PE",
    "2PE": "62-2PE",
    "1JN": "63-1JN",
    "2JN": "64-2JN",
    "3JN": "65-3JN",
    JUD: "66-JUD",
    REV: "67-REV",
};
function getFileName(abbreviation: string): string {
    const bookName = bookNamestoFilename[abbreviation];
    if (bookName) {
        return bookName;
    } else {
        return "Abbreviation not found.";
    }
}
