import * as vscode from "vscode";
import { FileType, FileTypeMap } from "../../types";

const fileTypeMap: FileTypeMap = {
    vtt: "subtitles",
    txt: "plaintext",
    usfm: "usfm",
    usx: "usx",
    sfm: "usfm",
    SFM: "usfm",
    USFM: "usfm",
};

export function getFileType(fileUri: vscode.Uri): FileType {
    const extension = fileUri.path.split(".").pop()?.toLowerCase() as keyof FileTypeMap;
    return fileTypeMap[extension] || "plaintext";
}
