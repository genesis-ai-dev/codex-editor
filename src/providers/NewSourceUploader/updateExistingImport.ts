/**
 * "Update existing import" support.
 *
 * When the user imports an original file that is already referenced by a
 * notebook pair in this project, we can rebuild that pair from the fresh
 * parse instead of creating a duplicate pair — preserving translations, edit
 * history, comments, and audio (see reimportMerge.ts for the merge rules).
 */

import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { CodexNotebookAsJSONData, NotebookPreview } from "../../../types";
import { findOriginalFileByHash, loadOriginalFilesRegistry } from "./originalFileUtils";
import {
    collectExistingDisplayNames,
    getUniqueDisplayName,
    writeNotebook,
} from "./codexFIleCreateUtils";
import { createStandardizedFilename } from "../../utils/bookNameUtils";
import { isDocxFormattingContext } from "../../../sharedUtils/docxHtmlFormatting";
import {
    mergeReimportedNotebookPair,
    type ReimportCellChange,
    type ReimportMergeResult,
    type ReimportMergeStats,
    type ReimportNotebook,
} from "./reimportMerge";

export interface ExistingImportPair {
    notebookBaseName: string;
    displayName: string;
    sourceUri: vscode.Uri;
    codexUri: vscode.Uri;
    /** Target cells that already have a translation. Used to rank duplicates. */
    translationCount: number;
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

    const readDisplayName = async (uri: vscode.Uri): Promise<string | undefined> => {
        try {
            const notebook = JSON.parse(
                new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
            );
            const name = notebook?.metadata?.fileDisplayName;
            return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
        } catch {
            return undefined;
        }
    };

    // Navigation shows the display name from either side of the pair; prefer
    // the source, then the target, so names like "GEN-DEU (Biblica)" and
    // "NEW GEN-DEU" are what the user picks from.
    const displayName =
        (await readDisplayName(sourceUri)) ?? (await readDisplayName(codexUri)) ?? baseName;

    return { notebookBaseName: baseName, displayName, sourceUri, codexUri, translationCount: 0 };
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
    await Promise.all(
        sourceFiles.map(async (sourceUri) => {
            try {
                const metadata = JSON.parse(
                    decoder.decode(await vscode.workspace.fs.readFile(sourceUri)),
                )?.metadata as Record<string, unknown> | undefined;
                if (!metadata) return;
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
                // Unreadable notebook; skip.
            }
        }),
    );
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

    // Collect every pair that came from this original file. The registry is
    // the fast path, but a Biblica project can have duplicate imports that
    // never made it into `referencedBy` (older imports, "import as new",
    // a previous updated copy). The metadata scan finds those so the user
    // can pick "GEN-DEU (Biblica)" vs "NEW GEN-DEU" by display name.
    const entry = await findOriginalFileByHash(workspaceFolder, originalFileHash);
    const registryNameBaseNames: string[] = [];
    if (originalFileName) {
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
    }

    const { hashBaseNames, nameBaseNames } = await scanSourceMetadata(
        workspaceFolder,
        originalFileHash,
        originalFileName,
    );
    const hashPairs = await resolveAll([...(entry?.referencedBy ?? []), ...hashBaseNames]);
    if (hashPairs.length > 0) {
        return { matchedBy: "content", pairs: await preferPairWithMostTranslations(hashPairs) };
    }

    const namePairs = await resolveAll([...registryNameBaseNames, ...nameBaseNames]);
    return namePairs.length > 0
        ? { matchedBy: "fileName", pairs: await preferPairWithMostTranslations(namePairs) }
        : null;
};

/**
 * When the same original file produced several pairs (a previous blank
 * "updated" copy sitting next to the real translated one), default to the
 * pair that actually has translations.
 */
const preferPairWithMostTranslations = async (
    pairs: ExistingImportPair[],
): Promise<ExistingImportPair[]> => {
    const scored = await Promise.all(
        pairs.map(async (pair) => {
            try {
                const notebook = await readNotebook(pair.codexUri);
                const translationCount = (notebook.cells ?? []).filter(
                    (cell) => typeof cell.value === "string" && cell.value.trim() !== "",
                ).length;
                return { ...pair, translationCount };
            } catch {
                return pair;
            }
        }),
    );
    scored.sort((a, b) => b.translationCount - a.translationCount || a.displayName.localeCompare(b.displayName));
    return scored;
};

export interface UpdateExistingImportResult {
    sourceUri: vscode.Uri;
    codexUri: vscode.Uri;
    stats: ReimportMergeStats;
    cancelled?: boolean;
}

/**
 * What the user chose to do with a re-imported file.
 *
 * - `new`: ignore the existing pair and create a separate, untranslated pair.
 * - `overwrite`: rebuild the existing pair in place.
 * - `copy`: leave the existing pair untouched and write the rebuilt result to
 *   a new pair that carries the existing translations.
 */
export type ReimportMode = "new" | "overwrite" | "copy";

const readNotebook = async (uri: vscode.Uri): Promise<ReimportNotebook> =>
    JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as ReimportNotebook;

/**
 * Run the merge without writing anything, to show the user what an update
 * would do before they commit to it.
 *
 * The merge mutates its inputs (it re-parents fresh cells onto old ids), so
 * everything is cloned first — the caller's previews must stay pristine for
 * the real run.
 */
export const previewExistingImportUpdate = async (
    pair: ExistingImportPair,
    newSource: NotebookPreview,
    newCodex: NotebookPreview,
): Promise<{ stats: ReimportMergeStats; changes: ReimportCellChange[]; }> => {
    const { stats, changes } = mergeReimportedNotebookPair(
        await readNotebook(pair.sourceUri),
        await readNotebook(pair.codexUri),
        structuredClone(newSource) as unknown as ReimportNotebook,
        structuredClone(newCodex) as unknown as ReimportNotebook,
    );
    return { stats, changes };
};

/**
 * Rebase a merged pair onto a brand-new notebook identity so it can be written
 * alongside the pair it was derived from.
 *
 * `mergeNotebookMetadata` deliberately preserves the existing pair's identity
 * fields (id, display name, file paths) because the normal update writes back
 * over the same files. A copy has to replace all four, or it would claim the
 * original's identity and the project would end up with two notebooks fighting
 * over the same paths.
 */
const rebaseMergedPairAsCopy = async (
    workspaceFolder: vscode.WorkspaceFolder,
    pair: ExistingImportPair,
    merged: ReimportMergeResult,
    sourceName: string,
): Promise<{ sourceUri: vscode.Uri; codexUri: vscode.Uri; displayName: string; }> => {
    const notebookId = randomUUID();
    const displayName = getUniqueDisplayName(
        `${pair.displayName} (updated)`,
        await collectExistingDisplayNames(workspaceFolder),
    );

    // Biblica is not a "biblical importer type" (it keeps document filenames
    // rather than book codes), so the pair is named by id like other documents.
    const baseName = `${sourceName}-(${notebookId})`;
    const sourceUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".project",
        "sourceTexts",
        await createStandardizedFilename(baseName, ".source", false),
    );
    const codexUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        "files",
        "target",
        await createStandardizedFilename(baseName, ".codex", false),
    );

    for (const notebook of [merged.mergedSource, merged.mergedCodex]) {
        const metadata = (notebook.metadata ??= {});
        metadata.id = notebookId;
        metadata.fileDisplayName = displayName;
        metadata.sourceFsPath = sourceUri.fsPath;
        metadata.codexFsPath = codexUri.fsPath;
    }

    return { sourceUri, codexUri, displayName };
};

/**
 * Rebuild an existing pair from a freshly parsed pair, carrying translations
 * over.
 *
 * In `overwrite` mode the result is written back over the existing files. No
 * on-disk backup is made: any `.codex`/`.source` copy inside the workspace
 * would be picked up by the `**\/*.codex` scans (export lists, migrations,
 * indexing) and show up as a duplicate document. Recovery is covered by the
 * merge itself being non-destructive — removed cells are soft-deleted
 * tombstones that retain their content and edit history in the same file.
 *
 * In `copy` mode the existing pair is left exactly as it is and the result is
 * written to a new pair under its own identity, which is the safe option when
 * an update flags a lot of cells for re-resolution.
 */
export const updateExistingImportPair = async (
    pair: ExistingImportPair,
    newSource: NotebookPreview,
    newCodex: NotebookPreview,
    mode: Extract<ReimportMode, "overwrite" | "copy"> = "overwrite",
): Promise<UpdateExistingImportResult> => {
    const existingSource = await readNotebook(pair.sourceUri);
    const existingCodex = await readNotebook(pair.codexUri);

    const merged = mergeReimportedNotebookPair(
        existingSource,
        existingCodex,
        newSource as unknown as ReimportNotebook,
        newCodex as unknown as ReimportNotebook,
    );
    const { mergedSource, mergedCodex, stats } = merged;

    // A different sentence split cannot safely split an existing translation.
    // Keep this guard DOCX-specific; other importers retain their current flow.
    // A copy leaves the original pair intact, so there is nothing to lose and
    // nothing to warn about.
    if (mode === "overwrite" && isDocxFormattingContext(existingSource.metadata) && stats.droppedTranslations > 0) {
        const choice = await vscode.window.showWarningMessage(
            `Updating "${pair.displayName}" would hide ${stats.droppedTranslations} translated cell(s) whose source segments could not be matched.`,
            {
                modal: true,
                detail: "This can happen when the original text or sentence segmentation changes. " +
                    "Cancel to keep both notebooks unchanged. If you continue, unmatched translations " +
                    "remain in deleted cells with their history, but will not be used in exports.",
            },
            "Update Anyway",
        );
        if (choice !== "Update Anyway") {
            return { sourceUri: pair.sourceUri, codexUri: pair.codexUri, stats, cancelled: true };
        }
    }

    const reimportContext: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        stats,
    };
    if (mode === "copy") {
        // Provenance: which pair this copy was derived from, so a later
        // re-import can tell the two apart.
        reimportContext.copiedFrom = pair.notebookBaseName;
    }
    for (const notebook of [mergedSource, mergedCodex]) {
        const metadata = (notebook.metadata ??= {});
        metadata.importContext = {
            ...((metadata.importContext as Record<string, unknown>) ?? {}),
            lastReimport: reimportContext,
        };
    }

    let { sourceUri, codexUri } = pair;
    if (mode === "copy") {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(pair.sourceUri);
        if (!workspaceFolder) {
            throw new Error("Cannot create an updated copy outside a workspace folder");
        }
        const rebased = await rebaseMergedPairAsCopy(
            workspaceFolder,
            pair,
            merged,
            newSource.name,
        );
        sourceUri = rebased.sourceUri;
        codexUri = rebased.codexUri;
    }

    await writeNotebook(sourceUri, mergedSource as unknown as CodexNotebookAsJSONData);
    await writeNotebook(codexUri, mergedCodex as unknown as CodexNotebookAsJSONData);

    return { sourceUri, codexUri, stats };
};
