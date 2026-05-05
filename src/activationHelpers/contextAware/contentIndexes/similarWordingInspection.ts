import {
    SimilarWordingChunk,
    SimilarWordingInspectionResult,
    SimilarWordingOccurrence,
} from "../../../../types";
import { SQLiteIndexManager } from "./indexes/sqliteIndex";
import {
    ContextBranchingSearchAlgorithm,
    SBSBranchMatch,
} from "./searchAlgorithms/contextBranchingSearch";

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;
const DEFAULT_MIN_TOKENS = 3;
const DEFAULT_MAX_CHUNKS = 16;
const DEFAULT_MAX_OCCURRENCES_PER_CHUNK = 6;

interface TokenPosition {
    token: string;
    start: number;
    end: number;
}

interface ChunkAccumulator {
    text: string;
    startOffset: number;
    endOffset: number;
    tokenCount: number;
    occurrences: SimilarWordingOccurrence[];
    occurrenceCellIds: Set<string>;
}

function stripHtmlToPlain(html: string): string {
    return (html || "")
        .replace(/<[^>]*?>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#34;/g, "'")
        .replace(/&#\d+;/g, " ")
        .replace(/&[a-zA-Z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenPositions(text: string): TokenPosition[] {
    const positions: TokenPosition[] = [];
    const normalized = text.toLowerCase();
    let match: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(normalized)) !== null) {
        positions.push({
            token: match[0],
            start: match.index,
            end: match.index + match[0].length,
        });
    }
    return positions;
}

function tokens(text: string): string[] {
    return tokenPositions(text).map((position) => position.token);
}

function locateTokenSequence(
    plainText: string,
    sequenceText: string
): { start: number; end: number; tokenCount: number; normalizedKey: string; } | null {
    const sequenceTokens = tokens(sequenceText);
    if (sequenceTokens.length === 0) return null;

    const positions = tokenPositions(plainText);
    for (let i = 0; i + sequenceTokens.length <= positions.length; i++) {
        let matched = true;
        for (let j = 0; j < sequenceTokens.length; j++) {
            if (positions[i + j].token !== sequenceTokens[j]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return {
                start: positions[i].start,
                end: positions[i + sequenceTokens.length - 1].end,
                tokenCount: sequenceTokens.length,
                normalizedKey: sequenceTokens.join(" "),
            };
        }
    }

    return null;
}

function snippet(content: string): string {
    const plain = stripHtmlToPlain(content);
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
}

function rangesOverlap(
    a: { startOffset: number; endOffset: number; },
    b: { startOffset: number; endOffset: number; }
): boolean {
    return a.startOffset < b.endOffset && a.endOffset > b.startOffset;
}

async function buildOccurrence(
    indexManager: SQLiteIndexManager,
    match: SBSBranchMatch
): Promise<SimilarWordingOccurrence> {
    const cellDetails = await indexManager.getById(match.pair.cellId).catch(() => null);
    return {
        cellId: match.pair.cellId,
        cellLabel: match.pair.cellLabel,
        sourceSnippet: snippet(match.pair.sourceCell.content || ""),
        targetSnippet: snippet(match.pair.targetCell.content || ""),
        uri: match.pair.targetCell.uri || match.pair.sourceCell.uri,
        line: match.pair.targetCell.line ?? match.pair.sourceCell.line,
        score: match.score,
        isValidated: cellDetails?.target_metadata?.isFullyValidated,
    };
}

function selectNonOverlappingChunks(chunks: ChunkAccumulator[], maxChunks: number): SimilarWordingChunk[] {
    const selected: ChunkAccumulator[] = [];
    const byStrength = [...chunks].sort((a, b) => {
        if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
        return b.occurrences.length - a.occurrences.length;
    });

    for (const chunk of byStrength) {
        if (selected.some((existing) => rangesOverlap(existing, chunk))) continue;
        selected.push(chunk);
        if (selected.length >= maxChunks) break;
    }

    return selected
        .sort((a, b) => a.startOffset - b.startOffset)
        .map((chunk) => ({
            text: chunk.text,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            tokenCount: chunk.tokenCount,
            occurrences: chunk.occurrences,
        }));
}

export async function inspectSimilarWording(
    indexManager: SQLiteIndexManager,
    args: {
        cellId: string;
        targetContent: string;
        minTokens?: number;
        maxChunks?: number;
        maxOccurrencesPerChunk?: number;
    }
): Promise<SimilarWordingInspectionResult> {
    const minTokens = Math.max(2, args.minTokens ?? DEFAULT_MIN_TOKENS);
    const maxChunks = Math.max(1, args.maxChunks ?? DEFAULT_MAX_CHUNKS);
    const maxOccurrencesPerChunk = Math.max(
        1,
        args.maxOccurrencesPerChunk ?? DEFAULT_MAX_OCCURRENCES_PER_CHUNK
    );
    const plainText = stripHtmlToPlain(args.targetContent);

    if (!plainText || tokens(plainText).length < minTokens) {
        return { cellId: args.cellId, plainText, chunks: [] };
    }

    const search = new ContextBranchingSearchAlgorithm(indexManager);
    const { results } = await search.searchWithBranchMatches(plainText, {
        limit: maxChunks * maxOccurrencesPerChunk,
        onlyValidated: false,
        returnRawContent: false,
        searchScope: "target",
        excludeCellIds: [args.cellId],
    });

    const chunkMap = new Map<string, ChunkAccumulator>();
    for (const result of results) {
        const coveredText = result.coveredText.trim();
        const located = locateTokenSequence(plainText, coveredText);
        if (!located || located.tokenCount < minTokens) continue;

        const key = located.normalizedKey;
        const text = plainText.slice(located.start, located.end);
        let chunk = chunkMap.get(key);
        if (!chunk) {
            chunk = {
                text,
                startOffset: located.start,
                endOffset: located.end,
                tokenCount: located.tokenCount,
                occurrences: [],
                occurrenceCellIds: new Set<string>(),
            };
            chunkMap.set(key, chunk);
        }

        if (
            chunk.occurrenceCellIds.has(result.pair.cellId) ||
            chunk.occurrences.length >= maxOccurrencesPerChunk
        ) {
            continue;
        }

        chunk.occurrenceCellIds.add(result.pair.cellId);
        chunk.occurrences.push(await buildOccurrence(indexManager, result));
    }

    return {
        cellId: args.cellId,
        plainText,
        chunks: selectNonOverlappingChunks([...chunkMap.values()], maxChunks),
    };
}
