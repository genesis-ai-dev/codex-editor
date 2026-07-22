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
import { findOriginalFileByHash, loadOriginalFilesRegistry } from "./originalFileUtils";
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

export interface ExistingImportMatches {
    /**
     * "content": the exact same file bytes were imported before.
     * "fileName": a file with this name was imported before but its content
     * differs — the document was likely edited since the original import.
     */
    matchedBy: "content" | "fileName";
    pairs: ExistingImportPair[];
}

/**
 * Scan source notebooks' own metadata. This is the fallback for projects
 * whose original-files registry has no entry (imports predating the registry,
 * or a registry lost in a sync merge): source notebooks store
 * `originalFileHash` and the original file name in their metadata.
 */
const scanSourceMetadata = async (
    workspaceFolder: vscode.WorkspaceFolder,
    originalFileHash: string,
    originalFileName: string | undefined,
): Promise<{ hashBaseNames: string[]; nameBaseNames: string[] }> => {
    const hashBaseNames: string[] = [];
    const nameBaseNames: string[] = [];
    const sourceFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source"),
    );
    const decoder = new TextDecoder();
    for (const sourceUri of sourceFiles) {
        try {
            const metadata = JSON.parse(
                decoder.decode(await vscode.workspace.fs.readFile(sourceUri)),
            )?.metadata as Record<string, unknown> | undefined;
            if (!metadata) continue;
            const baseName = sourceUri.path.split("/").pop()!.replace(/\.source$/, "");
            if (metadata.originalFileHash === originalFileHash) {
                hashBaseNames.push(baseName);
            } else if (
                originalFileName &&
                (metadata.originalName === originalFileName ||
                    metadata.originalFileName === originalFileName)
            ) {
                nameBaseNames.push(baseName);
            }
        } catch {
            continue;
        }
    }
    return { hashBaseNames, nameBaseNames };
};

/**
 * Find existing, on-disk notebook pairs that came from this original file.
 *
 * Content-hash matches (registry, then source metadata) take precedence.
 * When the hash is unknown to the project, fall back to the original file
 * name — this catches re-imports of a document that was EDITED since the
 * original import, which is the common repair/update scenario.
 */
export const findExistingImportPairs = async (
    workspaceFolder: vscode.WorkspaceFolder,
    originalFileHash: string,
    originalFileName?: string,
): Promise<ExistingImportMatches | null> => {
    const resolveAll = async (baseNames: Iterable<string>): Promise<ExistingImportPair[]> => {
        const pairs: ExistingImportPair[] = [];
        const seen = new Set<string>();
        for (const baseName of baseNames) {
            if (seen.has(baseName)) continue;
            seen.add(baseName);
            const pair = await resolvePairForBaseName(workspaceFolder, baseName);
            if (pair) pairs.push(pair);
        }
        return pairs;
    };

    const { hashBaseNames, nameBaseNames } = await scanSourceMetadata(
        workspaceFolder,
        originalFileHash,
        originalFileName,
    );

    const entry = await findOriginalFileByHash(workspaceFolder, originalFileHash);
    const hashPairs = await resolveAll([...(entry?.referencedBy ?? []), ...hashBaseNames]);
    if (hashPairs.length > 0) {
        return { matchedBy: "content", pairs: hashPairs };
    }

    if (!originalFileName) return null;

    // Registry entries for other hashes that were imported under this name
    // (a changed document gets a new hash and a suffixed stored filename, but
    // keeps its requested name in `originalNames`).
    const registryNameBaseNames: string[] = [];
    try {
        const registry = await loadOriginalFilesRegistry(workspaceFolder);
        for (const [hash, registryEntry] of Object.entries(registry.files)) {
            if (hash === originalFileHash) continue;
            if (registryEntry.originalNames.includes(originalFileName)) {
                registryNameBaseNames.push(...registryEntry.referencedBy);
            }
        }
    } catch {
        // Registry unavailable; the metadata scan below still applies.
    }

    const namePairs = await resolveAll([...registryNameBaseNames, ...nameBaseNames]);
    return namePairs.length > 0 ? { matchedBy: "fileName", pairs: namePairs } : null;
};

export interface UpdateExistingImportResult {
    sourceUri: vscode.Uri;
    codexUri: vscode.Uri;
    stats: ReimportMergeStats;
    /** Directory holding pre-update copies of the pair, for manual recovery. */
    backupDir: vscode.Uri | null;
}

/**
 * Copy the pair's current bytes to a timestamped backup directory before the
 * in-place update. Lives under `.project/attachments/files/` which is
 * gitignored, so backups never pollute sync. Best-effort recovery aid only.
 */
const backupExistingPair = async (
    workspaceFolder: vscode.WorkspaceFolder,
    pair: ExistingImportPair,
): Promise<vscode.Uri | null> => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupDir = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project",
            "attachments",
            "files",
            "backups",
            "reimport",
            `${pair.notebookBaseName}-${timestamp}`,
        );
        await vscode.workspace.fs.createDirectory(backupDir);
        for (const uri of [pair.sourceUri, pair.codexUri]) {
            const fileName = uri.path.split("/").pop()!;
            await vscode.workspace.fs.copy(uri, vscode.Uri.joinPath(backupDir, fileName), {
                overwrite: true,
            });
        }
        return backupDir;
    } catch (error) {
        console.warn("[updateExistingImport] Could not back up existing pair:", error);
        return null;
    }
};

/**
 * Rebuild an existing pair from a freshly parsed pair, carrying translations
 * over, and write the result back to the existing file paths. The previous
 * files are backed up first (see backupExistingPair).
 */
export const updateExistingImportPair = async (
    workspaceFolder: vscode.WorkspaceFolder,
    pair: ExistingImportPair,
    newSource: NotebookPreview,
    newCodex: NotebookPreview,
): Promise<UpdateExistingImportResult> => {
    const backupDir = await backupExistingPair(workspaceFolder, pair);

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

    if (backupDir) {
        console.log(
            `[updateExistingImport] Pre-update backup of "${pair.notebookBaseName}" saved to ${backupDir.fsPath}`,
        );
    }

    return { sourceUri: pair.sourceUri, codexUri: pair.codexUri, stats, backupDir };
};
