import * as vscode from "vscode";
import { basename } from "path";
import { downloadLfsWithRetry, tokenToAbortSignal } from "./exportDownloadUtils";
import { OriginalFileResolver, type OriginalFileRequest } from "./originalFileResolver";
import type { ExportProgressReporter } from "./exportProgress";
import type { LFSPointer } from "../utils/lfsPointerUtils";

/** Network boundary, separate from resolution so local originals never need auth. */
export const originalFileDownloads = {
    async download(projectPath: string, pointer: LFSPointer, signal?: AbortSignal): Promise<Uint8Array> {
        const { getAuthApi } = await import("../extension");
        const api = getAuthApi();
        if (!api?.downloadLFSFile) {
            throw new Error("Frontier authentication is unavailable. Sign in and retry, or restore a local copy of the original.");
        }
        return downloadLfsWithRetry(api, projectPath, pointer.oid, pointer.size, signal);
    },
};

/** One resolver/cache and cancellation subscription for an entire round-trip export. */
export class RoundTripExportContext {
    private readonly cancellation;
    private readonly resolver: OriginalFileResolver;
    private currentNotebook = "";

    constructor(reporter: ExportProgressReporter, token?: vscode.CancellationToken) {
        this.cancellation = tokenToAbortSignal(token);
        this.resolver = new OriginalFileResolver({
            signal: this.cancellation.signal,
            readFile: async filePath => vscode.workspace.fs.readFile(vscode.Uri.file(filePath)),
            download: originalFileDownloads.download,
            onDownload: fileName => reporter.report({
                stage: "downloading",
                message: `Downloading original ${fileName} from LFS...`,
                file: this.currentNotebook,
            }),
        });
    }

    get signal(): AbortSignal | undefined {
        return this.cancellation.signal;
    }

    checkCancellation(): void {
        this.resolver.checkCancellation();
    }

    async readOriginal(notebook: vscode.Uri, fileNames: string | string[], options: Omit<OriginalFileRequest, "fileNames"> = {}) {
        this.checkCancellation();
        const workspace = vscode.workspace.getWorkspaceFolder(notebook) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspace) throw new Error("No project folder found. Please open a project first.");
        this.currentNotebook = basename(notebook.fsPath);
        return this.resolver.read(workspace.uri.fsPath, {
            ...options,
            fileNames: Array.isArray(fileNames) ? fileNames : [fileNames],
        });
    }

    async writeOutput(uri: vscode.Uri, data: Uint8Array): Promise<void> {
        this.checkCancellation();
        await vscode.workspace.fs.writeFile(uri, data);
        this.checkCancellation();
    }

    dispose(): void {
        this.cancellation.dispose();
        this.resolver.clear();
    }
}
