import * as vscode from "vscode";
import { ConflictFile } from "./types";

export type BinaryCopy = {
    filepath: string; // always posix-style (forward slashes), relative to project root
    content: Uint8Array;
};

export type BuildConflictsFromDirectoriesOptions = {
    oursRoot: vscode.Uri;
    theirsRoot: vscode.Uri;
    /**
     * Return true to exclude a path (posix-style, relative to oursRoot).
     * Note: `.git/**` is excluded automatically regardless of this callback.
     */
    exclude?: (relativePath: string) => boolean;
    /**
     * Return true if the file should be treated as binary (copied, not merged).
     */
    isBinary?: (relativePath: string) => boolean;
};

export async function buildConflictsFromDirectories(
    options: BuildConflictsFromDirectoriesOptions
): Promise<{ textConflicts: ConflictFile[]; binaryCopies: BinaryCopy[]; }> {
    const exclude = options.exclude ?? (() => false);
    const isBinary = options.isBinary ?? (() => false);

    const textConflicts: ConflictFile[] = [];
    const binaryCopies: BinaryCopy[] = [];

    const shouldSkip = (relativePath: string): boolean => {
        const normalized = relativePath.replace(/\\/g, "/");
        if (normalized === ".git" || normalized.startsWith(".git/")) return true;
        return exclude(normalized);
    };

    const walk = async (dirUri: vscode.Uri, relativeDir: string): Promise<void> => {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
            const nextRelative = relativeDir ? `${relativeDir}/${name}` : name;
            const rel = nextRelative.replace(/\\/g, "/");

            if (shouldSkip(rel)) {
                continue;
            }

            const entryUri = vscode.Uri.joinPath(dirUri, name);
            if (type === vscode.FileType.Directory) {
                await walk(entryUri, rel);
                continue;
            }

            if (type !== vscode.FileType.File) {
                continue;
            }

            const oursBytes = await vscode.workspace.fs.readFile(entryUri);
            // Treat as binary if caller flags it OR if content looks binary (NUL byte heuristic).
            if (isBinary(rel) || oursBytes.includes(0)) {
                binaryCopies.push({ filepath: rel, content: oursBytes });
                continue;
            }

            const ours = Buffer.from(oursBytes).toString("utf8");

            const theirsUri = vscode.Uri.joinPath(options.theirsRoot, ...rel.split("/"));
            let theirs = "";
            let fileExistsInTheirs = true;
            try {
                const theirsBytes = await vscode.workspace.fs.readFile(theirsUri);
                theirs = Buffer.from(theirsBytes).toString("utf8");
            } catch {
                fileExistsInTheirs = false;
            }

            textConflicts.push({
                filepath: rel,
                ours,
                theirs,
                base: theirs, // freshly-cloned version is the base
                isNew: !fileExistsInTheirs,
                isDeleted: false,
            });
        }
    };

    await walk(options.oursRoot, "");
    return { textConflicts, binaryCopies };
}

