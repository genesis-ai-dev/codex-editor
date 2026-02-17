import type { FileData } from "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";

export type CodexMigrationMatchMode =
    | "globalReferences"
    | "timestamps"
    | "sequential"
    | "lineNumber";

export interface SourceFileUIData {
    path: string;
    id: string;
    name: string;
}

export interface MigrationMatchResult {
    fromCellId: string;
    toCellId: string;
    fromSourceValue?: string;
    toSourceValue?: string;
    reason?: string;
}

export interface MigrationMatchSummary {
    matched: number;
    skipped: number;
}

export interface MigrationRunConfig {
    fromFilePath: string;
    toFilePath: string;
    matchMode: CodexMigrationMatchMode;
    forceOverride: boolean;
    /** 1-based starting line in the source file (lineNumber mode only). */
    fromStartLine?: number;
    /** 1-based starting line in the target file (lineNumber mode only). */
    toStartLine?: number;
    /** Maximum number of cells to migrate (lineNumber mode only). Omit or 0 for no limit. */
    maxCells?: number;
}

export interface MigrationFileSet {
    fromTargetFile: FileData;
    toTargetFile: FileData;
    fromSourceFile?: FileData;
    toSourceFile?: FileData;
}
