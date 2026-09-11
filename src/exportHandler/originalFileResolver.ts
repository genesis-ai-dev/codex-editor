import { createHash } from "crypto";
import * as path from "path";
import { parsePointerContent, type LFSPointer } from "../utils/lfsPointerUtils";
import { ExportCancelledError } from "./exportDownloadUtils";

export class OriginalFileError extends Error {
    constructor(public readonly reason: "missing" | "invalid" | "download", message: string) {
        super(message);
        this.name = "OriginalFileError";
    }
}

export interface OriginalFileRequest {
    /** Alternative names, in preference order (used by legacy USFM imports). */
    fileNames: string[];
    embeddedContent?: string;
    expectedHash?: string;
}

interface ResolverOptions {
    readFile(filePath: string): Promise<Uint8Array>;
    download(projectPath: string, pointer: LFSPointer, signal?: AbortSignal): Promise<Uint8Array>;
    onDownload?(fileName: string): void;
    signal?: AbortSignal;
    cacheLimitBytes?: number;
}

interface ResolvedOriginal {
    fileName: string;
    data: Uint8Array;
}

const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * Reads imported originals without changing the project's storage policy.
 * The pointers mirror can hold FULL files, not just LFS stubs. Exhaust local
 * copies and embedded originals before downloading, regardless of media mode.
 * Downloaded bytes are verified and cached only for this export, with a bound
 * on retained memory. This class never writes to files/, pointers/, or .git/.
 */
export class OriginalFileResolver {
    private readonly cache = new Map<string, Uint8Array>();
    private readonly pending = new Map<string, Promise<Uint8Array>>();
    private cachedBytes = 0;

    constructor(private readonly options: ResolverOptions) { }

    checkCancellation(): void {
        if (this.options.signal?.aborted) throw new ExportCancelledError();
    }

    clear(): void {
        this.cache.clear();
        this.pending.clear();
        this.cachedBytes = 0;
    }

    async read(projectPath: string, request: OriginalFileRequest): Promise<ResolvedOriginal> {
        this.checkCancellation();
        const names = [...new Set(request.fileNames)];
        const expectedHash = request.expectedHash?.toLowerCase();
        let requiredHash = expectedHash;
        const problems: string[] = [];
        const pointers: Array<{ fileName: string; pointer: LFSPointer; }> = [];

        for (const fileName of names) {
            const candidates = this.candidatePaths(projectPath, fileName);
            for (const candidate of candidates) {
                const data = await this.readLocal(candidate, problems);
                if (!data) continue;
                // Only a pointer signature triggers LFS handling. A file living
                // under attachments/pointers/ is not automatically LFS content.
                const pointerText = this.pointerText(data);
                if (pointerText !== undefined) {
                    const pointer = parsePointerContent(pointerText);
                    if (!pointer || pointer.version !== "https://git-lfs.github.com/spec/v1" ||
                        !/^oid sha256:[a-f0-9]{64}\r?$/im.test(pointerText) ||
                        !/^size \d+\r?$/m.test(pointerText) ||
                        !Number.isSafeInteger(pointer.size) || pointer.size < 0) {
                        problems.push(`Invalid LFS pointer at "${candidate}".`);
                    } else if (requiredHash && pointer.oid.toLowerCase() !== requiredHash) {
                        problems.push(`Original at "${candidate}" does not match the imported document.`);
                    } else {
                        requiredHash = pointer.oid.toLowerCase();
                        pointers.push({ fileName, pointer: { ...pointer, oid: requiredHash } });
                    }
                    continue;
                }
                if (requiredHash && hash(data) !== requiredHash) {
                    problems.push(`Original at "${candidate}" does not match the imported document.`);
                    continue;
                }
                return { fileName, data };
            }
        }

        // USFM and spreadsheets may carry the complete original in notebook
        // metadata. A stub on disk must not mask that offline fallback.
        if (request.embeddedContent !== undefined) {
            const data = Buffer.from(request.embeddedContent, "utf8");
            // Embedded text may have import-time BOM/newline normalization, so
            // the raw attachment's hash does not describe this representation.
            if (this.pointerText(data) === undefined) {
                return { fileName: names[0] ?? "original", data };
            }
            problems.push("Embedded original content contains an LFS pointer instead of document text.");
        }

        for (const { fileName, pointer } of pointers) {
            // Git LFS may already have these bytes even when files/ holds a stub.
            const objectPath = path.join(projectPath, ".git", "lfs", "objects",
                pointer.oid.slice(0, 2), pointer.oid.slice(2, 4), pointer.oid);
            const localObject = await this.readLocal(objectPath, problems);
            if (localObject && this.matchesPointer(localObject, pointer)) {
                return { fileName, data: localObject };
            }
        }

        if (pointers.length > 0) {
            const { fileName, pointer } = pointers[0];
            const key = `${projectPath}:${pointer.oid}`;
            const cached = this.cache.get(key);
            if (cached && this.matchesPointer(cached, pointer)) {
                this.cache.delete(key);
                this.cache.set(key, cached);
                return { fileName, data: cached };
            }
            let download = this.pending.get(key);
            if (!download) {
                download = this.download(projectPath, fileName, pointer);
                this.pending.set(key, download);
            }
            try {
                const data = await download;
                this.checkCancellation();
                if (!this.matchesPointer(data, pointer)) {
                    throw new OriginalFileError("invalid", `Downloaded original "${fileName}" failed its size or SHA-256 check.`);
                }
                this.remember(key, data);
                return { fileName, data };
            } finally {
                this.pending.delete(key);
            }
        }

        if (problems.length) throw new OriginalFileError("invalid", problems.join(" "));
        throw new OriginalFileError("missing",
            `Original file not found (${names.join(", ") || "no original filename"}). ` +
            "Checked local originals and the sync mirror. Restore or re-import the original document.");
    }

    private candidatePaths(projectPath: string, fileName: string): string[] {
        // Metadata is project data: never let a stored name escape originals/.
        const normalized = fileName.replace(/\\/g, "/");
        if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(fileName) ||
            normalized.split("/").some(part => part === ".." || part === "." || part === "")) {
            throw new OriginalFileError("invalid", `Invalid original filename: "${fileName}".`);
        }
        return [
            path.join(projectPath, ".project", "attachments", "files", "originals", normalized),
            path.join(projectPath, ".project", "attachments", "originals", normalized),
            path.join(projectPath, ".project", "attachments", "pointers", "originals", normalized),
        ];
    }

    private async readLocal(filePath: string, problems: string[]): Promise<Uint8Array | undefined> {
        this.checkCancellation();
        try {
            const data = await this.options.readFile(filePath);
            this.checkCancellation();
            return data;
        } catch (error) {
            this.checkCancellation();
            const code = (error as { code?: string; })?.code;
            if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "FileNotFound") {
                problems.push(`Cannot read "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
            }
            return undefined;
        }
    }

    private pointerText(data: Uint8Array): string | undefined {
        const prefix = Buffer.from(data.subarray(0, 1024)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
        return prefix.startsWith("version https://git-lfs.github.com/spec/") ? prefix : undefined;
    }

    private matchesPointer(data: Uint8Array, pointer: LFSPointer): boolean {
        return data.byteLength === pointer.size && this.pointerText(data) === undefined && hash(data) === pointer.oid.toLowerCase();
    }

    private async download(projectPath: string, fileName: string, pointer: LFSPointer): Promise<Uint8Array> {
        this.checkCancellation();
        this.options.onDownload?.(fileName);
        try {
            const data = await this.options.download(projectPath, pointer, this.options.signal);
            this.checkCancellation();
            return data;
        } catch (error) {
            this.checkCancellation();
            throw new OriginalFileError("download",
                `Could not download original "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private remember(key: string, data: Uint8Array): void {
        const limit = this.options.cacheLimitBytes ?? 64 * 1024 * 1024;
        if (this.cache.has(key) || data.byteLength > limit) return;
        while (this.cachedBytes + data.byteLength > limit && this.cache.size) {
            const oldest = this.cache.keys().next().value as string;
            this.cachedBytes -= this.cache.get(oldest)!.byteLength;
            this.cache.delete(oldest);
        }
        this.cache.set(key, data);
        this.cachedBytes += data.byteLength;
    }
}
