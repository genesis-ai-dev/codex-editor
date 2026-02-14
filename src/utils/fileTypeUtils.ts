import * as vscode from "vscode";
import { WebPathUtils } from './webPathUtils';
import { FileType } from '../../types';

export type FileTypeMap = {
    codex: string;
    source: string;
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

export function isTsvFile(fileUri: vscode.Uri): boolean {
    return WebPathUtils.hasExtension(fileUri, 'tsv');
}

/**
 * Flexible version that accepts both vscode.Uri and string
 * Checks if the URI/path represents a codex file
 */
export function isCodexFileFlexible(uri: vscode.Uri | string): boolean {
    const path = typeof uri === "string" ? uri : uri.path;
    return path.toLowerCase().endsWith(".codex");
}

/**
 * Flexible version that accepts both vscode.Uri and string
 * Checks if the URI/path represents a source file
 */
export function isSourceFileFlexible(uri: vscode.Uri | string): boolean {
    const path = typeof uri === "string" ? uri : uri.path;
    return path.toLowerCase().endsWith(".source");
}

/**
 * Checks if two URIs represent a matching file pair (same base name, different extensions)
 * Useful for matching source.codex and source.source files
 */
export function isMatchingFilePair(
    currentUri: vscode.Uri | string,
    otherUri: vscode.Uri | string
): boolean {
    const currentPath = typeof currentUri === "string" ? currentUri : currentUri.path;
    const otherPath = typeof otherUri === "string" ? otherUri : otherUri.path;
    // Remove extensions before comparing
    const currentPathWithoutExt = currentPath.toLowerCase().replace(/\.[^/.]+$/, '');
    const otherPathWithoutExt = otherPath.toLowerCase().replace(/\.[^/.]+$/, '');
    return currentPathWithoutExt === otherPathWithoutExt;
}
