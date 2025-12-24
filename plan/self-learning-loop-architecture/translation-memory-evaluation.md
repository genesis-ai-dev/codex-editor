# Translation Memory Evaluation: Current State and Source-Anchored Improvements

## Executive Summary

The current translation memory system uses **token overlap** for similarity matching. This works but misses semantic relationships. The key insight: **we can't embed the target language (unknown), but we CAN embed the source language** (Greek/Hebrew/English). This document proposes source-anchored improvements that leverage available assets.

---

## Part 1: Current System Deep Analysis

### Implementation Location

**Primary File**: `src/providers/translationSuggestions/shared.ts`

```typescript
// Lines 76-101: The core ranking algorithm
const rankedPairs = similarSourceCells
  .filter(pair => /* validity checks */)
  .map(pair => {
    const pairTokens = tokenizeText({
      method: "whitespace_and_punctuation",
      text: pairSourceContentSanitized
    });

    // Core similarity calculation
    const overlapCount = currentTokens.filter(t => pairTokens.includes(t)).length;
    const overlapRatio = overlapCount / currentTokens.length;

    return { pair, overlapRatio, overlapCount };
  })
  .sort((a, b) => b.overlapRatio - a.overlapRatio);
```

### How It Works (Step by Step)

1. **Query**: Source verse content (e.g., "In the beginning God created the heavens and the earth")
2. **Search**: FTS5 full-text search with BM25 ranking returns 100+ candidates
3. **Filter**: Remove incomplete pairs (missing source or target)
4. **Tokenize**: Split query into tokens using whitespace and punctuation
5. **Score**: Count how many query tokens appear in each candidate
6. **Rank**: Sort by overlap ratio (matched tokens / total tokens)
7. **Return**: Top N results as few-shot examples

### Data Flow Diagram

```
User clicks sparkle
        │
        ▼
┌─────────────────────────────────────┐
│  fetchFewShotExamples()             │
│  - Query: sourceContent             │
│  - Limit: numberOfFewShotExamples   │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  vscode.commands.executeCommand     │
│  "getTranslationPairsFromSource     │
│   CellQuery"                        │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  SQLite FTS5 Search                 │
│  - BM25 scoring                     │
│  - N-gram fuzzy matching            │
│  - Returns 100+ candidates          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Token Overlap Ranking              │
│  - Tokenize query                   │
│  - Count matches per candidate      │
│  - Sort by overlap ratio            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Top N examples → LLM prompt        │
└─────────────────────────────────────┘
```

---

## Part 2: Strengths of Current System

### ✅ 1. Language-Agnostic
Works for ANY language without training or configuration.

```typescript
// No language-specific logic - pure string matching
const overlapCount = currentTokens.filter(t => pairTokens.includes(t)).length;
```

**Why this matters**: Ultra-low-resource languages have no pre-trained models.

### ✅ 2. Fast and Deterministic
O(n) comparison per candidate. Same input always produces same output.

### ✅ 3. No External Dependencies
Pure TypeScript, no embedding models, no GPU, no API calls.

### ✅ 4. Cold Start Friendly
Works from verse 1. No minimum training data required.

### ✅ 5. Interpretable
"This verse matched because it contains 7 of 10 words from your query."

### ✅ 6. Resilient to Noise
Token matching is robust to minor variations.

---

## Part 3: Weaknesses of Current System

### ❌ 1. No Semantic Understanding

**Problem**: Misses synonyms, paraphrases, and related concepts.

| Query | Missed Match | Why Missed |
|-------|-------------|------------|
| "God created" | "The LORD made" | Different words, same meaning |
| "disciples" | "the twelve" | Synonym relationship |
| "spoke to the people" | "addressed the crowd" | Paraphrase |

### ❌ 2. No Grammatical Awareness

**Problem**: Treats "God" and "gods" as different tokens.

```
"God created" vs "the gods of Egypt"
→ Matches on surface, misses semantic difference
```

### ❌ 3. No Cross-Reference Awareness

**Problem**: Doesn't know that Matthew 19:4-5 quotes Genesis 2:24.

Bible has extensive intertextuality:
- Direct quotations (OT in NT)
- Allusions
- Parallel passages (Synoptic Gospels)

### ❌ 4. No Learning from Effectiveness

**Problem**: Doesn't track which examples actually helped.

```typescript
// Data stored but NEVER used for ranking
cellToUpdate.metadata.edits.push({
  editMap: EditMapUtils.value(),
  value: newContent,
  timestamp: Date.now(),
  type: editType,  // LLM_GENERATION vs USER_EDIT
  author: this._author,
});
```

### ❌ 5. No Context Awareness

**Problem**: Poetry examples used for narrative, Pauline style for John.

| Context Factor | Impact |
|---------------|--------|
| Genre | Poetry (Psalms) vs. Narrative (Kings) vs. Law (Leviticus) |
| Author | Pauline letters vs. Johannine writings |
| Testament | Hebrew OT idioms vs. Greek NT constructions |

### ❌ 6. Recency Blindness

**Problem**: Old, possibly incorrect translations weighted same as recent validated ones.

---

## Part 4: Available Assets for Improvement

### Asset 1: Strong's Numbers

**What they are**: Standardized lexicon entries for Greek (G0001-G5624) and Hebrew (H0001-H8674) words.

**Data Available**:
- King James Version with Strong's numbers (from ebibleCorpusUtils.ts line 24351)
- Matupi Chin Standard Bible with Strong's (line 28935)

**Example**:
```
"In the beginning God created"
→ H7225 (rēʾšîṯ - beginning)
→ H0430 (ʾĕlōhîm - God)
→ H1254 (bārāʾ - created)
```

**Similarity Insight**: Verses sharing Strong's numbers discuss the same concepts regardless of surface words.

### Asset 2: Macula Bible with Morphological Annotations

**Source**: `https://github.com/genesis-ai-dev/hebrew-greek-bible`

**Data Available**:
- Hebrew (OT) and Greek (NT) original texts
- Morphological annotations (part of speech, tense, person, number)
- Lemmatization (root forms)

**Example**:
```
λέγω (legō) - present active indicative
εἶπεν (eipen) - aorist active indicative
→ Same lemma despite different surface forms
```

### Asset 3: Multiple Source Versions

**From types/index.d.ts**:
```typescript
type SourceCellVersions = {
    cellId: string;
    content: string;
    versions: string[];  // Multiple versions available
    notebookId: string;
};
```

**Potential Sources**:
- Greek/Hebrew original
- English translations (ESV, NIV, NASB, etc.)
- Back-translations from other projects

### Asset 4: Edit History with Types

**From codexDocument.ts**:
```typescript
interface EditHistoryItem {
  value: string;
  timestamp: number;
  type: EditType;  // LLM_GENERATION | USER_EDIT | ...
  author: string;
  validatedBy: ValidationEntry[];
}
```

**Insight**: Can compute edit distance between LLM prediction and user's final edit.

---

## Part 5: Proposed Source-Anchored Improvements

### Proposal 1: Strong's Number Similarity

**Concept**: Find verses that share Strong's numbers regardless of surface text.

```typescript
interface StrongsProfile {
  verseId: string;
  strongsNumbers: string[];  // ["H7225", "H0430", "H1254"]
}

function strongsSimilarity(verse1: StrongsProfile, verse2: StrongsProfile): number {
  const set1 = new Set(verse1.strongsNumbers);
  const set2 = new Set(verse2.strongsNumbers);

  const intersection = [...set1].filter(s => set2.has(s)).length;
  const union = new Set([...set1, ...set2]).size;

  return intersection / union;  // Jaccard similarity
}
```

**Benefits**:
- "God created" matches "The LORD made" (same Strong's H0430, H1254 roots)
- Language-independent semantic matching
- Pre-computed, no runtime embedding

**Challenges**:
- Requires Strong's data integration
- Not all sources have Strong's tagging
- Some words have multiple Strong's mappings

### Proposal 2: Source Text Embeddings

**Concept**: Embed the source language (known) and use for similarity.

```typescript
// Source languages ARE known - embeddings work!
const sourceEmbedding = await embed(sourceContent);  // Greek/Hebrew/English

// Search for semantically similar source content
const similarSources = await vectorSearch(sourceEmbedding, 'source_embeddings');

// Their target translations are relevant examples
return similarSources.map(s => getTranslationPair(s.cellId));
```

**Benefits**:
- Semantic understanding for source text
- Captures synonyms, paraphrases
- Standard embedding models work for Greek/Hebrew/English

**Challenges**:
- Requires embedding generation for all source content
- Storage for embeddings (384+ dimensions per verse)
- Doesn't directly understand target language patterns

### Proposal 3: Lemmatized Source Matching

**Concept**: Match on root word forms, not surface forms.

```typescript
// Original: "God created", "The LORD made", "gods make"
// Lemmatized: ["god", "create"], ["lord", "make"], ["god", "make"]

function lemmatizedSimilarity(query: string[], candidate: string[]): number {
  // Use morphological data to get root forms
  const queryLemmas = query.map(toLemma);
  const candidateLemmas = candidate.map(toLemma);

  return jaccardSimilarity(queryLemmas, candidateLemmas);
}
```

**Benefits**:
- "created" matches "create", "creating", "creates"
- "God" matches "gods" when appropriate
- Uses Macula morphological data

**Challenges**:
- Requires morphological data pipeline
- Hebrew/Greek specific

### Proposal 4: Cross-Reference Graph

**Concept**: Use known Bible cross-references as similarity edges.

```
Matthew 19:4-5 ←quotes→ Genesis 2:24
John 1:1 ←alludes to→ Genesis 1:1
Synoptic parallels: Matt 3:1-12 ↔ Mark 1:1-8 ↔ Luke 3:1-18
```

**Benefits**:
- Theologically informed similarity
- Captures intentional intertextuality
- High-quality, curated relationships

**Challenges**:
- Requires cross-reference database
- Limited to known references

### Proposal 5: Hybrid Ranking Formula

**Concept**: Combine multiple signals with learned weights.

```typescript
function hybridScore(
  query: SourceContent,
  candidate: TranslationPair
): number {
  return (
    tokenOverlapScore(query, candidate) * 0.25 +      // Current system
    strongsSimilarity(query, candidate) * 0.25 +      // Strong's numbers
    sourceEmbeddingSimilarity(query, candidate) * 0.20 + // Embeddings
    historicalEffectiveness(candidate) * 0.15 +       // Learning loop
    contextMatch(query, candidate) * 0.10 +           // Genre/book
    recencyBonus(candidate) * 0.05                    // Recent = better
  );
}
```

**Benefits**:
- Best of all approaches
- Graceful degradation (missing signals → 0)
- Weights can be tuned per project

---

## Part 6: Comparison Matrix

| Approach | Semantic | Language-Agnostic | Cold Start | Learning | Complexity |
|----------|----------|-------------------|------------|----------|------------|
| **Current (Token)** | ❌ | ✅ | ✅ | ❌ | Low |
| **Strong's Numbers** | ✅ | ✅ | ✅ | ❌ | Medium |
| **Source Embeddings** | ✅ | ⚠️ (source only) | ✅ | ❌ | Medium |
| **Lemmatized** | ⚠️ | ⚠️ | ✅ | ❌ | Medium |
| **Cross-References** | ✅ | ✅ | ✅ | ❌ | Low |
| **Hybrid + Learning** | ✅ | ✅ | ✅ | ✅ | High |

---

## Part 7: Recommended Implementation Path

### Phase 1: Source Embeddings (High Impact, Medium Effort)

**Why first**: Standard models work, immediate semantic improvement.

```typescript
// Add to sqliteIndex.ts schema
CREATE TABLE source_embeddings (
  cell_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,  -- 384 dimensions as Float32Array
  model TEXT NOT NULL,      -- 'all-MiniLM-L6-v2'
  created_at INTEGER NOT NULL
);
```

**Implementation**:
1. On source import, generate embeddings using `@xenova/transformers`
2. Store in SQLite as BLOB
3. At query time, embed query and cosine similarity search
4. Blend with token overlap: `0.6 * embedding + 0.4 * token`

### Phase 2: Strong's Number Integration (High Impact, High Effort)

**Why second**: Requires data pipeline, but adds deep semantic understanding.

```typescript
// New tables
CREATE TABLE strongs_mapping (
  cell_id TEXT NOT NULL,
  strongs_number TEXT NOT NULL,
  word_position INTEGER NOT NULL,
  PRIMARY KEY (cell_id, strongs_number, word_position)
);

CREATE TABLE strongs_embeddings (
  strongs_number TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  definition TEXT
);
```

**Implementation**:
1. Parse Strong's data from KJV+ or similar tagged source
2. Pre-compute Strong's number embeddings (definitions are in English)
3. At query time, find matching Strong's numbers
4. Add to hybrid score

### Phase 3: Historical Effectiveness (Medium Impact, Low Effort)

**Why third**: Builds on existing edit history data.

```typescript
// Add to existing schema
CREATE TABLE example_effectiveness (
  example_cell_id TEXT NOT NULL,
  target_cell_id TEXT NOT NULL,
  edit_distance REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (example_cell_id, target_cell_id, timestamp)
);
```

**Implementation**:
1. After LLM prediction, record which examples were used
2. After user edit, compute edit distance
3. Build effectiveness score per example
4. Add to hybrid ranking

### Phase 4: Full Hybrid System

Combine all signals with configurable weights.

---

## Part 8: Expected Improvements

### Quantitative Estimates

| Metric | Current | With Improvements | Source |
|--------|---------|-------------------|--------|
| Semantic matches | ~40% | ~75% | Source embeddings |
| Root word matches | ~60% | ~85% | Strong's/lemmas |
| Cross-reference awareness | 0% | ~100% | Reference graph |
| Learning improvement | None | 10-15% over time | Effectiveness tracking |

### Qualitative Improvements

1. **Better Poetry Matches**: Psalms uses different vocabulary but same concepts
2. **Synoptic Gospel Alignment**: Parallel passages properly connected
3. **Doctrinal Consistency**: Same theological concepts matched across books
4. **Translator Preference Capture**: System learns team's vocabulary choices

---

## Part 9: Risk Analysis

### Risk 1: Embedding Quality for Ancient Languages

**Risk**: Hebrew/Greek embeddings may not be as good as English.

**Mitigation**: Use English translations as embedding source, or use multilingual models (mBERT, XLM-RoBERTa).

### Risk 2: Strong's Data Availability

**Risk**: Not all source texts have Strong's tagging.

**Mitigation**: Graceful degradation to other signals when Strong's unavailable.

### Risk 3: Cold Start for Learning Loop

**Risk**: New projects have no historical effectiveness data.

**Mitigation**: Default to non-learning signals until data accumulates.

### Risk 4: Performance Impact

**Risk**: Embedding search may be slower than token matching.

**Mitigation**: Pre-compute embeddings, use HNSW index for approximate search.

---

## Summary

| Current State | Proposed State |
|---------------|----------------|
| Token overlap only | Hybrid multi-signal |
| No semantic understanding | Source embeddings + Strong's |
| No learning | Effectiveness tracking |
| No context awareness | Genre/book matching |
| Language-agnostic | Language-agnostic + source-aware |

**Key Insight**: The target language is unknown, but the **source language is known**. All improvements should anchor on the source.

