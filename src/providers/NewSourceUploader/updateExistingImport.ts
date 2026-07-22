/**
 * "Update existing import" support.
 *
 * When the user imports an original file that is already referenced by a
 * notebook pair in this project, we can rebuild that pair from the fresh
 * parse instead of creating a duplicate pair — preserving translations, edit
 * history, comments, and audio (see reimportMerge.ts for the merge rules).
 */

import * as vscode from "vscode";
import type { CodexNotebookAsJSONData, NotebookPreview } from "../../../types";
import { findOriginalFileByHash } from "./originalFileUtils";
import { writeNotebook } from "./codexFIleCreateUtils";
import {
    mergeReimportedNotebookPair,
    type ReimportMergeStats,
    type ReimportNotebook,
} from "./reimportMerge";

export interface ExistingImportPair {
    notebookBaseName: string;
    displayName: string;
    sourceUri: vscode.Uri;
    codexUri: vscode.Uri;
}

const resolvePairForBaseName = async (
    workspaceFolder: vscode.WorkspaceFolder,
    baseName: string,
): Promise<ExistingImportPair | null> => {
    const sourceUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".project",
        "sourceTexts",
        `${baseName}.source`,
    );
    const codexUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        "files",
        "target",
        `${baseName}.codex`,
    );
    try {
        await vscode.workspace.fs.stat(sourceUri);
        await vscode.workspace.fs.stat(codexUri);
    } catch {
        return null;
    }

    let displayName = baseName;
    try {
        const content = await vscode.workspace.fs.readFile(sourceUri);
        const notebook = JSON.parse(new TextDecoder().decode(content));
        if (typeof notebook?.metadata?.fileDisplayName === "string") {
            displayName = notebook.metadata.fileDisplayName;
        }
    } catch {
        // Display name is cosmetic; fall back to the base name.
    }

    return { notebookBaseName: baseName, displayName, sourceUri, codexUri };
};

/**
 * Fallback for projects whose original-files registry has no entry for this
 * hash (imports predating the registry, or a registry lost in a sync merge):
 * source notebooks store `originalFileHash` in their metadata, so scan them.
 */
const findPairBySourceMetadataHash = async (
    workspaceFolder: vscode.WorkspaceFolder,
    originalFileHash: string,
): Promise<ExistingImportPair | null> => {
    const sourceFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source"),
    );
    const decoder = new TextDecoder();
    for (const sourceUri of sourceFiles) {
        try {
            const notebook = JSON.parse(
                decoder.decode(await vscode.workspace.fs.readFile(sourceUri)),
            );
            if (notebook?.metadata?.originalFileHash !== originalFileHash) continue;
            const baseName = sourceUri.path.split("/").pop()!.replace(/\.source$/, "");
            const pair = await resolvePairForBaseName(workspaceFolder, baseName);
            if (pair) return pair;
        } catch {
            continue;
        }
    }
    return null;
};

/**
 * Find an existing, on-disk notebook pair that references the original file
 * with the given content hash. Returns null when the file is new to the
 * project or the referencing notebooks no longer exist.
 */
export const findExistingImportPair = async (
    workspaceFolder: vscode.WorkspaceFolder,
    originalFileHash: string,
): Promise<ExistingImportPair | null> => {
    const entry = await findOriginalFileByHash(workspaceFolder, originalFileHash);
    for (const baseName of entry?.referencedBy ?? []) {
        const pair = await resolvePairForBaseName(workspaceFolder, baseName);
        if (pair) return pair;
    }

    return findPairBySourceMetadataHash(workspaceFolder, originalFileHash);
};

export interface UpdateExistingImportResult {
    sourceUri: vscode.Uri;
    codexUri: vscode.Uri;
    stats: ReimportMergeStats;
}

/**
 * Rebuild an existing pair from a freshly parsed pair, carrying translations
 * over, and write the result back to the existing file paths.
 */
export const updateExistingImportPair = async (
    pair: ExistingImportPair,
    newSource: NotebookPreview,
    newCodex: NotebookPreview,
): Promise<UpdateExistingImportResult> => {
    const decoder = new TextDecoder();
    const existingSource = JSON.parse(
        decoder.decode(await vscode.workspace.fs.readFile(pair.sourceUri)),
    ) as ReimportNotebook;
    const existingCodex = JSON.parse(
        decoder.decode(await vscode.workspace.fs.readFile(pair.codexUri)),
    ) as ReimportNotebook;

    const { mergedSource, mergedCodex, stats } = mergeReimportedNotebookPair(
        existingSource,
        existingCodex,
        newSource as unknown as ReimportNotebook,
        newCodex as unknown as ReimportNotebook,
    );

    const reimportContext = {
        timestamp: new Date().toISOString(),
        stats,
    };
    for (const merged of [mergedSource, mergedCodex]) {
        const metadata = (merged.metadata ??= {});
        metadata.importContext = {
            ...((metadata.importContext as Record<string, unknown>) ?? {}),
            lastReimport: reimportContext,
        };
    }

    await writeNotebook(pair.sourceUri, mergedSource as unknown as CodexNotebookAsJSONData);
    await writeNotebook(pair.codexUri, mergedCodex as unknown as CodexNotebookAsJSONData);

    return { sourceUri: pair.sourceUri, codexUri: pair.codexUri, stats };
};
