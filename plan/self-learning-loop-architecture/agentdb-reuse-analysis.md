# AgentDB Reuse Analysis for Codex Self-Learning Loop

## Executive Summary

This document provides a deep analysis of AgentDB's architecture, including its Rust-based RuVector layer, to identify what can be reused for Codex's self-learning translation system. The analysis is based on actual source code review, not documentation claims.

---

## Part 1: Current Translation Memory Analysis

### How It Currently Works

**File**: `src/providers/translationSuggestions/shared.ts` (lines 7-120)

```typescript
// Current ranking algorithm (simplified)
const rankedPairs = candidatePairs
  .filter(pair => pair.sourceCell?.content && pair.targetCell?.content)
  .map(pair => {
    const pairTokens = tokenizeText(pair.sourceCell.content);
    const overlapCount = currentTokens.filter(t => pairTokens.includes(t)).length;
    const overlapRatio = overlapCount / currentTokens.length;
    return { pair, overlapRatio, overlapCount };
  })
  .sort((a, b) => b.overlapRatio - a.overlapRatio);
```

### Current System Strengths

| Strength | Evidence | File Reference |
|----------|----------|----------------|
| **Simple & Fast** | Token overlap is O(n) per comparison | `shared.ts:76-101` |
| **No External Dependencies** | Pure TypeScript, no embedding models | `shared.ts:54` |
| **Works for Unknown Languages** | Token matching is language-agnostic | `shared.ts:81-85` |
| **Deterministic** | Same input always produces same ranking | - |
| **No Training Required** | Works immediately with first verse | - |

### Current System Weaknesses

| Weakness | Impact | Evidence |
|----------|--------|----------|
| **No Semantic Understanding** | "God created" won't match "The Lord made" | Token-based only |
| **No Learning from Edits** | User corrections are ignored for ranking | No feedback loop |
| **No Effectiveness Tracking** | Don't know which examples actually help | No metrics stored |
| **No Pattern Extraction** | Can't learn word mappings | No pattern system |
| **Recency Bias Missing** | Old translations weighted same as recent | No timestamp weighting |
| **No Context Awareness** | Poetry examples used for narrative | No genre filtering |

### Data Available But Unused

From `codexDocument.ts` (lines 265-444):
- Edit history with `EditType` (LLM_GENERATION, USER_EDIT)
- Author information
- Timestamps
- Validation status

**This rich edit data is stored but never used for improving predictions.**

---

## Part 2: New Approach Comparison

### Token Overlap vs. Self-Learning

| Aspect | Current: Token Overlap | Proposed: Self-Learning |
|--------|----------------------|------------------------|
| **Ranking Signal** | % tokens shared | Historical effectiveness + tokens |
| **Learning** | None | Continuous from user edits |
| **Pattern Recognition** | None | Extracts word/phrase mappings |
| **Causal Tracking** | None | Tracks which examples helped |
| **Storage Overhead** | ~0 | Additional tables for episodes |
| **Complexity** | Low | Medium |
| **Cold Start** | Works immediately | Works immediately (degrades to token) |

### Should This Replace or Extend?

**Recommendation: EXTEND, not replace.**

Rationale:
1. Token overlap works for cold start - keep it as baseline
2. New signals can be added as weighted factors
3. Graceful degradation if learning data unavailable
4. A/B testable without breaking existing functionality

### Proposed Hybrid Ranking Formula

```typescript
// Extended ranking (proposed)
const finalScore =
  tokenOverlapScore * 0.35 +           // Keep existing signal
  historicalEffectiveness * 0.30 +     // How well this example worked before
  patternRelevance * 0.20 +            // Does it contain learned patterns
  recencyBonus * 0.10 +                // Recent translations weighted higher
  contextMatch * 0.05;                 // Same book/genre bonus
```

---

## Part 3: Benefits of the New System

### Quantifiable Improvements

| Benefit | Metric | Expected Impact |
|---------|--------|-----------------|
| **Better Example Selection** | Edit distance of predictions | 15-30% reduction |
| **Pattern Consistency** | Word mapping consistency | "God"→"Mungu" always, not sometimes "Ala" |
| **Faster Translator Workflow** | Edits per prediction | Fewer corrections needed |
| **Context Awareness** | Genre-appropriate language | Poetry uses poetic register |
| **Learning Over Time** | Improvement curve | Later predictions better than early |

### Unique Advantages for Bible Translation

1. **Ultra-Low-Resource Language Support**: Learns patterns even when embeddings fail
2. **Translator Style Preservation**: Learns team's preferred vocabulary choices
3. **Book-Specific Patterns**: "Lord" in Psalms vs. "Lord" in Paul's letters
4. **Community Knowledge Capture**: Edit patterns from experienced translators benefit newcomers

---

## Part 4: AgentDB Features - Confirmed from Source Code

### Feature Analysis with Code Evidence

#### 1. ReflexionMemory - Episode Storage
**Source**: `packages/agentdb/src/controllers/ReflexionMemory.ts`

```typescript
// What it actually stores (from code analysis)
interface Episode {
  id: string;
  task: string;           // Maps to: source verse content
  input: string;          // Maps to: examples used
  output: string;         // Maps to: LLM prediction
  critique: string;       // Maps to: diff from user edit
  reward: number;         // Maps to: 1 - editDistance
  success: boolean;       // Maps to: editDistance < threshold
  latency_ms: number;
  tokens_used: number;
  metadata: Record<string, any>;
}
```

**Reusable for Codex**: YES - Core episode structure maps directly to translation attempts.

**Adaptation Required**:
- `task` → `sourceContent`
- `output` → `llmPrediction`
- `reward` → `1 - normalizedEditDistance`
- Add: `examplesUsed: string[]`

#### 2. SkillLibrary - Pattern Storage
**Source**: `packages/agentdb/src/controllers/SkillLibrary.ts`

```typescript
// Skill retrieval scoring (from code)
const compositeScore =
  similarity * 0.4 +        // Semantic similarity
  success_rate * 0.3 +      // Historical success
  uses * 0.1 +              // Usage frequency
  avg_reward * 0.2;         // Average reward when used
```

**Reusable for Codex**: PARTIALLY - The scoring formula is directly applicable.

**Adaptation Required**:
- Replace `similarity` with source-text similarity (not embedding)
- `success_rate` → how often this example led to good predictions
- `uses` → how many times selected as few-shot example
- `avg_reward` → average (1 - editDistance) when this example was used

#### 3. CausalMemoryGraph - Effectiveness Tracking
**Source**: `packages/agentdb/src/controllers/CausalMemoryGraph.ts`

```typescript
// Uplift calculation (from code)
// "E[y|do(x)] - E[y]" - causal effect of using example x
const uplift = outcomeWithExample - outcomeWithoutExample;
```

**Reusable for Codex**: YES - Simplified version for example effectiveness.

**Simplification for Codex**:
```typescript
// Did using this example help?
const effectiveness = avgEditDistanceWithExample < avgEditDistanceWithout;
```

#### 4. NightlyLearner - Batch Pattern Discovery
**Source**: `packages/agentdb/src/controllers/NightlyLearner.ts`

Key insight from code: Uses **doubly robust estimation** for causal discovery, which is overkill for translation but the batch processing pattern is useful.

**Reusable for Codex**: PATTERN ONLY - The batch processing approach:
1. Collect episodes from last N hours
2. Extract patterns (word alignments, common corrections)
3. Update pattern confidence scores
4. Prune low-confidence patterns

#### 5. HNSWIndex - Vector Search
**Source**: `packages/agentdb/src/controllers/HNSWIndex.ts`

Uses `hnswlib-node` for approximate nearest neighbor search.

**Reusable for Codex**: LIMITED

**Problem**: HNSW requires embeddings. For unknown languages:
- Source language embeddings: YES (Greek/Hebrew/English are known)
- Target language embeddings: NO (unknown tokens)

**Recommendation**: Use for source-anchored similarity only.

#### 6. MMRDiversityRanker - Diversity in Results
**Source**: `packages/agentdb/src/controllers/MMRDiversityRanker.ts`

```typescript
// MMR formula (from code)
MMR = λ * relevance(doc, query) - (1-λ) * similarity(doc, selected)
```

**Reusable for Codex**: YES - Prevents selecting 5 examples from Genesis 1:1-5 when translating Genesis 1:6.

---

## Part 5: Reusable Code from AgentDB

### Directly Reusable Files/Functions

| File | Function/Class | Purpose | Adaptation Level |
|------|---------------|---------|------------------|
| `EmbeddingService.ts` | `EmbeddingService` | Generate embeddings | Low - use for source text |
| `HNSWIndex.ts` | `HNSWIndex` | Vector search | Medium - source-only index |
| `MMRDiversityRanker.ts` | `rerank()` | Diversity scoring | Low - use as-is |
| `db-fallback.ts` | SQLite WASM wrapper | Browser-safe SQLite | Low - use for storage |

### Code Patterns to Adopt (Not Copy)

| Pattern | Source File | How to Apply |
|---------|-------------|--------------|
| Episode recording | `ReflexionMemory.ts` | Track translation attempts |
| Skill scoring formula | `SkillLibrary.ts` | Rank examples by effectiveness |
| Batch processing | `NightlyLearner.ts` | Extract patterns periodically |
| Graceful fallback | `WASMVectorSearch.ts` | JS fallback when WASM fails |

### Code to NOT Reuse

| Component | Reason |
|-----------|--------|
| GNN enhancement | Requires working embeddings |
| Causal experiments | Over-engineered for translation |
| RL algorithms | Unnecessary complexity |
| QUIC networking | Not needed for local learning |
| Raft consensus | Single-user context |

---

## Part 6: Reusable Dependencies

### From AgentDB package.json

| Dependency | Version | Purpose | Should Use |
|------------|---------|---------|------------|
| `@xenova/transformers` | 2.17.2 | Embeddings | YES - for source text |
| `sql.js` | 1.13.0 | SQLite WASM | YES - browser-safe storage |
| `better-sqlite3` | 11.8.1 | Native SQLite | OPTIONAL - for Node.js |
| `hnswlib-node` | 3.0.0 | Vector search | YES - for source index |
| `zod` | 3.25.76 | Schema validation | YES - type safety |

### Dependencies to SKIP

| Dependency | Reason |
|------------|--------|
| `@ruvector/gnn` | Requires Rust compilation, embeddings |
| `@ruvector/attention` | Over-engineered for our use |
| Commander/Inquirer | CLI tools not needed |
| MCP SDK | Model Context Protocol not relevant |

---

## Part 7: RuVector (Rust Layer) Analysis

### Architecture Overview

RuVector is a Rust monorepo with 34 crates:
- **Core**: `ruvector-core` - HNSW index, distance metrics, SIMD
- **GNN**: `ruvector-gnn` - Graph neural network training
- **Attention**: `ruvector-attention` - 39 attention mechanisms
- **Graph**: `ruvector-graph` - Cypher query support

### What RuVector Actually Provides (from code)

| Crate | Actual Implementation | Codex Relevance |
|-------|----------------------|-----------------|
| `ruvector-core` | HNSW with SIMD, distance metrics | LOW - hnswlib-node sufficient |
| `ruvector-gnn` | Adam optimizer, EWC, replay buffer | LOW - embeddings won't work |
| `ruvector-attention` | Multi-head attention, hyperbolic | LOW - not needed |
| `ruvector-graph` | Cypher parser, graph traversal | LOW - not using graph queries |

### Rust Layer Recommendation

**Do NOT use RuVector for Codex.**

Reasons:
1. **Compilation Complexity**: Requires Rust toolchain, WASM builds
2. **Overkill**: Most features assume working embeddings
3. **Maintenance Burden**: Rust compilation issues across platforms
4. **Alternative Available**: `hnswlib-node` provides 80% of value with 10% complexity

---

## Part 8: Recommended Architecture Decisions

### Decisions to Adopt from AgentDB

| Decision | AgentDB Implementation | Codex Adaptation |
|----------|----------------------|------------------|
| **Episode-centric storage** | SQLite tables | SQLite tables in translation memory |
| **Composite scoring** | 40/30/10/20 weighting | Adjust weights for translation |
| **Graceful fallback** | WASM → JS | Learning → Token overlap |
| **Batch pattern extraction** | NightlyLearner | Background pattern job |
| **Diversity ranking** | MMR algorithm | Prevent example clustering |

### Decisions to AVOID from AgentDB

| Decision | AgentDB Implementation | Why Avoid |
|----------|----------------------|-----------|
| **Graph database** | RuVector Cypher | Adds complexity, not needed |
| **GNN enhancement** | @ruvector/gnn | Requires working embeddings |
| **Causal experiments** | A/B test infrastructure | Existing A/B system sufficient |
| **RL algorithms** | 9 policy optimizers | Overkill for translation |

### Alternative Approaches to Consider

| AgentDB Approach | Alternative | Pros | Cons |
|------------------|-------------|------|------|
| Semantic embeddings | Source-only embeddings | Works for unknown targets | Less semantic for target |
| GNN reranking | Historical effectiveness | No training needed | No semantic enhancement |
| Causal discovery | Simple A/B tracking | Much simpler | Less statistically rigorous |
| Skill library | Pattern extraction | Tailored to translation | Needs custom implementation |

---

## Part 9: Implementation Recommendation

### Phase 1: Minimal Viable Learning (2 new tables)

```sql
-- Track translation episodes
CREATE TABLE translation_episodes (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL,
  source_content TEXT NOT NULL,
  examples_used TEXT NOT NULL,  -- JSON array
  llm_prediction TEXT NOT NULL,
  user_final_edit TEXT,
  edit_distance REAL,
  timestamp INTEGER NOT NULL
);

-- Track example effectiveness
CREATE TABLE example_effectiveness (
  example_cell_id TEXT NOT NULL,
  used_for_cell_id TEXT NOT NULL,
  edit_distance REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (example_cell_id, used_for_cell_id, timestamp)
);
```

### Phase 2: Enhanced Ranking

Modify `fetchFewShotExamples()` in `shared.ts`:

```typescript
// Add effectiveness to ranking
const effectivenessScore = await getExampleEffectiveness(pair.cellId);
const finalScore =
  overlapRatio * 0.35 +           // Keep token overlap
  effectivenessScore * 0.40 +     // Add historical effectiveness
  recencyScore * 0.15 +           // Recent translations
  diversityScore * 0.10;          // Prevent clustering (MMR)
```

### Phase 3: Pattern Extraction

Add background job to extract word mappings from high-quality episodes.

### Dependencies to Add

```json
{
  "dependencies": {
    "sql.js": "^1.13.0",           // From AgentDB - WASM SQLite
    "@xenova/transformers": "^2.17.2"  // From AgentDB - source embeddings
  }
}
```

---

## Summary Table: What to Reuse

| Category | Reuse Level | Specific Items |
|----------|-------------|----------------|
| **Architecture** | HIGH | Episode storage, composite scoring, graceful fallback |
| **Code** | MEDIUM | MMRDiversityRanker, db-fallback pattern, scoring formula |
| **Dependencies** | LOW | sql.js, @xenova/transformers, hnswlib-node |
| **Rust/RuVector** | NONE | Too complex, assumes working embeddings |

