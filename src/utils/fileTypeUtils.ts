import * as vscode from "vscode";
import { WebPathUtils } from './webPathUtils';
import { FileType } from '../../types';

export type FileTypeMap = {
    codex: string;
    source: string;
    dictionary: string;
    tsv: string;
};

export function getFileType(fileUri: vscode.Uri): FileType | undefined {
    const extension = WebPathUtils.getExtension(fileUri);
    switch (extension) {
        case "usfm":
        case "sfm":
        case "SFM":
        case "USFM":
            return "usfm";
        case "usx":
            return "usx";
        case "vtt":
            return "subtitles";
        case "txt":
            return "plaintext";
        case "codex":
            return "codex";
        case "csv":
            return "csv";
        case "tsv":
            return "tsv";
        default:
            return undefined;
    }
}

export function isCodexFile(fileUri: vscode.Uri): boolean {
    return WebPathUtils.hasExtension(fileUri, 'codex');
}

export function isSourceFile(fileUri: vscode.Uri): boolean {
    return WebPathUtils.hasExtension(fileUri, 'source');
}

export function isDictionaryFile(fileUri: vscode.Uri): boolean {
    return WebPathUtils.hasExtension(fileUri, 'dictionary');
}

export function isTsvFile(fileUri: vscode.Uri): boolean {
    return WebPathUtils.hasExtension(fileUri, 'tsv');
}
