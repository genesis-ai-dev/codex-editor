import type { FileData } from "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";
import type { SQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndex";
import type {
    CodexMigrationMatchMode,
    MigrationMatchResult,
} from "./types";
import { removeHtmlTags } from "../exportHandler/subtitleUtils";
import { CodexCellTypes } from "../../types/enums";
import { isContentCell } from "../utils/cellTypeUtils";

type SourceLine = {
    cellId: string;
    sourceValue: string;
};

const normalizeText = (value: string): string => {
    const withoutHtml = removeHtmlTags(value || "");
    return withoutHtml.replace(/\s+/g, " ").trim();
};

const normalizeTimestampSeconds = (value?: number): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value > 100000) return value / 1000;
    return value;
};

const getCellId = (cell: FileData["cells"][number]): string | null => {
    const cellId = cell.metadata?.id;
    return typeof cellId === "string" && cellId.trim() ? cellId.trim() : null;
};

const getGlobalReferencesKey = (cell: FileData["cells"][number]): string | null => {
    const refs = cell.metadata?.data?.globalReferences;
    if (!Array.isArray(refs) || refs.length === 0) {
        return null;
    }
    const normalized = refs.map((ref) => String(ref).trim()).filter(Boolean).sort();
    if (normalized.length === 0) return null;
    return normalized.join("|");
};

const getStartTimeSeconds = (cell: FileData["cells"][number]): number | undefined => {
    const rawStart = cell.metadata?.data?.startTime;
    const normalized = normalizeTimestampSeconds(rawStart);
    if (normalized !== undefined) return normalized;

    const cellId = getCellId(cell);
    if (!cellId) return undefined;
    const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
    if (timeMatch && timeMatch[1]) {
        return parseFloat(timeMatch[1]);
    }
    return undefined;
};

const buildSourceLinesFromFile = (file: FileData): SourceLine[] => {
    const lines: SourceLine[] = [];
    file.cells.forEach((cell) => {
        if (cell.metadata?.type === CodexCellTypes.MILESTONE) {
            return;
        }
        const cellId = getCellId(cell);
        if (!cellId) return;
        const value = typeof cell.value === "string" ? cell.value : "";
        const normalized = normalizeText(value);
        if (!normalized) return;
        lines.push({ cellId, sourceValue: normalized });
    });
    return lines;
};

const buildLineNumberCells = (file: FileData): string[] => {
    const lines: string[] = [];
    file.cells.forEach((cell) => {
        if (!isContentCell(cell)) {
            return;
        }
        const cellId = getCellId(cell);
        if (!cellId) return;
        lines.push(cellId);
    });
    return lines;
};

const buildSourceLinesFromSqlite = async (
    targetFile: FileData,
    sqliteManager: SQLiteIndexManager
): Promise<SourceLine[]> => {
    const lines: SourceLine[] = [];
    for (const cell of targetFile.cells) {
        const cellId = getCellId(cell);
        if (!cellId) continue;
        const pair = await sqliteManager.getTranslationPair(cellId);
        const sourceValue = normalizeText(pair?.sourceContent || "");
        if (!sourceValue) continue;
        lines.push({ cellId, sourceValue });
    }
    return lines;
};

const matchByGlobalReferences = (
    fromTargetFile: FileData,
    toTargetFile: FileData
): MigrationMatchResult[] => {
    const matches: MigrationMatchResult[] = [];
    const toMap = new Map<string, string>();

    toTargetFile.cells.forEach((cell) => {
        const key = getGlobalReferencesKey(cell);
        const cellId = getCellId(cell);
        if (!key || !cellId) return;
        if (!toMap.has(key)) {
            toMap.set(key, cellId);
        }
    });

    fromTargetFile.cells.forEach((cell) => {
        const key = getGlobalReferencesKey(cell);
        const fromCellId = getCellId(cell);
        if (!key || !fromCellId) return;
        const toCellId = toMap.get(key);
        if (!toCellId) return;
        matches.push({ fromCellId, toCellId });
    });

    return matches;
};

const matchByTimestamps = (
    fromTargetFile: FileData,
    toTargetFile: FileData
): MigrationMatchResult[] => {
    const matches: MigrationMatchResult[] = [];
    const toMap = new Map<number, string>();
    const toTimes: number[] = [];

    toTargetFile.cells.forEach((cell) => {
        const startTime = getStartTimeSeconds(cell);
        const cellId = getCellId(cell);
        if (startTime === undefined || !cellId) return;
        if (!toMap.has(startTime)) {
            toMap.set(startTime, cellId);
            toTimes.push(startTime);
        }
    });
    toTimes.sort((a, b) => a - b);

    const pickNearestTime = (time: number): number | undefined => {
        if (toTimes.length === 0) return undefined;
        let lo = 0;
        let hi = toTimes.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (toTimes[mid] < time) lo = mid + 1;
            else hi = mid - 1;
        }
        const candidates: number[] = [];
        if (lo < toTimes.length) candidates.push(toTimes[lo]);
        if (lo - 1 >= 0) candidates.push(toTimes[lo - 1]);
        let bestTime: number | undefined;
        let bestDiff = Number.POSITIVE_INFINITY;
        const hasMs = String(time).includes(".");
        const threshold = hasMs ? 0.3 : 0.6;
        for (const t of candidates) {
            const diff = Math.abs(t - time);
            if (diff < bestDiff && diff <= threshold) {
                bestDiff = diff;
                bestTime = t;
            }
        }
        return bestTime;
    };

    fromTargetFile.cells.forEach((cell) => {
        const startTime = getStartTimeSeconds(cell);
        const fromCellId = getCellId(cell);
        if (startTime === undefined || !fromCellId) return;
        let toCellId = toMap.get(startTime);
        if (!toCellId) {
            const nearest = pickNearestTime(startTime);
            if (nearest !== undefined) {
                toCellId = toMap.get(nearest);
            }
        }
        if (!toCellId) return;
        matches.push({ fromCellId, toCellId });
    });

    return matches;
};

const matchSequentially = async (
    fromTargetFile: FileData,
    toTargetFile: FileData,
    fromSourceFile: FileData | undefined,
    toSourceFile: FileData | undefined,
    sqliteManager?: SQLiteIndexManager | null
): Promise<MigrationMatchResult[]> => {
    let fromLines: SourceLine[] = [];
    let toLines: SourceLine[] = [];

    if (fromSourceFile && toSourceFile) {
        fromLines = buildSourceLinesFromFile(fromSourceFile);
        toLines = buildSourceLinesFromFile(toSourceFile);
    } else if (sqliteManager) {
        fromLines = await buildSourceLinesFromSqlite(fromTargetFile, sqliteManager);
        toLines = await buildSourceLinesFromSqlite(toTargetFile, sqliteManager);
    }

    if (fromLines.length === 0 || toLines.length === 0) {
        return [];
    }

    const matches: MigrationMatchResult[] = [];
    let i = 0;
    let j = 0;

    while (i < fromLines.length) {
        const fromLine = fromLines[i];
        let searchIndex = j;
        let matchedIndex: number | null = null;

        while (searchIndex < toLines.length) {
            const toLine = toLines[searchIndex];
            if (fromLine.sourceValue === toLine.sourceValue) {
                matchedIndex = searchIndex;
                break;
            }
            searchIndex += 1;
        }

        if (matchedIndex !== null) {
            const toLine = toLines[matchedIndex];
            matches.push({
                fromCellId: fromLine.cellId,
                toCellId: toLine.cellId,
                fromSourceValue: fromLine.sourceValue,
                toSourceValue: toLine.sourceValue,
            });
            j = matchedIndex + 1;
        }

        i += 1;
    }

    return matches;
};

const matchByLineNumber = (
    fromTargetFile: FileData,
    toTargetFile: FileData,
    fromStartLine: number = 1,
    toStartLine: number = 1
): MigrationMatchResult[] => {
    const fromLines = buildLineNumberCells(fromTargetFile);
    const toLines = buildLineNumberCells(toTargetFile);
    const matches: MigrationMatchResult[] = [];

    // Convert 1-based line numbers to 0-based indices (clamp to valid range)
    const fromOffset = Math.max(0, fromStartLine - 1);
    const toOffset = Math.max(0, toStartLine - 1);

    const fromRemaining = fromLines.length - fromOffset;
    const toRemaining = toLines.length - toOffset;
    const limit = Math.min(fromRemaining, toRemaining);

    for (let i = 0; i < limit; i += 1) {
        matches.push({
            fromCellId: fromLines[fromOffset + i],
            toCellId: toLines[toOffset + i],
            reason: `lineNumber (from line ${fromOffset + i + 1} → to line ${toOffset + i + 1})`,
        });
    }

    return matches;
};

export async function matchMigrationCells(params: {
    fromTargetFile: FileData;
    toTargetFile: FileData;
    fromSourceFile?: FileData;
    toSourceFile?: FileData;
    matchMode: CodexMigrationMatchMode;
    sqliteManager?: SQLiteIndexManager | null;
    fromStartLine?: number;
    toStartLine?: number;
}): Promise<MigrationMatchResult[]> {
    const {
        fromTargetFile,
        toTargetFile,
        fromSourceFile,
        toSourceFile,
        matchMode,
        sqliteManager,
        fromStartLine,
        toStartLine,
    } = params;

    if (matchMode === "globalReferences") {
        return matchByGlobalReferences(fromTargetFile, toTargetFile);
    }

    if (matchMode === "timestamps") {
        return matchByTimestamps(fromTargetFile, toTargetFile);
    }

    if (matchMode === "lineNumber") {
        return matchByLineNumber(fromTargetFile, toTargetFile, fromStartLine, toStartLine);
    }

    return matchSequentially(
        fromTargetFile,
        toTargetFile,
        fromSourceFile,
        toSourceFile,
        sqliteManager
    );
}
