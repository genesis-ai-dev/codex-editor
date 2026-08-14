/**
 * Guards against unintentional `.codex`/`.source` file deletions during sync
 * (issue #1116: episodes deleted team-wide by a sync from a stale working tree).
 *
 * Intentional deletions made through the app are recorded in `metadata.json`
 * edit history as `deletedFile` / `deletedCorpusMarker` project edits. Those
 * records act as deletion tombstones:
 *
 * 1. Before sync commits local state, any tracked content file that is present
 *    in git HEAD but missing from the working tree WITHOUT a tombstone is
 *    restored from HEAD instead of being committed as a deletion.
 * 2. During conflict resolution, a delete-vs-modify conflict on a content file
 *    only resolves as "deleted" when a tombstone exists that is at least as
 *    recent as the surviving content's latest edit. Otherwise the surviving
 *    content is restored (mirroring the timestamp-based cell-level merge rules).
 */
import * as vscode from "vscode";
import * as path from "path";
import * as dugiteGit from "../../../utils/dugiteGit";

export interface DeletionTombstone {
    /** Path as recorded at deletion time (may be absolute from another machine). */
    filePath: string;
    /** Workspace-relative path, recorded by newer builds. */
    relPath?: string;
    /** When the deletion was recorded (ms epoch). */
    timestamp: number;
}

const CONTENT_FILE_RULES = [
    { prefix: "files/target/", suffix: ".codex" },
    { prefix: ".project/sourceTexts/", suffix: ".source" },
];

function normalizePath(filepath: string): string {
    return filepath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * True for translation content files whose loss is unrecoverable user data:
 * `files/target/*.codex` and `.project/sourceTexts/*.source`.
 */
export function isTrackedContentFile(filepath: string): boolean {
    const normalized = normalizePath(filepath);
    return CONTENT_FILE_RULES.some(
        (rule) => normalized.startsWith(rule.prefix) && normalized.endsWith(rule.suffix)
    );
}

/**
 * Extracts deletion tombstones from one or more metadata.json contents
 * (e.g. the local file plus both sides of a metadata.json conflict).
 * Invalid JSON or unexpected shapes contribute nothing.
 */
export function collectDeletionTombstones(
    ...metadataContents: Array<string | undefined>
): DeletionTombstone[] {
    const tombstones: DeletionTombstone[] = [];

    const pushTombstone = (value: any, timestamp: number) => {
        const filePath = value?.filePath;
        if (typeof filePath !== "string" || filePath.length === 0) return;
        const relPath = typeof value?.relPath === "string" ? value.relPath : undefined;
        tombstones.push({ filePath, relPath, timestamp });
    };

    for (const content of metadataContents) {
        if (!content) continue;
        let metadata: any;
        try {
            metadata = JSON.parse(content);
        } catch {
            continue;
        }

        const edits = Array.isArray(metadata?.edits) ? metadata.edits : [];
        for (const edit of edits) {
            const editMap = Array.isArray(edit?.editMap) ? edit.editMap : [];
            if (editMap.length !== 1) continue;
            const timestamp = typeof edit?.timestamp === "number" ? edit.timestamp : 0;

            if (editMap[0] === "deletedFile") {
                pushTombstone(edit?.value, timestamp);
            } else if (editMap[0] === "deletedCorpusMarker") {
                const deletedFiles = Array.isArray(edit?.value?.deletedFiles)
                    ? edit.value.deletedFiles
                    : [];
                for (const deletedFile of deletedFiles) {
                    pushTombstone(deletedFile, timestamp);
                }
            }
        }
    }

    return tombstones;
}

/**
 * Returns the newest tombstone timestamp covering the given workspace-relative
 * path, or undefined when no tombstone matches (i.e. no intentional deletion
 * was ever recorded for it).
 *
 * Older builds recorded absolute machine-local paths, so matching falls back
 * from exact/suffix path comparison to basename comparison. A `.source` file
 * is matched via its paired `.codex` name — the delete flow removes the pair
 * together but only records the codex path.
 */
export function findTombstoneTimestamp(
    tombstones: DeletionTombstone[],
    filepath: string
): number | undefined {
    const normalized = normalizePath(filepath);
    const baseName = path.posix.basename(normalized);
    const pairedCodexName = baseName.endsWith(".source")
        ? baseName.slice(0, -".source".length) + ".codex"
        : undefined;

    let latest: number | undefined;
    for (const tombstone of tombstones) {
        const candidates = [tombstone.filePath, tombstone.relPath].filter(
            (p): p is string => typeof p === "string" && p.length > 0
        );
        const matches = candidates.some((candidate) => {
            const recorded = normalizePath(candidate);
            if (recorded === normalized || recorded.endsWith("/" + normalized)) return true;
            const recordedBase = path.posix.basename(recorded);
            return recordedBase === baseName || recordedBase === pairedCodexName;
        });
        if (matches && (latest === undefined || tombstone.timestamp > latest)) {
            latest = tombstone.timestamp;
        }
    }
    return latest;
}

/**
 * Latest edit activity (ms epoch) embedded in a `.codex`/`.source` notebook:
 * the max over file-level and cell-level edit timestamps, including validation
 * timestamps. Returns 0 for unparseable content or content with no edits.
 */
export function getLatestContentTimestamp(content: string): number {
    let notebook: any;
    try {
        notebook = JSON.parse(content);
    } catch {
        return 0;
    }

    let latest = 0;
    const considerEdits = (edits: any) => {
        if (!Array.isArray(edits)) return;
        for (const edit of edits) {
            if (typeof edit?.timestamp === "number" && edit.timestamp > latest) {
                latest = edit.timestamp;
            }
            const validatedBy = Array.isArray(edit?.validatedBy) ? edit.validatedBy : [];
            for (const validation of validatedBy) {
                if (
                    typeof validation?.updatedTimestamp === "number" &&
                    validation.updatedTimestamp > latest
                ) {
                    latest = validation.updatedTimestamp;
                }
            }
        }
    };

    considerEdits(notebook?.metadata?.edits);
    const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
    for (const cell of cells) {
        considerEdits(cell?.metadata?.edits);
    }
    return latest;
}

/** Reads the workspace's metadata.json content, or undefined when unreadable. */
export async function readMetadataContent(workspaceDir: string): Promise<string | undefined> {
    try {
        const metadataUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), "metadata.json");
        const bytes = await vscode.workspace.fs.readFile(metadataUri);
        return new TextDecoder().decode(bytes);
    } catch {
        return undefined;
    }
}

/** Git operations the pre-sync guard needs; injectable for tests. */
export interface DeletionGuardGitOps {
    statusMatrix: (dir: string) => Promise<Array<[string, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]>>;
    readBlobAtRef: (dir: string, ref: string, filepath: string) => Promise<Buffer>;
}

/**
 * Pre-sync guard: finds tracked content files that exist in git HEAD but are
 * missing from the working tree without a deletion tombstone, and restores
 * them from HEAD so the upcoming stage-all commit cannot propagate the loss.
 *
 * Files covered by a tombstone are left deleted (intentional removals).
 * Returns the workspace-relative paths of the files it restored.
 */
export async function restoreContentFilesMissingWithoutTombstone(
    workspaceDir: string,
    gitOps: DeletionGuardGitOps = dugiteGit
): Promise<string[]> {
    const matrix = await gitOps.statusMatrix(workspaceDir);
    const missingFiles = matrix.filter(
        ([filepath, head, workdir]) =>
            head === 1 && workdir === 0 && isTrackedContentFile(filepath)
    );
    if (missingFiles.length === 0) return [];

    const tombstones = collectDeletionTombstones(await readMetadataContent(workspaceDir));

    const restored: string[] = [];
    for (const [filepath] of missingFiles) {
        if (findTombstoneTimestamp(tombstones, filepath) !== undefined) {
            continue; // Intentionally deleted through the app — let the deletion sync.
        }
        try {
            const blob = await gitOps.readBlobAtRef(workspaceDir, "HEAD", filepath);
            const target = vscode.Uri.joinPath(
                vscode.Uri.file(workspaceDir),
                ...normalizePath(filepath).split("/")
            );
            await vscode.workspace.fs.writeFile(target, blob);
            restored.push(filepath);
        } catch (error) {
            console.error(
                `[Sync] Could not restore missing tracked file ${filepath} from HEAD:`,
                error
            );
        }
    }
    return restored;
}
