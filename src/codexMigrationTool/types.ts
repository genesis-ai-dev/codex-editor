import type { FileData } from "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";

export type CodexMigrationMatchMode = "globalReferences" | "timestamps" | "sequential";

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
}

export interface MigrationFileSet {
    fromTargetFile: FileData;
    toTargetFile: FileData;
    fromSourceFile?: FileData;
    toSourceFile?: FileData;
}
