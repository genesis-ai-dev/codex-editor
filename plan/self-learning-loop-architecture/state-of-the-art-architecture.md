# State-of-the-Art Self-Learning Architecture for Codex

## Mission

Every edit a translator makes should make the system smarter. After 1000 verses, the system should predict with 90%+ accuracy. After one book, it should feel like the AI "knows" this language.

## The Unique Opportunity

Bible translation has properties that make it *better* suited for learning than general AI tasks:

1. **Fixed Source Corpus**: ~31,000 verses, fully known, deeply annotated
2. **Rich Source Annotations**: Strong's numbers, morphology, syntax trees, cross-references
3. **Consistent Domain**: Same vocabulary, theological concepts, literary patterns
4. **Parallel Translations**: 100+ existing translations to learn patterns from
5. **Sequential Workflow**: Translators work verse-by-verse, providing continuous signal
6. **High-Stakes Feedback**: Every edit is meaningful - translators don't change things casually

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CODEX LEARNING ENGINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │   SOURCE     │    │   EPISODE    │    │   PATTERN    │    │  PROMPT   │ │
│  │   SEMANTIC   │───▶│   MEMORY     │───▶│   ENGINE     │───▶│  COMPOSER │ │
│  │   INDEX      │    │   SYSTEM     │    │              │    │           │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └───────────┘ │
│         │                   │                   │                   │       │
│         ▼                   ▼                   ▼                   ▼       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      ADAPTIVE RANKER                                  │  │
│  │  (Combines all signals with learned weights + EWC consolidation)      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      LLM PREDICTION                                   │  │
│  │  (Enhanced prompt with patterns, examples, constraints)               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      FEEDBACK LOOP                                    │  │
│  │  (Records outcome, updates all systems, triggers consolidation)       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Source Semantic Index

### Purpose
Find semantically similar source verses even when they share no words.

### Why This Works
We can't embed the unknown target language, but we CAN embed:
- Source text (Greek/Hebrew/English)
- Strong's numbers (standardized lexicon entries)
- Morphological patterns
- Syntactic structures

### Implementation

```typescript
interface SourceSemanticIndex {
  // Core embedding storage
  embeddings: Map<string, Float32Array>;  // cellId → embedding

  // HNSW index for fast approximate nearest neighbor
  hnswIndex: HNSWIndex;

  // Strong's number embeddings (pre-computed)
  strongsEmbeddings: Map<string, Float32Array>;  // H1234 → embedding

  // Methods
  indexVerse(cellId: string, sourceContent: string, strongsNumbers: string[]): void;
  findSimilar(query: string, k: number): SimilarVerse[];
  findSimilarByStrongs(strongsNumbers: string[], k: number): SimilarVerse[];
}

interface SimilarVerse {
  cellId: string;
  semanticScore: number;      // Embedding similarity
  strongsOverlap: number;     // Shared Strong's numbers
  morphologicalScore: number; // Similar grammatical structure
  combinedScore: number;      // Weighted combination
}
```

### Embedding Strategy

**Option A: Multilingual Sentence Embeddings**
```typescript
// Use existing multilingual model (works for Greek, Hebrew, English)
const embedding = await embedder.embed(sourceText);
```

**Option B: Strong's-Based Embeddings (Novel Approach)**
```typescript
// Each verse becomes a bag of Strong's embeddings
function computeStrongsEmbedding(strongsNumbers: string[]): Float32Array {
  const embeddings = strongsNumbers.map(s => strongsEmbeddings.get(s));
  // Weighted average with IDF weighting (rare words matter more)
  return weightedAverage(embeddings, idfWeights);
}
```

**Option C: Hybrid (Recommended)**
```typescript
function computeHybridEmbedding(
  sourceText: string,
  strongsNumbers: string[],
  morphology: MorphologicalAnnotation[]
): Float32Array {
  const textEmb = textEmbedder.embed(sourceText);           // 384 dims
  const strongsEmb = computeStrongsEmbedding(strongsNumbers); // 128 dims
  const morphEmb = encodeMorphology(morphology);              // 64 dims

  return concatenate(textEmb, strongsEmb, morphEmb);  // 576 dims
}
```

### HNSW Configuration (from RuVector)
```typescript
const hnswConfig = {
  m: 16,                    // Connections per node
  efConstruction: 200,      // Build-time quality
  efSearch: 50,             // Query-time quality
  metric: 'cosine',
  maxElements: 50000        // ~31k verses + headroom
};
```

### MMR for Diversity (from RuVector)
```typescript
function selectDiverseExamples(
  similar: SimilarVerse[],
  k: number,
  lambda: number = 0.7  // Balance relevance vs diversity
): SimilarVerse[] {
  const selected: SimilarVerse[] = [];
  const candidates = [...similar];

  while (selected.length < k && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const relevance = candidates[i].combinedScore;
      const diversity = selected.length === 0 ? 1 :
        Math.min(...selected.map(s =>
          1 - cosineSimilarity(
            embeddings.get(s.cellId)!,
            embeddings.get(candidates[i].cellId)!
          )
        ));

      const mmrScore = lambda * relevance + (1 - lambda) * diversity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(candidates[bestIdx]);
    candidates.splice(bestIdx, 1);
  }

  return selected;
}
```

---

## Component 2: Episode Memory System

### Purpose
Record every prediction attempt with full context, enabling learning from outcomes.

### Inspired By
- AgentDB's ReflexionMemory
- RuVector's experience replay buffer

### Schema

```sql
-- Core episode storage
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,

  -- Context
  source_content TEXT NOT NULL,
  source_embedding BLOB,           -- Cached embedding
  strongs_numbers TEXT,            -- JSON array

  -- Examples used
  examples_used TEXT NOT NULL,     -- JSON array of {cellId, score, source, target}
  example_selection_method TEXT,   -- 'semantic', 'token', 'hybrid'

  -- Prediction
  llm_model TEXT,
  llm_prompt_hash TEXT,            -- For prompt ablation studies
  llm_output TEXT NOT NULL,
  llm_confidence REAL,             -- If available from model

  -- Outcome
  user_final TEXT,                 -- What user accepted/edited to
  edit_distance REAL,              -- Normalized 0-1
  edit_operations TEXT,            -- JSON array of specific edits
  time_to_accept INTEGER,          -- Milliseconds (proxy for confidence)

  -- Learning signals
  outcome_quality TEXT,            -- 'perfect', 'minor_edit', 'major_edit', 'rejected'

  FOREIGN KEY (cell_id) REFERENCES cells(id)
);

-- Example effectiveness (aggregated view)
CREATE TABLE example_effectiveness (
  cell_id TEXT PRIMARY KEY,
  times_used INTEGER DEFAULT 0,
  times_led_to_perfect INTEGER DEFAULT 0,
  times_led_to_minor_edit INTEGER DEFAULT 0,
  times_led_to_major_edit INTEGER DEFAULT 0,
  avg_edit_distance REAL DEFAULT 0.5,
  effectiveness_score REAL DEFAULT 0.5,  -- Computed score
  last_used INTEGER,

  -- EWC importance weight (how critical to preserve this example's score)
  fisher_importance REAL DEFAULT 0.0
);

-- Indexes for fast querying
CREATE INDEX idx_episodes_cell ON episodes(cell_id);
CREATE INDEX idx_episodes_quality ON episodes(outcome_quality);
CREATE INDEX idx_effectiveness_score ON example_effectiveness(effectiveness_score DESC);
```

### Episode Recording

```typescript
interface EpisodeRecorder {
  recordPrediction(
    cellId: string,
    sourceContent: string,
    examplesUsed: ExampleUsed[],
    llmOutput: string,
    metadata: PredictionMetadata
  ): string;  // Returns episode ID

  recordOutcome(
    episodeId: string,
    userFinal: string,
    timeToAccept: number
  ): void;

  getEpisodesForCell(cellId: string): Episode[];
  getRecentEpisodes(limit: number): Episode[];
  getEpisodesByQuality(quality: OutcomeQuality): Episode[];
}

// Outcome classification
function classifyOutcome(llmOutput: string, userFinal: string): OutcomeQuality {
  const editDistance = normalizedLevenshtein(llmOutput, userFinal);

  if (editDistance === 0) return 'perfect';
  if (editDistance < 0.1) return 'minor_edit';
  if (editDistance < 0.5) return 'major_edit';
  return 'rejected';
}

// Detailed edit extraction for pattern learning
function extractEdits(llmOutput: string, userFinal: string): EditOperation[] {
  const ops = diff(tokenize(llmOutput), tokenize(userFinal));
  return ops.map(op => ({
    type: op.type,           // 'insert', 'delete', 'replace'
    position: op.position,
    oldValue: op.oldValue,
    newValue: op.newValue,
    context: extractContext(llmOutput, op.position, 3)  // 3 words before/after
  }));
}
```

---

## Component 3: Pattern Engine

### Purpose
Extract learnable patterns from episodes: word mappings, corrections, style preferences.

### Inspired By
- RuVector's ReasoningBank (K-means++ clustering)
- SONA's pattern extraction

### Pattern Types

```typescript
// 1. Word-level mappings
interface WordMapping {
  sourceWord: string;
  targetWord: string;
  count: number;
  contexts: ContextExample[];  // Where this mapping occurred
  confidence: number;          // count / total_occurrences_of_source
  strongsNumber?: string;      // If available
}

// 2. Phrase-level patterns
interface PhrasePattern {
  sourcePhrase: string;        // "in the beginning"
  targetPhrase: string;        // "hapo mwanzo"
  count: number;
  isIdiomatic: boolean;        // Doesn't translate word-by-word
}

// 3. Correction patterns
interface CorrectionPattern {
  llmSaid: string;
  userCorrected: string;
  count: number;
  patternType: 'grammar' | 'word_choice' | 'style' | 'theological';
  explanation?: string;        // Human-provided reason
}

// 4. Style preferences
interface StylePreference {
  aspect: 'formality' | 'word_order' | 'sentence_length' | 'punctuation';
  preference: string;          // e.g., "formal", "verb-final"
  confidence: number;
  examples: string[];
}

// 5. Clustered patterns (from ReasoningBank approach)
interface PatternCluster {
  id: string;
  centroid: Float32Array;      // Cluster center in embedding space
  members: string[];           // Episode IDs in this cluster
  commonPattern: string;       // Extracted common pattern
  frequency: number;
  lastUpdated: number;
}
```

### Pattern Extraction Pipeline

```typescript
class PatternEngine {
  private wordMappings: Map<string, WordMapping[]> = new Map();
  private phrasePatterns: PhrasePattern[] = [];
  private corrections: CorrectionPattern[] = [];
  private clusters: PatternCluster[] = [];

  // Called after each episode is recorded
  async extractFromEpisode(episode: Episode): Promise<void> {
    // 1. Word-level alignment
    const alignments = await this.alignWords(
      episode.source_content,
      episode.user_final,
      episode.strongs_numbers
    );
    this.updateWordMappings(alignments);

    // 2. Phrase detection
    const phrases = this.detectPhrases(
      episode.source_content,
      episode.user_final
    );
    this.updatePhrasePatterns(phrases);

    // 3. Correction analysis
    if (episode.outcome_quality !== 'perfect') {
      const corrections = this.analyzeCorrections(
        episode.llm_output,
        episode.user_final,
        episode.edit_operations
      );
      this.updateCorrections(corrections);
    }

    // 4. Cluster assignment
    await this.assignToCluster(episode);
  }

  // Word alignment using statistical alignment + Strong's
  private async alignWords(
    source: string,
    target: string,
    strongs: string[]
  ): Promise<WordAlignment[]> {
    const sourceTokens = tokenize(source);
    const targetTokens = tokenize(target);

    // Use IBM Model 1-style alignment with Strong's as anchor
    const alignments: WordAlignment[] = [];

    for (let i = 0; i < sourceTokens.length; i++) {
      const strongsNum = strongs[i];  // May be undefined

      // Find best target alignment
      let bestTarget = '';
      let bestScore = 0;

      for (const target of targetTokens) {
        const cooccurrence = this.getCooccurrenceScore(sourceTokens[i], target);
        const positionScore = this.getPositionalScore(i, targetTokens.indexOf(target), sourceTokens.length, targetTokens.length);
        const score = cooccurrence * 0.7 + positionScore * 0.3;

        if (score > bestScore) {
          bestScore = score;
          bestTarget = target;
        }
      }

      if (bestScore > 0.3) {  // Threshold
        alignments.push({
          sourceWord: sourceTokens[i],
          targetWord: bestTarget,
          strongsNumber: strongsNum,
          confidence: bestScore
        });
      }
    }

    return alignments;
  }

  // K-means++ clustering (from ReasoningBank)
  private async assignToCluster(episode: Episode): Promise<void> {
    const embedding = episode.source_embedding;

    // Find nearest cluster
    let nearestCluster: PatternCluster | null = null;
    let nearestDistance = Infinity;

    for (const cluster of this.clusters) {
      const distance = euclideanDistance(embedding, cluster.centroid);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCluster = cluster;
      }
    }

    const CLUSTER_THRESHOLD = 0.5;

    if (nearestCluster && nearestDistance < CLUSTER_THRESHOLD) {
      // Add to existing cluster
      nearestCluster.members.push(episode.id);
      nearestCluster.frequency++;

      // Update centroid (running average)
      nearestCluster.centroid = this.updateCentroid(
        nearestCluster.centroid,
        embedding,
        nearestCluster.members.length
      );

      // Re-extract common pattern
      if (nearestCluster.members.length % 5 === 0) {
        nearestCluster.commonPattern = await this.extractCommonPattern(
          nearestCluster.members
        );
      }
    } else {
      // Create new cluster (K-means++ initialization)
      this.clusters.push({
        id: generateId(),
        centroid: embedding,
        members: [episode.id],
        commonPattern: '',  // Will be extracted when cluster grows
        frequency: 1,
        lastUpdated: Date.now()
      });
    }
  }
}
```

### Pattern Storage

```sql
-- Word mappings
CREATE TABLE word_mappings (
  id INTEGER PRIMARY KEY,
  source_word TEXT NOT NULL,
  target_word TEXT NOT NULL,
  strongs_number TEXT,
  count INTEGER DEFAULT 1,
  confidence REAL DEFAULT 0.0,
  first_seen INTEGER,
  last_seen INTEGER,
  UNIQUE(source_word, target_word)
);

-- Phrase patterns
CREATE TABLE phrase_patterns (
  id INTEGER PRIMARY KEY,
  source_phrase TEXT NOT NULL,
  target_phrase TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  is_idiomatic BOOLEAN DEFAULT FALSE,
  UNIQUE(source_phrase, target_phrase)
);

-- Corrections
CREATE TABLE corrections (
  id INTEGER PRIMARY KEY,
  llm_said TEXT NOT NULL,
  user_corrected TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  pattern_type TEXT,
  UNIQUE(llm_said, user_corrected)
);

-- Clusters
CREATE TABLE pattern_clusters (
  id TEXT PRIMARY KEY,
  centroid BLOB NOT NULL,
  member_count INTEGER DEFAULT 0,
  common_pattern TEXT,
  frequency INTEGER DEFAULT 0,
  last_updated INTEGER
);
```

---

## Component 4: Adaptive Ranker

### Purpose
Combine all signals (semantic, token, effectiveness, patterns) with learned weights that adapt over time without forgetting.

### Inspired By
- RuVector's EWC (Elastic Weight Consolidation)
- AgentDB's composite scoring

### Architecture

```typescript
interface AdaptiveRanker {
  // Ranking weights (learned)
  weights: RankingWeights;

  // Fisher information for EWC
  fisherInformation: FisherDiagonal;

  // Methods
  rank(query: QueryContext, candidates: Candidate[]): RankedCandidate[];
  updateWeights(feedback: RankingFeedback): void;
  consolidate(): void;  // Periodic EWC consolidation
}

interface RankingWeights {
  semanticSimilarity: number;    // From source embeddings
  tokenOverlap: number;          // Traditional method
  strongsOverlap: number;        // Shared Strong's numbers
  effectiveness: number;         // Historical performance
  recency: number;               // Recently used examples
  bookProximity: number;         // Same book/genre bonus
  clusterMatch: number;          // Same pattern cluster
}

interface QueryContext {
  cellId: string;
  sourceContent: string;
  sourceEmbedding: Float32Array;
  strongsNumbers: string[];
  bookId: string;
  previousCellId?: string;       // For context continuity
}
```

### Scoring Function

```typescript
class AdaptiveRanker {
  private weights: RankingWeights = {
    semanticSimilarity: 0.25,
    tokenOverlap: 0.15,
    strongsOverlap: 0.15,
    effectiveness: 0.25,
    recency: 0.05,
    bookProximity: 0.10,
    clusterMatch: 0.05
  };

  private fisherDiagonal: Map<string, number> = new Map();
  private consolidatedWeights: RankingWeights | null = null;

  rank(query: QueryContext, candidates: Candidate[]): RankedCandidate[] {
    return candidates.map(candidate => {
      const features = this.extractFeatures(query, candidate);
      const score = this.computeScore(features);

      return {
        ...candidate,
        score,
        features,  // For explainability
        confidence: this.computeConfidence(features)
      };
    }).sort((a, b) => b.score - a.score);
  }

  private extractFeatures(query: QueryContext, candidate: Candidate): FeatureVector {
    return {
      semanticSimilarity: cosineSimilarity(
        query.sourceEmbedding,
        candidate.sourceEmbedding
      ),

      tokenOverlap: jaccardSimilarity(
        tokenize(query.sourceContent),
        tokenize(candidate.sourceContent)
      ),

      strongsOverlap: this.computeStrongsOverlap(
        query.strongsNumbers,
        candidate.strongsNumbers
      ),

      effectiveness: this.getEffectiveness(candidate.cellId),

      recency: this.computeRecency(candidate.lastUsed),

      bookProximity: this.computeBookProximity(
        query.bookId,
        candidate.bookId
      ),

      clusterMatch: this.computeClusterMatch(
        query.sourceEmbedding,
        candidate.clusterId
      )
    };
  }

  private computeScore(features: FeatureVector): number {
    return (
      features.semanticSimilarity * this.weights.semanticSimilarity +
      features.tokenOverlap * this.weights.tokenOverlap +
      features.strongsOverlap * this.weights.strongsOverlap +
      features.effectiveness * this.weights.effectiveness +
      features.recency * this.weights.recency +
      features.bookProximity * this.weights.bookProximity +
      features.clusterMatch * this.weights.clusterMatch
    );
  }

  // EWC-based weight update
  updateWeights(feedback: RankingFeedback): void {
    const learningRate = 0.01;

    // Compute gradient from feedback
    const gradient = this.computeGradient(feedback);

    // EWC regularization: penalize changes to important weights
    for (const [key, value] of Object.entries(gradient)) {
      const fisher = this.fisherDiagonal.get(key) || 0;
      const consolidated = this.consolidatedWeights?.[key] || this.weights[key];

      // EWC loss = gradient + lambda * fisher * (weight - consolidated)^2
      const ewcPenalty = fisher * (this.weights[key] - consolidated);
      const adjustedGradient = value - 0.1 * ewcPenalty;  // lambda = 0.1

      this.weights[key] += learningRate * adjustedGradient;
    }

    // Normalize weights to sum to 1
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    for (const key of Object.keys(this.weights)) {
      this.weights[key] /= sum;
    }
  }

  // Periodic consolidation (prevents catastrophic forgetting)
  consolidate(): void {
    // Update Fisher information diagonal
    const recentEpisodes = this.getRecentEpisodes(100);

    for (const key of Object.keys(this.weights)) {
      // Fisher = E[(d log p / d weight)^2]
      // Approximated by gradient variance
      const gradients = recentEpisodes.map(ep =>
        this.computeGradientForEpisode(ep, key)
      );

      const fisher = variance(gradients);

      // Accumulate Fisher (don't replace)
      const oldFisher = this.fisherDiagonal.get(key) || 0;
      this.fisherDiagonal.set(key, oldFisher + fisher);
    }

    // Store current weights as consolidation target
    this.consolidatedWeights = { ...this.weights };
  }
}
```

### Conformal Prediction for Uncertainty

```typescript
class UncertaintyQuantifier {
  private calibrationScores: number[] = [];

  // After each prediction, record how wrong we were
  recordCalibrationPoint(predictedScore: number, actualQuality: number): void {
    const nonconformity = Math.abs(predictedScore - actualQuality);
    this.calibrationScores.push(nonconformity);

    // Keep last 1000 points
    if (this.calibrationScores.length > 1000) {
      this.calibrationScores.shift();
    }
  }

  // Get prediction interval at confidence level
  getPredictionInterval(
    predictedScore: number,
    confidenceLevel: number = 0.9
  ): [number, number] {
    const sorted = [...this.calibrationScores].sort((a, b) => a - b);
    const idx = Math.ceil((1 - confidenceLevel) * (sorted.length + 1)) - 1;
    const epsilon = sorted[Math.max(0, idx)] || 0.1;

    return [
      Math.max(0, predictedScore - epsilon),
      Math.min(1, predictedScore + epsilon)
    ];
  }

  // Should we auto-accept this prediction?
  shouldAutoAccept(
    predictedScore: number,
    threshold: number = 0.95
  ): boolean {
    const [lower, _] = this.getPredictionInterval(predictedScore, 0.95);
    return lower >= threshold;
  }
}
```

---

## Component 5: Prompt Composer

### Purpose
Build optimal prompts using all learned patterns.

### Prompt Structure

```typescript
interface ComposedPrompt {
  systemMessage: string;
  fewShotExamples: FewShotExample[];
  wordMappings: string;
  corrections: string;
  styleGuide: string;
  constraints: string;
  query: string;
}

class PromptComposer {
  compose(
    query: QueryContext,
    rankedExamples: RankedCandidate[],
    patterns: ExtractedPatterns
  ): ComposedPrompt {
    return {
      systemMessage: this.buildSystemMessage(patterns.stylePreferences),

      fewShotExamples: this.selectFewShotExamples(
        rankedExamples,
        query,
        5  // Target 5 examples
      ),

      wordMappings: this.formatWordMappings(
        patterns.wordMappings,
        query.sourceContent
      ),

      corrections: this.formatCorrections(
        patterns.corrections,
        10  // Top 10 most relevant
      ),

      styleGuide: this.formatStyleGuide(patterns.stylePreferences),

      constraints: this.buildConstraints(query),

      query: this.formatQuery(query)
    };
  }

  private buildSystemMessage(stylePrefs: StylePreference[]): string {
    let message = `You are an expert Bible translator. Translate the following verse with these guidelines:`;

    for (const pref of stylePrefs) {
      if (pref.confidence > 0.8) {
        message += `\n- ${pref.aspect}: ${pref.preference}`;
      }
    }

    return message;
  }

  private formatWordMappings(
    mappings: WordMapping[],
    sourceContent: string
  ): string {
    const sourceWords = new Set(tokenize(sourceContent.toLowerCase()));

    const relevantMappings = mappings
      .filter(m => sourceWords.has(m.sourceWord.toLowerCase()))
      .filter(m => m.confidence > 0.7)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);

    if (relevantMappings.length === 0) return '';

    let section = `## Consistent Word Choices (from this project)\n`;
    section += `Use these translations for consistency:\n`;

    for (const m of relevantMappings) {
      section += `- "${m.sourceWord}" → "${m.targetWord}" (used ${m.count} times, ${(m.confidence * 100).toFixed(0)}% consistent)\n`;
    }

    return section;
  }

  private formatCorrections(
    corrections: CorrectionPattern[],
    limit: number
  ): string {
    const relevant = corrections
      .filter(c => c.count >= 2)  // Only repeated corrections
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    if (relevant.length === 0) return '';

    let section = `## Common Mistakes to Avoid\n`;

    for (const c of relevant) {
      section += `- Don't say "${c.llmSaid}", use "${c.userCorrected}" instead`;
      if (c.patternType) {
        section += ` (${c.patternType})`;
      }
      section += `\n`;
    }

    return section;
  }

  private selectFewShotExamples(
    ranked: RankedCandidate[],
    query: QueryContext,
    targetCount: number
  ): FewShotExample[] {
    // Use MMR to ensure diversity
    const selected = selectWithMMR(ranked, targetCount, 0.7);

    return selected.map(candidate => ({
      source: candidate.sourceContent,
      target: candidate.targetContent,
      book: candidate.bookId,
      relevanceReason: this.explainRelevance(candidate, query)
    }));
  }

  private explainRelevance(
    candidate: RankedCandidate,
    query: QueryContext
  ): string {
    const reasons: string[] = [];

    if (candidate.features.semanticSimilarity > 0.8) {
      reasons.push('semantically similar');
    }
    if (candidate.features.strongsOverlap > 0.5) {
      reasons.push('shares key terms');
    }
    if (candidate.features.effectiveness > 0.8) {
      reasons.push('historically effective');
    }
    if (candidate.features.bookProximity > 0.5) {
      reasons.push('same book/genre');
    }

    return reasons.join(', ');
  }

  // Build final prompt
  toPromptString(composed: ComposedPrompt): string {
    let prompt = composed.systemMessage + '\n\n';

    if (composed.wordMappings) {
      prompt += composed.wordMappings + '\n';
    }

    if (composed.corrections) {
      prompt += composed.corrections + '\n';
    }

    if (composed.styleGuide) {
      prompt += composed.styleGuide + '\n';
    }

    prompt += `## Examples\n\n`;
    for (const example of composed.fewShotExamples) {
      prompt += `Source: ${example.source}\n`;
      prompt += `Translation: ${example.target}\n`;
      if (example.relevanceReason) {
        prompt += `(Selected because: ${example.relevanceReason})\n`;
      }
      prompt += `\n`;
    }

    prompt += `## Your Task\n\n`;
    prompt += `Translate the following verse:\n`;
    prompt += `Source: ${composed.query}\n`;
    prompt += `Translation:`;

    return prompt;
  }
}
```

---

## Component 6: Feedback Loop

### Purpose
Close the learning loop - every user action improves the system.

### Event Flow

```typescript
class FeedbackLoop {
  constructor(
    private episodeRecorder: EpisodeRecorder,
    private patternEngine: PatternEngine,
    private ranker: AdaptiveRanker,
    private semanticIndex: SourceSemanticIndex
  ) {}

  // Called when LLM generates prediction
  async onPrediction(
    cellId: string,
    sourceContent: string,
    examplesUsed: RankedCandidate[],
    llmOutput: string
  ): Promise<string> {
    const episodeId = await this.episodeRecorder.recordPrediction(
      cellId,
      sourceContent,
      examplesUsed,
      llmOutput,
      {
        model: 'current-model',
        timestamp: Date.now()
      }
    );

    return episodeId;
  }

  // Called when user accepts/edits prediction
  async onUserAction(
    episodeId: string,
    userFinal: string,
    timeToAccept: number
  ): Promise<void> {
    // 1. Record outcome
    const episode = await this.episodeRecorder.recordOutcome(
      episodeId,
      userFinal,
      timeToAccept
    );

    // 2. Extract patterns
    await this.patternEngine.extractFromEpisode(episode);

    // 3. Update example effectiveness
    await this.updateExampleEffectiveness(episode);

    // 4. Update ranker weights
    const feedback = this.createRankingFeedback(episode);
    this.ranker.updateWeights(feedback);

    // 5. Update uncertainty calibration
    this.ranker.uncertainty.recordCalibrationPoint(
      episode.predictedQuality,
      episode.actualQuality
    );

    // 6. Trigger background consolidation if needed
    if (this.shouldConsolidate()) {
      this.scheduleConsolidation();
    }
  }

  private async updateExampleEffectiveness(episode: Episode): Promise<void> {
    const quality = classifyOutcome(episode.llm_output, episode.user_final);

    for (const example of episode.examplesUsed) {
      const current = await this.getEffectiveness(example.cellId);

      const newStats = {
        times_used: current.times_used + 1,
        times_led_to_perfect: current.times_led_to_perfect + (quality === 'perfect' ? 1 : 0),
        times_led_to_minor_edit: current.times_led_to_minor_edit + (quality === 'minor_edit' ? 1 : 0),
        times_led_to_major_edit: current.times_led_to_major_edit + (quality === 'major_edit' ? 1 : 0),
        avg_edit_distance: this.runningAverage(
          current.avg_edit_distance,
          episode.edit_distance,
          current.times_used + 1
        ),
        effectiveness_score: this.computeEffectiveness(newStats)
      };

      await this.saveEffectiveness(example.cellId, newStats);
    }
  }

  private computeEffectiveness(stats: EffectivenessStats): number {
    if (stats.times_used < 3) {
      return 0.5;  // Prior before we have data
    }

    // Weighted score: perfect=1.0, minor=0.8, major=0.3, rejected=0
    const score = (
      stats.times_led_to_perfect * 1.0 +
      stats.times_led_to_minor_edit * 0.8 +
      stats.times_led_to_major_edit * 0.3
    ) / stats.times_used;

    // Blend with edit distance
    const editScore = 1 - stats.avg_edit_distance;

    return score * 0.6 + editScore * 0.4;
  }

  // Periodic consolidation (run every N episodes)
  private consolidationCounter = 0;
  private readonly CONSOLIDATION_INTERVAL = 50;

  private shouldConsolidate(): boolean {
    this.consolidationCounter++;
    return this.consolidationCounter >= this.CONSOLIDATION_INTERVAL;
  }

  private scheduleConsolidation(): void {
    this.consolidationCounter = 0;

    // Run in background
    setTimeout(async () => {
      // EWC consolidation
      this.ranker.consolidate();

      // Prune low-frequency patterns
      await this.patternEngine.prune();

      // Re-cluster if needed
      await this.patternEngine.recluster();

      console.log('Consolidation complete');
    }, 0);
  }
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal**: Basic learning loop working end-to-end

1. **Episode Recording**
   - Create schema and basic recording
   - Hook into existing prediction flow
   - Record outcomes when user edits

2. **Simple Effectiveness Tracking**
   - Track which examples lead to good predictions
   - Modify `fetchFewShotExamples` to use effectiveness

3. **Word Mapping Extraction**
   - Basic word alignment
   - Store and query mappings
   - Inject into prompts

### Phase 2: Semantic Layer (Week 3-4)
**Goal**: Source-anchored semantic search working

1. **Strong's Integration**
   - Extract Strong's numbers for each verse
   - Compute Strong's-based similarity
   - Index with existing data

2. **Source Embeddings**
   - Add embedding computation
   - Build HNSW index
   - Integrate with ranking

3. **MMR for Diversity**
   - Implement diversity selection
   - A/B test vs. pure similarity

### Phase 3: Advanced Patterns (Week 5-6)
**Goal**: Pattern clustering and correction learning

1. **Correction Tracking**
   - Detailed diff analysis
   - Pattern classification
   - Inject into prompts

2. **K-means++ Clustering**
   - Cluster similar verses
   - Extract common patterns
   - Use for recommendations

3. **Style Learning**
   - Detect style preferences
   - Build style guide

### Phase 4: Adaptive Learning (Week 7-8)
**Goal**: Full EWC-based adaptive system

1. **Learnable Weights**
   - Online weight updates
   - Fisher information tracking
   - EWC consolidation

2. **Uncertainty Quantification**
   - Conformal prediction
   - Confidence intervals
   - Auto-accept thresholds

3. **Background Processing**
   - Periodic consolidation
   - Pattern pruning
   - Index optimization

---

## Success Metrics

### Primary Metrics
- **Edit Distance Trend**: Should decrease over time
- **Perfect Predictions**: Percentage requiring zero edits
- **Time to Accept**: Should decrease as confidence grows

### Secondary Metrics
- **Word Consistency**: Same source words translated consistently
- **Correction Repeat Rate**: Same corrections shouldn't be needed twice
- **Example Diversity**: Coverage across different verse types

### Measurement

```typescript
interface LearningMetrics {
  // Computed daily
  avgEditDistance: number;
  perfectPredictionRate: number;
  avgTimeToAccept: number;

  // Computed weekly
  wordConsistencyScore: number;
  correctionRepeatRate: number;
  exampleDiversityScore: number;

  // Learning curves
  editDistanceByVerseCount: Array<{verseCount: number; avgEditDistance: number}>;
  perfectRateByVerseCount: Array<{verseCount: number; perfectRate: number}>;
}

// Dashboard endpoint
async function getLearningDashboard(): Promise<LearningDashboard> {
  return {
    overall: await computeOverallMetrics(),
    byBook: await computeMetricsByBook(),
    learningCurve: await computeLearningCurve(),
    topPatterns: await getTopLearnedPatterns(),
    recentImprovements: await getRecentImprovements()
  };
}
```

---

## Technical Dependencies

### Required
- SQLite (already have)
- Basic tokenization (already have)

### Recommended
- **Sentence embeddings**: `@xenova/transformers` (runs in Node.js/browser)
- **HNSW index**: `hnswlib-node` or implement in TypeScript
- **Diff algorithm**: `diff` npm package

### Optional (for maximum performance)
- **Rust/WASM layer**: For embedding computation and HNSW if needed
- **Background worker**: For consolidation without blocking UI

---

## Comparison with RuVector Approach

| Feature | This Design | RuVector |
|---------|-------------|----------|
| Semantic search | Source embeddings + Strong's | GNN-enhanced embeddings |
| Pattern learning | Word/phrase counting + K-means | Full ReasoningBank |
| Forgetting prevention | EWC on ranking weights | EWC on all network weights |
| Diversity | MMR | MMR |
| Uncertainty | Conformal prediction | Conformal prediction |
| Complexity | Medium | Very High |
| Implementation time | 6-8 weeks | 6+ months |
| Dependencies | Minimal | Rust toolchain, WASM |

This design takes the best ideas from RuVector but adapts them for:
- TypeScript ecosystem
- Bible translation domain
- Practical implementation timeline
- Maintainability by the Codex team

---

## Next Steps

1. Review this architecture with the team
2. Prioritize which components are most valuable
3. Start with Phase 1 (basic learning loop)
4. Measure results before adding complexity
5. Iterate based on translator feedback

The goal is **shipped improvement**, not perfect architecture. We can always add more sophistication later, but the basic learning loop will start helping translators immediately.
