# Phase 1 Implementation Spec: Foundation Learning Loop

## Goal
Get a basic learning loop working end-to-end in 1-2 weeks. Every prediction and user edit is recorded, and example selection starts using effectiveness data.

## Overview of Changes

```
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 1 ARCHITECTURE                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────┐      ┌───────────────────┐                   │
│  │ llmCompletion.ts  │─────▶│ EpisodeRecorder   │ (new)             │
│  │ (existing)        │      └───────────────────┘                   │
│  └───────────────────┘               │                              │
│           │                          ▼                              │
│           ▼               ┌───────────────────┐                     │
│  ┌───────────────────┐    │ learning.db       │ (new SQLite)        │
│  │ fetchFewShotExamples   │ - episodes        │                     │
│  │ (shared.ts)       │    │ - effectiveness   │                     │
│  │                   │◀───│ - word_mappings   │                     │
│  │ + effectiveness   │    └───────────────────┘                     │
│  │   scoring         │               ▲                              │
│  └───────────────────┘               │                              │
│                          ┌───────────────────┐                      │
│                          │ codexDocument.ts  │ (hook existing)      │
│                          │ onContentChanged  │                      │
│                          └───────────────────┘                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## New Files to Create

### 1. `src/providers/translationSuggestions/learningEngine/index.ts`

Main entry point for the learning system.

```typescript
// src/providers/translationSuggestions/learningEngine/index.ts

import { EpisodeRecorder } from './episodeRecorder';
import { EffectivenessTracker } from './effectivenessTracker';
import { PatternExtractor } from './patternExtractor';
import { LearningDatabase } from './database';

export class LearningEngine {
    private static instance: LearningEngine | null = null;

    private db: LearningDatabase;
    private episodeRecorder: EpisodeRecorder;
    private effectivenessTracker: EffectivenessTracker;
    private patternExtractor: PatternExtractor;

    private constructor(dbPath: string) {
        this.db = new LearningDatabase(dbPath);
        this.episodeRecorder = new EpisodeRecorder(this.db);
        this.effectivenessTracker = new EffectivenessTracker(this.db);
        this.patternExtractor = new PatternExtractor(this.db);
    }

    static async getInstance(workspacePath: string): Promise<LearningEngine> {
        if (!LearningEngine.instance) {
            const dbPath = path.join(workspacePath, '.codex', 'learning.db');
            LearningEngine.instance = new LearningEngine(dbPath);
            await LearningEngine.instance.db.initialize();
        }
        return LearningEngine.instance;
    }

    // Called when LLM prediction is made
    async recordPrediction(
        cellId: string,
        sourceContent: string,
        examplesUsed: Array<{cellId: string; score: number}>,
        llmOutput: string
    ): Promise<string> {
        return this.episodeRecorder.recordPrediction(
            cellId,
            sourceContent,
            examplesUsed,
            llmOutput
        );
    }

    // Called when user accepts/edits the prediction
    async recordOutcome(
        episodeId: string,
        userFinal: string,
        timeToAccept: number
    ): Promise<void> {
        const episode = await this.episodeRecorder.recordOutcome(
            episodeId,
            userFinal,
            timeToAccept
        );

        // Update effectiveness scores
        await this.effectivenessTracker.updateFromEpisode(episode);

        // Extract patterns (word mappings)
        await this.patternExtractor.extractFromEpisode(episode);
    }

    // Get effectiveness score for an example
    async getEffectiveness(cellId: string): Promise<number> {
        return this.effectivenessTracker.getScore(cellId);
    }

    // Get word mappings relevant to source content
    async getWordMappings(sourceContent: string): Promise<WordMapping[]> {
        return this.patternExtractor.getRelevantMappings(sourceContent);
    }

    // Get common corrections for prompt injection
    async getCorrections(limit: number = 10): Promise<Correction[]> {
        return this.patternExtractor.getTopCorrections(limit);
    }
}

export interface WordMapping {
    sourceWord: string;
    targetWord: string;
    count: number;
    confidence: number;
}

export interface Correction {
    llmSaid: string;
    userCorrected: string;
    count: number;
}
```

### 2. `src/providers/translationSuggestions/learningEngine/database.ts`

SQLite database wrapper with schema.

```typescript
// src/providers/translationSuggestions/learningEngine/database.ts

import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';

export class LearningDatabase {
    private db: sqlite3.Database | null = null;
    private dbPath: string;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                await this.createSchema();
                resolve();
            });
        });
    }

    private async createSchema(): Promise<void> {
        const schema = `
            -- Episode storage: every prediction attempt
            CREATE TABLE IF NOT EXISTS episodes (
                id TEXT PRIMARY KEY,
                cell_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,

                -- Context
                source_content TEXT NOT NULL,

                -- Examples used in this prediction
                examples_used TEXT NOT NULL,  -- JSON array

                -- Prediction
                llm_output TEXT NOT NULL,

                -- Outcome (filled in later)
                user_final TEXT,
                edit_distance REAL,
                outcome_quality TEXT,  -- 'perfect', 'minor_edit', 'major_edit', 'rejected'
                time_to_accept INTEGER,

                -- Status
                is_complete INTEGER DEFAULT 0
            );

            -- Example effectiveness tracking
            CREATE TABLE IF NOT EXISTS example_effectiveness (
                cell_id TEXT PRIMARY KEY,
                times_used INTEGER DEFAULT 0,
                times_led_to_perfect INTEGER DEFAULT 0,
                times_led_to_minor_edit INTEGER DEFAULT 0,
                times_led_to_major_edit INTEGER DEFAULT 0,
                total_edit_distance REAL DEFAULT 0,
                avg_edit_distance REAL DEFAULT 0.5,
                effectiveness_score REAL DEFAULT 0.5,
                last_used INTEGER
            );

            -- Word-level mappings
            CREATE TABLE IF NOT EXISTS word_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_word TEXT NOT NULL,
                target_word TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                confidence REAL DEFAULT 0,
                first_seen INTEGER,
                last_seen INTEGER,
                UNIQUE(source_word, target_word)
            );

            -- Correction patterns (LLM mistakes)
            CREATE TABLE IF NOT EXISTS corrections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                llm_said TEXT NOT NULL,
                user_corrected TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                pattern_type TEXT,  -- 'grammar', 'word_choice', 'style'
                UNIQUE(llm_said, user_corrected)
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_episodes_cell ON episodes(cell_id);
            CREATE INDEX IF NOT EXISTS idx_episodes_complete ON episodes(is_complete);
            CREATE INDEX IF NOT EXISTS idx_effectiveness_score ON example_effectiveness(effectiveness_score DESC);
            CREATE INDEX IF NOT EXISTS idx_word_mappings_source ON word_mappings(source_word);
            CREATE INDEX IF NOT EXISTS idx_corrections_count ON corrections(count DESC);
        `;

        const statements = schema.split(';').filter(s => s.trim());

        for (const stmt of statements) {
            await this.run(stmt);
        }
    }

    async run(sql: string, params: any[] = []): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db!.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            this.db!.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row as T | undefined);
            });
        });
    }

    async all<T>(sql: string, params: any[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.db!.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows as T[]);
            });
        });
    }

    async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
```

### 3. `src/providers/translationSuggestions/learningEngine/episodeRecorder.ts`

Records prediction episodes and outcomes.

```typescript
// src/providers/translationSuggestions/learningEngine/episodeRecorder.ts

import { v4 as uuidv4 } from 'uuid';
import { LearningDatabase } from './database';
import { levenshteinDistance } from './utils';

export interface Episode {
    id: string;
    cellId: string;
    timestamp: number;
    sourceContent: string;
    examplesUsed: Array<{cellId: string; score: number}>;
    llmOutput: string;
    userFinal?: string;
    editDistance?: number;
    outcomeQuality?: 'perfect' | 'minor_edit' | 'major_edit' | 'rejected';
    timeToAccept?: number;
    isComplete: boolean;
}

export class EpisodeRecorder {
    private pendingEpisodes: Map<string, Episode> = new Map();

    constructor(private db: LearningDatabase) {}

    async recordPrediction(
        cellId: string,
        sourceContent: string,
        examplesUsed: Array<{cellId: string; score: number}>,
        llmOutput: string
    ): Promise<string> {
        const id = uuidv4();
        const timestamp = Date.now();

        const episode: Episode = {
            id,
            cellId,
            timestamp,
            sourceContent,
            examplesUsed,
            llmOutput,
            isComplete: false
        };

        // Store in memory for quick access
        this.pendingEpisodes.set(id, episode);

        // Persist to database
        await this.db.run(`
            INSERT INTO episodes (id, cell_id, timestamp, source_content, examples_used, llm_output, is_complete)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [id, cellId, timestamp, sourceContent, JSON.stringify(examplesUsed), llmOutput]);

        return id;
    }

    async recordOutcome(
        episodeId: string,
        userFinal: string,
        timeToAccept: number
    ): Promise<Episode> {
        // Get episode from memory or database
        let episode = this.pendingEpisodes.get(episodeId);

        if (!episode) {
            const row = await this.db.get<any>(`
                SELECT * FROM episodes WHERE id = ?
            `, [episodeId]);

            if (!row) {
                throw new Error(`Episode not found: ${episodeId}`);
            }

            episode = {
                id: row.id,
                cellId: row.cell_id,
                timestamp: row.timestamp,
                sourceContent: row.source_content,
                examplesUsed: JSON.parse(row.examples_used),
                llmOutput: row.llm_output,
                isComplete: false
            };
        }

        // Calculate edit distance
        const editDistance = this.normalizedEditDistance(episode.llmOutput, userFinal);
        const outcomeQuality = this.classifyOutcome(editDistance);

        // Update episode
        episode.userFinal = userFinal;
        episode.editDistance = editDistance;
        episode.outcomeQuality = outcomeQuality;
        episode.timeToAccept = timeToAccept;
        episode.isComplete = true;

        // Persist to database
        await this.db.run(`
            UPDATE episodes SET
                user_final = ?,
                edit_distance = ?,
                outcome_quality = ?,
                time_to_accept = ?,
                is_complete = 1
            WHERE id = ?
        `, [userFinal, editDistance, outcomeQuality, timeToAccept, episodeId]);

        // Remove from pending
        this.pendingEpisodes.delete(episodeId);

        return episode;
    }

    private normalizedEditDistance(a: string, b: string): number {
        if (!a && !b) return 0;
        if (!a || !b) return 1;

        const distance = levenshteinDistance(a, b);
        return distance / Math.max(a.length, b.length);
    }

    private classifyOutcome(editDistance: number): 'perfect' | 'minor_edit' | 'major_edit' | 'rejected' {
        if (editDistance === 0) return 'perfect';
        if (editDistance < 0.1) return 'minor_edit';
        if (editDistance < 0.5) return 'major_edit';
        return 'rejected';
    }

    // Get pending episode for a cell (for linking user edits to predictions)
    getPendingEpisodeForCell(cellId: string): Episode | undefined {
        for (const episode of this.pendingEpisodes.values()) {
            if (episode.cellId === cellId) {
                return episode;
            }
        }
        return undefined;
    }
}
```

### 4. `src/providers/translationSuggestions/learningEngine/effectivenessTracker.ts`

Tracks which examples lead to good predictions.

```typescript
// src/providers/translationSuggestions/learningEngine/effectivenessTracker.ts

import { LearningDatabase } from './database';
import { Episode } from './episodeRecorder';

export interface EffectivenessStats {
    cellId: string;
    timesUsed: number;
    timesLedToPerfect: number;
    timesLedToMinorEdit: number;
    timesLedToMajorEdit: number;
    avgEditDistance: number;
    effectivenessScore: number;
}

export class EffectivenessTracker {
    // In-memory cache for fast lookups
    private cache: Map<string, EffectivenessStats> = new Map();

    constructor(private db: LearningDatabase) {}

    async updateFromEpisode(episode: Episode): Promise<void> {
        if (!episode.isComplete || !episode.outcomeQuality) {
            return;
        }

        for (const example of episode.examplesUsed) {
            await this.updateEffectiveness(
                example.cellId,
                episode.editDistance!,
                episode.outcomeQuality
            );
        }
    }

    private async updateEffectiveness(
        cellId: string,
        editDistance: number,
        outcomeQuality: 'perfect' | 'minor_edit' | 'major_edit' | 'rejected'
    ): Promise<void> {
        const now = Date.now();

        // Upsert with running averages
        await this.db.run(`
            INSERT INTO example_effectiveness (
                cell_id, times_used, times_led_to_perfect, times_led_to_minor_edit,
                times_led_to_major_edit, total_edit_distance, avg_edit_distance,
                effectiveness_score, last_used
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id) DO UPDATE SET
                times_used = times_used + 1,
                times_led_to_perfect = times_led_to_perfect + ?,
                times_led_to_minor_edit = times_led_to_minor_edit + ?,
                times_led_to_major_edit = times_led_to_major_edit + ?,
                total_edit_distance = total_edit_distance + ?,
                avg_edit_distance = (total_edit_distance + ?) / (times_used + 1),
                effectiveness_score = (
                    (times_led_to_perfect + ?) * 1.0 +
                    (times_led_to_minor_edit + ?) * 0.8 +
                    (times_led_to_major_edit + ?) * 0.3
                ) / (times_used + 1),
                last_used = ?
        `, [
            cellId,
            outcomeQuality === 'perfect' ? 1 : 0,
            outcomeQuality === 'minor_edit' ? 1 : 0,
            outcomeQuality === 'major_edit' ? 1 : 0,
            editDistance,
            editDistance,
            0.5,  // Initial effectiveness score
            now,
            // Update params
            outcomeQuality === 'perfect' ? 1 : 0,
            outcomeQuality === 'minor_edit' ? 1 : 0,
            outcomeQuality === 'major_edit' ? 1 : 0,
            editDistance,
            editDistance,
            outcomeQuality === 'perfect' ? 1 : 0,
            outcomeQuality === 'minor_edit' ? 1 : 0,
            outcomeQuality === 'major_edit' ? 1 : 0,
            now
        ]);

        // Invalidate cache
        this.cache.delete(cellId);
    }

    async getScore(cellId: string): Promise<number> {
        // Check cache first
        const cached = this.cache.get(cellId);
        if (cached) {
            return cached.effectivenessScore;
        }

        // Query database
        const row = await this.db.get<any>(`
            SELECT effectiveness_score FROM example_effectiveness WHERE cell_id = ?
        `, [cellId]);

        if (row) {
            return row.effectiveness_score;
        }

        // Return prior (no data yet)
        return 0.5;
    }

    async getStats(cellId: string): Promise<EffectivenessStats | null> {
        const row = await this.db.get<any>(`
            SELECT * FROM example_effectiveness WHERE cell_id = ?
        `, [cellId]);

        if (!row) return null;

        return {
            cellId: row.cell_id,
            timesUsed: row.times_used,
            timesLedToPerfect: row.times_led_to_perfect,
            timesLedToMinorEdit: row.times_led_to_minor_edit,
            timesLedToMajorEdit: row.times_led_to_major_edit,
            avgEditDistance: row.avg_edit_distance,
            effectivenessScore: row.effectiveness_score
        };
    }

    // Batch get for ranking
    async getScoresBatch(cellIds: string[]): Promise<Map<string, number>> {
        const result = new Map<string, number>();

        if (cellIds.length === 0) return result;

        const placeholders = cellIds.map(() => '?').join(',');
        const rows = await this.db.all<any>(`
            SELECT cell_id, effectiveness_score
            FROM example_effectiveness
            WHERE cell_id IN (${placeholders})
        `, cellIds);

        for (const row of rows) {
            result.set(row.cell_id, row.effectiveness_score);
        }

        // Fill in missing with prior
        for (const cellId of cellIds) {
            if (!result.has(cellId)) {
                result.set(cellId, 0.5);
            }
        }

        return result;
    }
}
```

### 5. `src/providers/translationSuggestions/learningEngine/patternExtractor.ts`

Extracts word mappings and corrections.

```typescript
// src/providers/translationSuggestions/learningEngine/patternExtractor.ts

import { LearningDatabase } from './database';
import { Episode } from './episodeRecorder';
import { tokenizeText } from '../../../utils/nlpUtils';
import { diff } from './utils';

export interface WordMapping {
    sourceWord: string;
    targetWord: string;
    count: number;
    confidence: number;
}

export interface Correction {
    llmSaid: string;
    userCorrected: string;
    count: number;
    patternType?: string;
}

export class PatternExtractor {
    constructor(private db: LearningDatabase) {}

    async extractFromEpisode(episode: Episode): Promise<void> {
        if (!episode.isComplete || !episode.userFinal) {
            return;
        }

        // Extract word mappings from source → final translation
        await this.extractWordMappings(episode.sourceContent, episode.userFinal);

        // Extract corrections if the LLM output was edited
        if (episode.outcomeQuality !== 'perfect') {
            await this.extractCorrections(episode.llmOutput, episode.userFinal);
        }
    }

    private async extractWordMappings(source: string, target: string): Promise<void> {
        const sourceTokens = tokenizeText({ method: 'whitespace_and_punctuation', text: source });
        const targetTokens = tokenizeText({ method: 'whitespace_and_punctuation', text: target });

        // Simple positional alignment (can be improved later)
        // For now, align by relative position
        const ratio = targetTokens.length / sourceTokens.length;
        const now = Date.now();

        for (let i = 0; i < sourceTokens.length; i++) {
            const sourceWord = sourceTokens[i].toLowerCase();

            // Skip very short words (likely particles)
            if (sourceWord.length < 3) continue;

            // Find corresponding target position
            const targetIdx = Math.min(Math.round(i * ratio), targetTokens.length - 1);
            const targetWord = targetTokens[targetIdx]?.toLowerCase();

            if (!targetWord || targetWord.length < 2) continue;

            // Update or insert mapping
            await this.db.run(`
                INSERT INTO word_mappings (source_word, target_word, count, first_seen, last_seen)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(source_word, target_word) DO UPDATE SET
                    count = count + 1,
                    last_seen = ?
            `, [sourceWord, targetWord, now, now, now]);
        }

        // Update confidence scores
        await this.updateConfidences();
    }

    private async updateConfidences(): Promise<void> {
        // Confidence = count for this mapping / total count for source word
        await this.db.run(`
            UPDATE word_mappings SET confidence = (
                SELECT CAST(wm.count AS REAL) / CAST(total.total AS REAL)
                FROM word_mappings wm
                JOIN (
                    SELECT source_word, SUM(count) as total
                    FROM word_mappings
                    GROUP BY source_word
                ) total ON wm.source_word = total.source_word
                WHERE wm.id = word_mappings.id
            )
        `);
    }

    private async extractCorrections(llmOutput: string, userFinal: string): Promise<void> {
        const llmTokens = tokenizeText({ method: 'whitespace_and_punctuation', text: llmOutput });
        const userTokens = tokenizeText({ method: 'whitespace_and_punctuation', text: userFinal });

        // Find token-level differences
        const differences = this.findDifferences(llmTokens, userTokens);

        for (const diff of differences) {
            if (diff.old && diff.new && diff.old !== diff.new) {
                await this.db.run(`
                    INSERT INTO corrections (llm_said, user_corrected, count)
                    VALUES (?, ?, 1)
                    ON CONFLICT(llm_said, user_corrected) DO UPDATE SET
                        count = count + 1
                `, [diff.old, diff.new]);
            }
        }
    }

    private findDifferences(a: string[], b: string[]): Array<{old: string; new: string}> {
        const result: Array<{old: string; new: string}> = [];

        // Simple diff: compare by position (can be improved with LCS)
        const maxLen = Math.max(a.length, b.length);

        for (let i = 0; i < maxLen; i++) {
            const oldToken = a[i] || '';
            const newToken = b[i] || '';

            if (oldToken !== newToken) {
                result.push({ old: oldToken, new: newToken });
            }
        }

        return result;
    }

    async getRelevantMappings(sourceContent: string): Promise<WordMapping[]> {
        const sourceTokens = tokenizeText({ method: 'whitespace_and_punctuation', text: sourceContent });
        const sourceWords = new Set(sourceTokens.map(t => t.toLowerCase()));

        if (sourceWords.size === 0) return [];

        const placeholders = Array.from(sourceWords).map(() => '?').join(',');

        const rows = await this.db.all<any>(`
            SELECT source_word, target_word, count, confidence
            FROM word_mappings
            WHERE source_word IN (${placeholders})
              AND confidence >= 0.5
              AND count >= 2
            ORDER BY confidence DESC, count DESC
        `, Array.from(sourceWords));

        return rows.map(row => ({
            sourceWord: row.source_word,
            targetWord: row.target_word,
            count: row.count,
            confidence: row.confidence
        }));
    }

    async getTopCorrections(limit: number = 10): Promise<Correction[]> {
        const rows = await this.db.all<any>(`
            SELECT llm_said, user_corrected, count, pattern_type
            FROM corrections
            WHERE count >= 2
            ORDER BY count DESC
            LIMIT ?
        `, [limit]);

        return rows.map(row => ({
            llmSaid: row.llm_said,
            userCorrected: row.user_corrected,
            count: row.count,
            patternType: row.pattern_type
        }));
    }
}
```

### 6. `src/providers/translationSuggestions/learningEngine/utils.ts`

Utility functions.

```typescript
// src/providers/translationSuggestions/learningEngine/utils.ts

/**
 * Compute Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Create matrix
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    // Initialize base cases
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill matrix
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // deletion
                    dp[i][j - 1],     // insertion
                    dp[i - 1][j - 1]  // substitution
                );
            }
        }
    }

    return dp[m][n];
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
```

---

## Files to Modify

### 1. Modify `src/providers/translationSuggestions/shared.ts`

Add effectiveness scoring to the ranking.

```typescript
// In fetchFewShotExamples function, after line 101:

// EXISTING CODE (keep):
// .sort((a, b) => {
//   if (a.overlapRatio !== b.overlapRatio) {
//     return b.overlapRatio - a.overlapRatio;
//   }
//   return b.overlapCount - a.overlapCount;
// });

// NEW CODE (add after creating rankedPairs, before sorting):

// Get effectiveness scores for all candidates
let effectivenessScores = new Map<string, number>();
try {
    const learningEngine = await LearningEngine.getInstance(workspacePath);
    const cellIds = rankedPairs.map(r => r.pair.cellId);
    effectivenessScores = await learningEngine.effectivenessTracker.getScoresBatch(cellIds);
} catch (e) {
    console.warn('[fetchFewShotExamples] Could not load effectiveness scores:', e);
}

// Enhanced ranking with effectiveness
const enhancedRankedPairs = rankedPairs.map(ranked => {
    const effectiveness = effectivenessScores.get(ranked.pair.cellId) || 0.5;

    // Combined score: 50% token overlap, 50% effectiveness
    const combinedScore = ranked.overlapRatio * 0.5 + effectiveness * 0.5;

    return {
        ...ranked,
        effectiveness,
        combinedScore
    };
}).sort((a, b) => b.combinedScore - a.combinedScore);
```

### 2. Modify `src/providers/translationSuggestions/llmCompletion.ts`

Hook episode recording.

```typescript
// Add import at top:
import { LearningEngine } from './learningEngine';

// In llmCompletion function, after fetchFewShotExamples (around line 162):

// Record prediction for learning
let episodeId: string | undefined;
try {
    const learningEngine = await LearningEngine.getInstance(workspacePath);
    episodeId = await learningEngine.recordPrediction(
        currentCellId,
        sourceContent,
        finalExamples.map(ex => ({
            cellId: ex.cellId,
            score: ex.overlapRatio || 0  // Will add combined score later
        })),
        completion  // The LLM output
    );

    // Store episode ID for later outcome recording
    // This will be passed back to the UI and returned when user accepts
    result.episodeId = episodeId;
} catch (e) {
    console.warn('[llmCompletion] Could not record episode:', e);
}

// Add word mappings and corrections to prompt
try {
    const learningEngine = await LearningEngine.getInstance(workspacePath);
    const wordMappings = await learningEngine.getWordMappings(sourceContent);
    const corrections = await learningEngine.getCorrections(10);

    if (wordMappings.length > 0 || corrections.length > 0) {
        // Inject into system message or few-shot section
        let learnedPatterns = '';

        if (wordMappings.length > 0) {
            learnedPatterns += '\n\n## Consistent Word Choices (from this project)\n';
            for (const m of wordMappings.slice(0, 15)) {
                learnedPatterns += `- "${m.sourceWord}" → "${m.targetWord}" (used ${m.count} times)\n`;
            }
        }

        if (corrections.length > 0) {
            learnedPatterns += '\n\n## Common Mistakes to Avoid\n';
            for (const c of corrections.slice(0, 10)) {
                learnedPatterns += `- Don't say "${c.llmSaid}", use "${c.userCorrected}" instead\n`;
            }
        }

        // Add to system message
        systemMessage += learnedPatterns;
    }
} catch (e) {
    console.warn('[llmCompletion] Could not inject learned patterns:', e);
}
```

### 3. Modify `src/providers/codexCellEditorProvider/codexDocument.ts`

Hook outcome recording when user accepts/edits.

```typescript
// In the content change handler (or wherever user edits are processed):

// When user accepts or edits the LLM prediction:
async function onCellContentChanged(
    cellId: string,
    newContent: string,
    metadata: { episodeId?: string; predictionTime?: number }
) {
    if (metadata.episodeId) {
        try {
            const learningEngine = await LearningEngine.getInstance(workspacePath);
            const timeToAccept = Date.now() - (metadata.predictionTime || Date.now());

            await learningEngine.recordOutcome(
                metadata.episodeId,
                newContent,
                timeToAccept
            );

            console.log(`[Learning] Recorded outcome for episode ${metadata.episodeId}`);
        } catch (e) {
            console.warn('[Learning] Could not record outcome:', e);
        }
    }
}
```

---

## Integration Points

### 1. Extension Activation

Add to `src/extension.ts`:

```typescript
// Initialize learning engine when extension activates
import { LearningEngine } from './providers/translationSuggestions/learningEngine';

export async function activate(context: vscode.ExtensionContext) {
    // ... existing code ...

    // Initialize learning engine
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        try {
            await LearningEngine.getInstance(workspaceFolders[0].uri.fsPath);
            console.log('[Learning] Learning engine initialized');
        } catch (e) {
            console.warn('[Learning] Could not initialize learning engine:', e);
        }
    }
}
```

### 2. Package.json Dependencies

Add SQLite dependency:

```json
{
  "dependencies": {
    "sqlite3": "^5.1.6",
    "uuid": "^9.0.0"
  }
}
```

---

## Testing Plan

### Unit Tests

1. **EpisodeRecorder**
   - Record prediction → verify stored
   - Record outcome → verify edit distance calculation
   - Outcome classification thresholds

2. **EffectivenessTracker**
   - Update from episode → verify score calculation
   - Batch retrieval performance
   - Cache behavior

3. **PatternExtractor**
   - Word mapping extraction
   - Correction detection
   - Confidence calculation

### Integration Tests

1. **End-to-end flow**
   - Generate prediction → edit → verify learning
   - Multiple predictions → verify ranking changes

2. **Performance**
   - 1000 episodes → ranking latency < 50ms
   - Database size < 10MB for typical project

---

## Success Metrics

After Phase 1, measure:

1. **Episode Recording Rate**: 100% of predictions recorded
2. **Outcome Recording Rate**: 95%+ of edits linked to episodes
3. **Ranking Latency**: < 100ms with effectiveness scoring
4. **Early Signal**: Edit distance should decrease after 50+ verses

---

## Timeline

| Day | Task |
|-----|------|
| 1 | Create database schema and LearningDatabase class |
| 2 | Implement EpisodeRecorder |
| 3 | Implement EffectivenessTracker |
| 4 | Implement PatternExtractor |
| 5 | Integrate with shared.ts (enhanced ranking) |
| 6 | Integrate with llmCompletion.ts (episode recording) |
| 7 | Integrate with codexDocument.ts (outcome recording) |
| 8 | Integrate pattern injection into prompts |
| 9 | Write unit tests |
| 10 | Integration testing and bug fixes |

---

## Next Phase Preview

After Phase 1 is stable, Phase 2 will add:
- Source embeddings (Strong's-based or multilingual)
- HNSW index for semantic search
- MMR for diversity
- More sophisticated word alignment

But Phase 1 alone will provide measurable improvement in prediction quality.
