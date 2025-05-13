import * as vscode from "vscode";
import { WebPathUtils } from './webPathUtils';

export type FileTypeMap = {
    codex: string;
    source: string;
    dictionary: string;
    tsv: string;
};

export function getFileType(fileUri: vscode.Uri): keyof FileTypeMap | undefined {
    const extension = WebPathUtils.getExtension(fileUri);
    return extension as keyof FileTypeMap;
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
