# A Simpler Self-Learning Approach for Codex

## The Problem (Restated Simply)

1. **Example Selection**: Current system uses token overlap. It works but misses semantic similarity.
2. **No Learning**: User corrections are stored but never used to improve future predictions.
3. **Inconsistency**: Same source word might get different translations.

## The Simplest Thing That Could Work

### Approach 1: Just Track What Works

**No neural networks. No embeddings. No clustering.**

```typescript
// When LLM predicts and user edits:
interface PredictionOutcome {
  cellId: string;
  examplesUsed: string[];     // Which examples were in the prompt
  llmOutput: string;
  userFinal: string;
  editDistance: number;       // 0 = perfect, 1 = complete rewrite
}

// For each example, track:
interface ExampleStats {
  cellId: string;
  timesUsed: number;
  totalEditDistance: number;  // Sum of edit distances when this example was used
  avgEditDistance: number;    // Lower = this example helps more
}
```

**New ranking formula**:
```typescript
score = tokenOverlap * 0.5 + (1 - avgEditDistance) * 0.5
```

**That's it.** Examples that led to good predictions (low edit distance) get ranked higher.

---

### Approach 2: Learn Word Mappings

**Track what users consistently choose.**

```typescript
// When user edits, extract word-level changes
interface WordMapping {
  sourceWord: string;         // Word in source language
  targetWord: string;         // What user typed in target
  count: number;              // How many times this mapping occurred
  contexts: string[];         // Verse references for context
}

// Example data after 100 verses:
// "God" → "Mungu" (count: 87)
// "God" → "Mulungu" (count: 13)
// "LORD" → "Bwana" (count: 95)
```

**Inject into prompt**:
```
## Consistent Word Choices (from this project)
- "God" → "Mungu" (used 87 times)
- "LORD" → "Bwana" (used 95 times)
- "prophet" → "nabii" (used 23 times)
```

**No machine learning required.** Just counting.

---

### Approach 3: Track Common Corrections

**Learn what the LLM gets wrong.**

```typescript
// When user edits LLM output, compute diff
interface Correction {
  llmSaid: string;            // What LLM predicted
  userChanged: string;        // What user changed it to
  count: number;              // How often this correction happened
}

// Example after 100 verses:
// "Mungu aliiumba" → "Mungu aliumba" (count: 12)  // Grammar fix
// "siku ya kwanza" → "siku ya mwanzo" (count: 8)  // Word choice
```

**Inject into prompt**:
```
## Common Corrections (avoid these mistakes)
- Don't say "aliiumba", use "aliumba" instead
- Don't say "siku ya kwanza", use "siku ya mwanzo" for "first day"
```

**Still no ML.** Just diff tracking.

---

## Comparison: Complex vs. Simple

| Feature | RuVector Approach | Simple Approach |
|---------|------------------|-----------------|
| Example ranking | MMR + embeddings + EWC | Effectiveness score |
| Pattern learning | K-means++ clustering | Word frequency counts |
| Forgetting prevention | Elastic Weight Consolidation | N/A (no weights) |
| Implementation | 1000+ lines, Rust/WASM | 100-200 lines TypeScript |
| Dependencies | simsimd, rayon, ndarray | None |
| Cold start | Works immediately | Works immediately |
| Explainability | Black box | "This example worked 90% of the time" |

---

## Implementation: 3 Tables, 3 Functions

### Tables

```sql
-- 1. Track prediction outcomes
CREATE TABLE prediction_outcomes (
  id INTEGER PRIMARY KEY,
  cell_id TEXT NOT NULL,
  examples_used TEXT NOT NULL,  -- JSON array
  edit_distance REAL NOT NULL,
  timestamp INTEGER NOT NULL
);

-- 2. Track example effectiveness
CREATE TABLE example_effectiveness (
  cell_id TEXT PRIMARY KEY,
  times_used INTEGER DEFAULT 0,
  total_edit_distance REAL DEFAULT 0,
  avg_edit_distance REAL DEFAULT 0.5
);

-- 3. Track word mappings
CREATE TABLE word_mappings (
  source_word TEXT NOT NULL,
  target_word TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  PRIMARY KEY (source_word, target_word)
);
```

### Functions

```typescript
// 1. After LLM prediction + user edit
function recordOutcome(
  cellId: string,
  examplesUsed: string[],
  llmOutput: string,
  userFinal: string
) {
  const editDistance = levenshteinDistance(llmOutput, userFinal) / Math.max(llmOutput.length, userFinal.length);

  // Update example effectiveness
  for (const exampleId of examplesUsed) {
    db.run(`
      INSERT INTO example_effectiveness (cell_id, times_used, total_edit_distance)
      VALUES (?, 1, ?)
      ON CONFLICT(cell_id) DO UPDATE SET
        times_used = times_used + 1,
        total_edit_distance = total_edit_distance + ?,
        avg_edit_distance = (total_edit_distance + ?) / (times_used + 1)
    `, [exampleId, editDistance, editDistance, editDistance]);
  }

  // Extract and store word mappings
  extractWordMappings(sourceContent, userFinal);
}

// 2. Enhanced example ranking
function rankExamples(query: string, candidates: TranslationPair[]): TranslationPair[] {
  return candidates.map(c => {
    const tokenScore = tokenOverlap(query, c.sourceCell.content);
    const effectiveness = getEffectiveness(c.cellId); // 0-1, higher is better

    return {
      ...c,
      score: tokenScore * 0.5 + effectiveness * 0.5
    };
  }).sort((a, b) => b.score - a.score);
}

// 3. Get learned patterns for prompt
function getLearnedPatterns(sourceContent: string): string {
  const words = tokenize(sourceContent);
  const patterns = [];

  for (const word of words) {
    const mapping = db.get(`
      SELECT target_word, count FROM word_mappings
      WHERE source_word = ?
      ORDER BY count DESC
      LIMIT 1
    `, [word]);

    if (mapping && mapping.count >= 3) {
      patterns.push(`"${word}" → "${mapping.target_word}" (used ${mapping.count} times)`);
    }
  }

  return patterns.length > 0
    ? `## Consistent Word Choices\n${patterns.join('\n')}`
    : '';
}
```

---

## Why This Is Better

### 1. Interpretable
- "This example has a 0.15 average edit distance (85% accurate)"
- "Users translated 'God' as 'Mungu' 87 times"

vs. "The embedding similarity is 0.73 after GNN enhancement"

### 2. No Cold Start Problem
- Works from verse 1
- Gets better with more data
- No training phase required

### 3. Domain Appropriate
- Bible translation is consistent (same words should translate the same way)
- Simple counting captures this better than neural networks
- Translators can see and correct the learned patterns

### 4. Debuggable
- If predictions are bad, check which examples are being selected
- See the word mappings
- Adjust effectiveness scores manually if needed

### 5. Resource Efficient
- No embedding models
- No WASM compilation
- Works offline completely
- Minimal storage overhead

---

## When to Use the Complex Approach

The RuVector/AgentDB approach makes sense when:
- You have many different types of tasks
- You need to generalize across domains
- You have neural network weights to adapt
- You're building a general-purpose AI system

For Codex, the simple approach is likely **more effective**:
- Single task: translation
- Consistent domain: Bible
- Clear feedback signal: edit distance
- Human-in-the-loop: translators review everything

---

## Recommendation

**Start with the simple approach.**

1. Add the 3 tables (20 minutes)
2. Add outcome recording (30 minutes)
3. Modify `fetchFewShotExamples` to use effectiveness (30 minutes)
4. Add word mapping extraction (1 hour)
5. Inject patterns into prompt (30 minutes)

**Total: ~3 hours of implementation**

Then measure:
- Does average edit distance decrease over time?
- Are word choices more consistent?
- Do translators report better predictions?

If the simple approach doesn't work well enough, THEN consider:
- Source text embeddings (for semantic similarity)
- MMR (for diversity)
- More sophisticated pattern extraction

But don't start with complexity.

