# Self-Learning Loop Architecture for Codex

## Executive Summary

This document proposes a self-learning loop for Codex's translation copilot, inspired by AgentDB's memory architecture but specifically designed for the unique challenges of ultra-low-resource Bible translation.

---

## Part 1: AgentDB Analysis (What It Actually Does)

### Core Architecture (Reality vs. Hype)

After analyzing the source code (not just the README), AgentDB implements:

#### 1. ReflexionMemory (`ReflexionMemory.ts`)
- **What it does**: Stores "episodes" - records of task attempts with input, output, critique, and reward scores
- **How it learns**:
  - Failed episodes store critiques; success episodes store strategies
  - GNN enhancement weights neighbor embeddings by episode reward
  - Creates `LEARNED_FROM` edges linking current episodes to previous failures
- **Real implementation**: SQLite + optional graph backend, uses `Xenova/all-MiniLM-L6-v2` for embeddings

#### 2. SkillLibrary (`SkillLibrary.ts`)
- **What it does**: Stores reusable patterns with success rates, usage counts, and average rewards
- **How retrieval works**:
  - Generates query embedding
  - Ranks by: similarity (40%) + success_rate (30%) + usage (10%) + avg_reward (20%)
- **Real implementation**: `consolidateEpisodesIntoSkills()` extracts high-performing sequences into reusable patterns

#### 3. CausalMemoryGraph (`CausalMemoryGraph.ts`)
- **What it does**: Tracks which actions led to which outcomes
- **Key metric**: Calculates "uplift" = `E[y|do(x)] - E[y]` (causal effect of an intervention)
- **Real implementation**: Multi-hop reasoning through causal chains, confounder detection

#### 4. LearningSystem (`LearningSystem.ts`)
- **What it does**: 9 RL algorithms for policy optimization
- **Key algorithms used**: Q-Learning, SARSA, PPO, Decision Transformer
- **Real implementation**: Incremental policy updates, experience replay, transfer learning

#### 5. NightlyLearner (`NightlyLearner.ts`)
- **What it does**: Batch processing to discover patterns across episodes
- **Key method**: Doubly robust estimation for causal discovery
- **Real implementation**: Runs in background, prunes low-confidence edges, generates recommendations

### What Actually Works

| Component | Implementation Status | Relevance to Codex |
|-----------|----------------------|-------------------|
| Episode storage with embeddings | ✅ Working | **High** - map to translation attempts |
| Skill consolidation | ✅ Working | **High** - map to word/phrase patterns |
| Causal edge discovery | ✅ Working | **Medium** - which examples help |
| GNN enhancement | ⚠️ Partial | **Low** - may not work for unknown languages |
| RL algorithms | ⚠️ Theoretical | **Low** - too complex for initial implementation |

---

## Part 2: Current Codex Translation Flow

### Data Flow Analysis

```
User clicks sparkle → fetchFewShotExamples() → buildMessages() → callLLM() → user edits
                            ↓
                 Token overlap ranking
                 (not semantic similarity)
```

### Key Files
- `llmCompletion.ts`: Orchestrates the prediction flow
- `shared.ts`: `fetchFewShotExamples()` - ranks by token overlap, not embeddings
- `codexDocument.ts`: `updateCellContent()` - tracks edits with type and author
- `llmUtils.ts`: OpenAI API calls

### Current Data Available

When prediction is made:
- Source text (verse in source language)
- Translation memory (all previously translated verses)
- Preceding context (verses before this one in same chapter)
- Edit history (all previous versions of each verse)

When user edits:
- LLM output (what was predicted)
- Final value (what user saved)
- Edit type (LLM_GENERATION, USER_EDIT)
- Author and timestamp

---

## Part 3: Minimum Architecture for Self-Learning

### Core Concept: Translation Episodes

Map AgentDB concepts to translation:

| AgentDB | Codex Translation |
|---------|-------------------|
| Episode | A prediction attempt (source → LLM → edit) |
| Task | Source verse content |
| Input | Few-shot examples used + preceding context |
| Output | LLM prediction |
| Reward | Edit distance between prediction and final (inverted) |
| Critique | Diff between LLM output and user's final version |
| Skill | Learned word/phrase mapping patterns |

### Minimum Viable Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRANSLATION MEMORY                            │
│  (existing: translation pairs with token-overlap search)            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     TRANSLATION EPISODE STORE                        │
│                                                                      │
│  episode = {                                                        │
│    cellId: "GEN 1:1",                                               │
│    sourceContent: "In the beginning...",                            │
│    examplesUsed: [cellIds of few-shot examples],                    │
│    llmPrediction: "Na upande wa kwanza...",                         │
│    userFinalEdit: "Hapo mwanzo...",                                 │
│    editDistance: 0.73,  // normalized Levenshtein                   │
│    timestamp: 1733405123,                                           │
│    author: "translator@example.com"                                 │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     LEARNED PATTERNS STORE                           │
│                                                                      │
│  pattern = {                                                        │
│    id: "pattern_123",                                               │
│    type: "word_mapping" | "phrase_pattern" | "grammar_rule",        │
│    sourcePattern: "In the beginning",                               │
│    targetPattern: "Hapo mwanzo",                                    │
│    confidence: 0.95,  // based on consistency across episodes       │
│    occurrences: 12,                                                 │
│    successRate: 0.92, // how often LLM gets it right when using    │
│    sourceBook: "GEN", // optional: pattern may be book-specific     │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXAMPLE EFFECTIVENESS TRACKER                    │
│                                                                      │
│  effectiveness = {                                                  │
│    exampleCellId: "GEN 1:2",                                        │
│    usedForCellId: "GEN 1:5",                                        │
│    wasHelpful: true,  // did prediction match final edit?           │
│    uplift: 0.15,      // how much better vs. baseline               │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation: 4 Key Components

#### Component 1: Episode Recorder

```typescript
// File: src/selfLearning/episodeStore.ts

interface TranslationEpisode {
  id: string;
  cellId: string;
  sourceContent: string;

  // What was used to generate
  examplesUsed: string[];  // cellIds of few-shot examples
  precedingContext: string[];  // cellIds of preceding verses
  promptHash: string;  // to detect if prompt construction changed

  // Prediction vs Reality
  llmPrediction: string;
  userFinalEdit: string | null;  // null if not yet edited

  // Computed metrics
  editDistance: number;  // 0 = perfect, 1 = completely rewritten
  wordOverlap: number;   // what % of LLM words kept

  // Metadata
  timestamp: number;
  author: string;
  model: string;
}

class EpisodeStore {
  // Called after LLM prediction
  recordPrediction(cellId: string, prediction: string, examplesUsed: string[]): string;

  // Called after user saves edit
  recordUserEdit(cellId: string, finalEdit: string): void;

  // For analysis
  getEpisodesForCell(cellId: string): TranslationEpisode[];
  getEpisodesByEffectiveness(minWordOverlap: number): TranslationEpisode[];
}
```

#### Component 2: Pattern Extractor

```typescript
// File: src/selfLearning/patternExtractor.ts

interface LearnedPattern {
  id: string;
  type: 'word_mapping' | 'phrase_pattern' | 'grammar_rule';

  // The pattern
  sourceTokens: string[];   // ["In", "the", "beginning"]
  targetTokens: string[];   // ["Hapo", "mwanzo"]

  // Confidence metrics
  occurrences: number;      // how many times seen
  consistency: number;      // how consistent the mapping is
  successRate: number;      // when used as example, how often correct

  // Context (patterns may vary by context)
  bookScope: string | null; // null = universal
  genreScope: string | null; // 'poetry' | 'narrative' | 'law' | null
}

class PatternExtractor {
  // Run periodically (like NightlyLearner)
  async extractPatterns(episodes: TranslationEpisode[]): Promise<LearnedPattern[]>;

  // Find patterns relevant to a source text
  findRelevantPatterns(sourceContent: string): LearnedPattern[];

  // Get high-confidence patterns for prompt injection
  getPromptPatterns(minConfidence: number): LearnedPattern[];
}
```

#### Component 3: Example Ranker (Enhanced)

```typescript
// File: src/selfLearning/exampleRanker.ts

class EnhancedExampleRanker {
  // Current: token overlap only
  // Enhanced: token overlap + historical effectiveness

  async rankExamples(
    sourceContent: string,
    candidateExamples: TranslationPair[],
    targetCellId: string
  ): Promise<RankedExample[]> {

    return candidateExamples.map(example => {
      const tokenScore = this.tokenOverlap(sourceContent, example.sourceCell.content);
      const effectivenessScore = this.getHistoricalEffectiveness(example.cellId);
      const patternScore = this.patternRelevance(sourceContent, example);

      // Weighted combination (tune these weights)
      const finalScore =
        tokenScore * 0.4 +           // Keep token overlap as baseline
        effectivenessScore * 0.35 +  // How well this example helped before
        patternScore * 0.25;         // Does it contain relevant patterns

      return { example, score: finalScore, breakdown: { tokenScore, effectivenessScore, patternScore } };
    }).sort((a, b) => b.score - a.score);
  }

  // Track effectiveness of examples
  private getHistoricalEffectiveness(exampleCellId: string): number {
    // Query: when this example was used, how accurate were predictions?
    const episodes = this.episodeStore.getEpisodesUsingExample(exampleCellId);
    if (episodes.length === 0) return 0.5; // neutral for unseen

    const avgWordOverlap = episodes.reduce((sum, e) => sum + e.wordOverlap, 0) / episodes.length;
    return avgWordOverlap;
  }
}
```

#### Component 4: Prompt Enhancer

```typescript
// File: src/selfLearning/promptEnhancer.ts

class PromptEnhancer {
  // Inject learned patterns into the prompt
  enhancePrompt(
    basePrompt: string,
    sourceContent: string,
    learnedPatterns: LearnedPattern[]
  ): string {

    const relevantPatterns = this.patternExtractor.findRelevantPatterns(sourceContent);

    if (relevantPatterns.length === 0) {
      return basePrompt;
    }

    // Add patterns as additional instruction
    const patternSection = `
## Learned Translation Patterns

The following word/phrase mappings have been consistently used in this translation project:

${relevantPatterns.map(p =>
  `- "${p.sourceTokens.join(' ')}" → "${p.targetTokens.join(' ')}" (confidence: ${(p.consistency * 100).toFixed(0)}%)`
).join('\n')}

Apply these patterns where appropriate.
`;

    return basePrompt + '\n\n' + patternSection;
  }
}
```

### Data Storage (Minimal)

For MVP, add two SQLite tables to the existing translation memory database:

```sql
-- Track every prediction attempt
CREATE TABLE translation_episodes (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL,
  source_content TEXT NOT NULL,
  examples_used TEXT NOT NULL,  -- JSON array of cellIds
  llm_prediction TEXT NOT NULL,
  user_final_edit TEXT,
  edit_distance REAL,
  word_overlap REAL,
  timestamp INTEGER NOT NULL,
  author TEXT,
  model TEXT,
  FOREIGN KEY (cell_id) REFERENCES cells(id)
);

-- Track which examples were effective
CREATE TABLE example_effectiveness (
  example_cell_id TEXT NOT NULL,
  used_for_cell_id TEXT NOT NULL,
  was_helpful INTEGER NOT NULL,  -- 1 if prediction was good
  contribution_score REAL,        -- how much this example helped
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (example_cell_id, used_for_cell_id, timestamp)
);

-- Learned patterns (populated by batch job)
CREATE TABLE learned_patterns (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_tokens TEXT NOT NULL,    -- JSON array
  target_tokens TEXT NOT NULL,    -- JSON array
  occurrences INTEGER DEFAULT 1,
  consistency REAL DEFAULT 0,
  success_rate REAL DEFAULT 0,
  book_scope TEXT,
  genre_scope TEXT,
  updated_at INTEGER NOT NULL
);
```

---

## Part 4: Architecture Improvements for Translation Use Case

### Challenge: Embeddings Don't Work for Unknown Languages

**Problem**: Standard embedding models (like `all-MiniLM-L6-v2`) are trained on known languages. For ultra-low-resource languages:
- Word embeddings will be meaningless (unknown tokens)
- Semantic similarity will fail
- The "Scunthorpe problem" - false matches based on orthographic similarity

**AgentDB's assumption**: Embeddings work. **Codex reality**: They won't.

### Solution 1: Source-Anchored Similarity

Instead of embedding the target language, embed the **source language** (which is known).

```typescript
// Similarity based on SOURCE content, not target
async function findSimilarVerses(sourceContent: string): Promise<TranslationPair[]> {
  // Embed the source (Greek/Hebrew/English - known languages)
  const sourceEmbedding = await embed(sourceContent);

  // Find verses with similar source content
  // Their target translations will be relevant
  return vectorSearch(sourceEmbedding, 'source_embeddings');
}
```

### Solution 2: Structural Similarity

For unknown languages, use structural features instead of semantic embeddings:

```typescript
interface StructuralFeatures {
  tokenCount: number;
  avgTokenLength: number;
  punctuationPattern: string;  // e.g., ".,!?" normalized
  sentenceCount: number;

  // Character n-gram distribution (language-agnostic)
  charNgrams: Map<string, number>;

  // Borrowed word detection (words that look like source language)
  potentialBorrowings: string[];
}

function structuralSimilarity(a: StructuralFeatures, b: StructuralFeatures): number {
  // Compare structural patterns, not semantic meaning
}
```

### Solution 3: Alignment-Based Pattern Learning

Learn from word alignments between source and target:

```typescript
// When user edits, extract word-level alignments
function extractAlignments(
  source: string,
  llmPrediction: string,
  userEdit: string
): WordAlignment[] {
  // Use attention weights or statistical alignment
  // to learn source→target word mappings

  // Key insight: even for unknown languages, we can learn
  // "when source has X, target should have Y"
  // based on positional/statistical patterns
}
```

### Solution 4: Contextual Book/Genre Awareness

Translation patterns vary by context:
- Poetry (Psalms) vs. Narrative (Genesis) vs. Law (Leviticus)
- Greek NT vs. Hebrew OT
- Author style (Pauline vs. Johannine)

```typescript
interface ContextAwarePattern extends LearnedPattern {
  // Scope limitations
  testaments: ('OT' | 'NT')[];
  genres: ('poetry' | 'narrative' | 'law' | 'prophecy' | 'epistle')[];
  books: string[];  // optional: specific books

  // Confidence varies by context
  contextConfidence: Map<string, number>;  // context → confidence
}
```

### Solution 5: Edit Chain Learning

Learn from sequences of edits, not just final states:

```typescript
interface EditChain {
  cellId: string;
  chain: EditStep[];  // ordered sequence of edits
}

interface EditStep {
  fromValue: string;
  toValue: string;
  editType: EditType;
  author: string;
  timestamp: number;

  // What changed (computed)
  additions: string[];
  deletions: string[];
  substitutions: Array<{ from: string; to: string }>;
}

// Learn: what do users consistently change about LLM predictions?
function learnEditPatterns(chains: EditChain[]): EditCorrection[] {
  // Example: LLM always says "Mungu" but users change to "Mulungu"
  // → Learn this substitution pattern
}
```

### Enhanced Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                 │
│  [Source verse] → [Sparkle button] → [LLM Prediction] → [User edits]    │
└─────────────────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
┌─────────────────────┐                 ┌─────────────────────────────────┐
│  SOURCE EMBEDDINGS  │                 │      EPISODE RECORDER           │
│  (Greek/Hebrew/Eng) │                 │  - Record prediction            │
│  - Known languages  │                 │  - Record user edit             │
│  - Semantic search  │                 │  - Compute edit distance        │
└─────────────────────┘                 │  - Extract corrections          │
         │                              └─────────────────────────────────┘
         ▼                                        │
┌─────────────────────────────────────────────────┼───────────────────────┐
│                    ENHANCED EXAMPLE RANKER      │                       │
│                                                 ▼                       │
│  Score = 0.30 × sourceEmbeddingSimilarity  ←────┤                       │
│        + 0.25 × tokenOverlap                    │                       │
│        + 0.25 × historicalEffectiveness    ←────┤ (from episodes)       │
│        + 0.10 × structuralSimilarity            │                       │
│        + 0.10 × contextMatch (book/genre)       │                       │
└─────────────────────────────────────────────────┼───────────────────────┘
         │                                        │
         ▼                                        ▼
┌─────────────────────┐                 ┌─────────────────────────────────┐
│  TOP-N EXAMPLES     │                 │     PATTERN EXTRACTOR           │
│  (for few-shot)     │                 │  - Word mappings                │
└─────────────────────┘                 │  - Phrase patterns              │
         │                              │  - Common corrections           │
         ▼                              │  - Genre-specific rules         │
┌─────────────────────────────────────────────────────────────────────────┐
│                        PROMPT ENHANCER                                   │
│                                                                          │
│  Base prompt                                                            │
│  + Few-shot examples (ranked by effectiveness)                          │
│  + Learned patterns section                                             │
│  + Common corrections ("avoid: X → use: Y")                             │
│  + Context-specific instructions                                        │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│     LLM API         │
│  (with enhanced     │
│   prompt)           │
└─────────────────────┘
```

---

## Part 5: Validation & Testing Approaches

### Test 1: Holdout Evaluation

**Method**: Train on N-1 books, test on held-out book

```typescript
async function holdoutEvaluation(heldOutBook: string) {
  // 1. Get all episodes NOT from held-out book
  const trainingEpisodes = episodes.filter(e => !e.cellId.startsWith(heldOutBook));

  // 2. Extract patterns from training episodes
  const patterns = patternExtractor.extractPatterns(trainingEpisodes);

  // 3. For each verse in held-out book, simulate prediction
  const testCells = cells.filter(c => c.id.startsWith(heldOutBook));

  const results = [];
  for (const cell of testCells) {
    // Predict using patterns
    const prediction = await predictWithPatterns(cell.source, patterns);

    // Compare to actual translation
    const editDistance = levenshtein(prediction, cell.target);
    results.push({ cellId: cell.id, editDistance });
  }

  return {
    meanEditDistance: mean(results.map(r => r.editDistance)),
    accuracy: results.filter(r => r.editDistance < 0.3).length / results.length
  };
}
```

### Test 2: A/B Test - Pattern-Enhanced vs. Baseline

**Method**: Use existing A/B testing infrastructure

```typescript
// In llmCompletion.ts
async function generateWithABTest(cellId: string) {
  // Variant A: Current approach (token overlap only)
  const basePrompt = buildBasePrompt(cellId);
  const variantA = await callLLM(basePrompt);

  // Variant B: Pattern-enhanced approach
  const patterns = await patternExtractor.findRelevantPatterns(sourceContent);
  const enhancedPrompt = promptEnhancer.enhance(basePrompt, patterns);
  const variantB = await callLLM(enhancedPrompt);

  // Return both for user selection
  return { variants: [variantA, variantB], testName: 'pattern_enhancement_v1' };
}
```

### Test 3: Simulated User Study

**Method**: Use historical data to simulate improvements

```typescript
async function simulateHistoricalImprovement() {
  // Get all episodes in chronological order
  const episodes = await episodeStore.getAllEpisodes().sortBy('timestamp');

  const results = [];
  for (let i = 100; i < episodes.length; i++) {  // Need minimum training data
    // "Train" on episodes before this one
    const trainingData = episodes.slice(0, i);
    const patterns = patternExtractor.extractPatterns(trainingData);

    // "Test" on this episode
    const testEpisode = episodes[i];
    const predictedImprovement = estimateImprovement(testEpisode, patterns);

    results.push({
      episodeIndex: i,
      baselineEditDistance: testEpisode.editDistance,
      estimatedEditDistance: predictedImprovement.editDistance,
      improvement: testEpisode.editDistance - predictedImprovement.editDistance
    });
  }

  return {
    avgImprovement: mean(results.map(r => r.improvement)),
    improvementOverTime: results.map(r => r.improvement)  // should increase
  };
}
```

### Test 4: Pattern Quality Metrics

```typescript
interface PatternQualityReport {
  totalPatterns: number;
  highConfidence: number;  // > 0.9 confidence
  mediumConfidence: number;  // 0.7-0.9
  lowConfidence: number;  // < 0.7

  // Coverage
  versesCovered: number;  // verses with at least one relevant pattern
  avgPatternsPerVerse: number;

  // Consistency
  conflictingPatterns: number;  // patterns that contradict each other

  // Effectiveness
  avgSuccessRate: number;  // when pattern used, how often correct
}
```

### Test 5: Human Evaluation Protocol

```markdown
## Translation Quality Evaluation

For each test verse:
1. Show translator the source text
2. Show them two translations (A/B randomized)
3. Ask:
   - Which translation is more accurate? (A/B/Same)
   - Which translation uses better vocabulary? (A/B/Same)
   - Which translation would require less editing? (A/B/Same)
   - Rate each translation 1-5 for fluency

Track:
- Win rate (pattern-enhanced vs. baseline)
- Average fluency scores
- Time to edit (if they edit both)
```

### Test 6: Regression Detection

Ensure learning doesn't make things worse:

```typescript
async function regressionTest() {
  // Get "golden" translations that are well-validated
  const goldenCells = cells.filter(c => c.validationCount >= 3);

  // Generate predictions with current system
  const currentPredictions = await Promise.all(
    goldenCells.map(c => predict(c.source))
  );

  // Generate predictions with pattern-enhanced system
  const enhancedPredictions = await Promise.all(
    goldenCells.map(c => predictWithPatterns(c.source))
  );

  // Compare
  const currentScores = currentPredictions.map((p, i) =>
    similarity(p, goldenCells[i].target)
  );
  const enhancedScores = enhancedPredictions.map((p, i) =>
    similarity(p, goldenCells[i].target)
  );

  // Alert if enhanced is worse
  const regressions = enhancedScores.filter((s, i) => s < currentScores[i] - 0.1);
  if (regressions.length > 0.05 * goldenCells.length) {
    throw new Error(`Regression detected: ${regressions.length} verses got worse`);
  }
}
```

---

## Part 6: Implementation Roadmap

### Phase 1: Episode Recording (Foundation)
- Add `translation_episodes` table
- Record every LLM prediction
- Record user edits when they happen
- Compute edit distance metrics
- **Validation**: Verify data is being recorded correctly

### Phase 2: Effectiveness Tracking
- Track which examples were used for each prediction
- Compute example effectiveness scores
- Update `fetchFewShotExamples` to use effectiveness in ranking
- **Validation**: A/B test - effectiveness-ranked vs. current

### Phase 3: Pattern Extraction
- Implement pattern extraction from episode pairs
- Store patterns with confidence scores
- Run pattern extraction as background job
- **Validation**: Pattern quality metrics, holdout evaluation

### Phase 4: Prompt Enhancement
- Inject relevant patterns into prompts
- Add "common corrections" section
- Context-aware pattern selection
- **Validation**: A/B test, human evaluation

### Phase 5: Advanced Features
- Source-anchored embeddings
- Structural similarity for unknown languages
- Edit chain learning
- **Validation**: Full regression suite

---

## Appendix: Key Differences from AgentDB

| AgentDB Approach | Codex Adaptation | Reason |
|-----------------|------------------|--------|
| Semantic embeddings for everything | Source-anchored embeddings only | Target languages are unknown |
| GNN enhancement | Not used initially | Requires working embeddings |
| 9 RL algorithms | Simple effectiveness scoring | Complexity not justified yet |
| Graph database | SQLite tables | Match existing infrastructure |
| Causal experiments | Track example effectiveness | Simpler causal question |
| Skill library | Learned patterns | Translation-specific abstraction |
| Nightly batch learning | Background pattern extraction | Same concept, translation domain |

