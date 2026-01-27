# Self-Learning Loop for Codex: Project Handoff Summary

**Date**: December 2024
**Branch**: `claude/codex-self-learning-loop-01SfKRshCdcc4h6RZZYmtkWm`

---

## Mission Statement

> "Every edit a translator makes should make the system smarter. After 1000 verses, the system should predict with 90%+ accuracy. After one book, it should feel like the AI 'knows' this language."

The goal is to build a self-learning translation assistance system that:
1. Records every prediction and user edit
2. Learns which examples lead to good predictions
3. Extracts word mappings and correction patterns
4. Improves over time without forgetting

**Why this matters**: Bible translators are bringing Scripture to languages that have never had written literature. These are ultra-low-resource languages not in any LLM's training data. Every improvement in prediction accuracy saves thousands of hours of work across hundreds of translation projects.

---

## Documents Created

| Document | Purpose |
|----------|---------|
| [self-learning-loop-architecture.md](./self-learning-loop-architecture.md) | Original comprehensive architecture based on AgentDB analysis |
| [agentdb-reuse-analysis.md](./agentdb-reuse-analysis.md) | Deep code-level analysis of AgentDB features and reusability |
| [translation-memory-evaluation.md](./translation-memory-evaluation.md) | Current system analysis + source-anchored improvement proposals |
| [ruvector-crate-analysis.md](./ruvector-crate-analysis.md) | Analysis of 34 Rust crates (125K lines) in RuVector ecosystem |
| [simpler-approach.md](./simpler-approach.md) | Simple counting-based alternative (~3 hours to implement) |
| [state-of-the-art-architecture.md](./state-of-the-art-architecture.md) | **RECOMMENDED**: Full state-of-the-art design combining best ideas |
| [phase1-implementation-spec.md](./phase1-implementation-spec.md) | Detailed Phase 1 implementation with exact code changes |

---

## User's Goals

1. **Build a self-learning loop** into Codex's translation copilot
2. **Learn from every user interaction** - predictions and edits
3. **Handle ultra-low-resource languages** where embeddings for the target language don't exist
4. **Leverage source language assets** (Strong's numbers, morphology, multiple source versions)
5. **Create state-of-the-art solution** - willing to add complexity if it helps
6. **Prioritize translator productivity** over implementation simplicity

---

## Analysis Journey

### Step 1: AgentDB Analysis
Analyzed the AgentDB repository (an AI agent memory system). Found useful patterns:
- **ReflexionMemory**: Records episodes with outcomes
- **SkillLibrary**: Clusters similar patterns
- **Composite Scoring**: Combines multiple signals
- **Graceful Fallback**: Works without ML components

**Conclusion**: Good architectural inspiration, but over-engineered for translation.

### Step 2: Current System Evaluation
Analyzed Codex's current translation memory in `src/providers/translationSuggestions/shared.ts`:

**Strengths**:
- Language-agnostic (works for any target)
- Fast (O(n) token comparison)
- No external dependencies
- Works from verse 1

**Weaknesses**:
- **No semantic understanding** - "Jesus wept" doesn't match "The Lord cried"
- **No learning** - edit history stored but never used
- **No consistency** - same word might translate differently

### Step 3: Source-Anchored Insight
Key realization: We CAN'T embed the unknown target language, but we CAN embed:
- Source text (Greek, Hebrew, English)
- Strong's numbers (standardized lexicon with embeddings)
- Morphological patterns
- Cross-references

This enables semantic search without requiring target language knowledge.

### Step 4: RuVector Deep Dive
Analyzed 34 Rust crates (125,014 lines) in the RuVector ecosystem:

**Novel Features Found**:
- **MicroLoRA**: Rank 1-2 adaptation in <100μs
- **EWC (Elastic Weight Consolidation)**: Prevents forgetting
- **ReasoningBank**: K-means++ pattern clustering
- **MMR**: Maximal Marginal Relevance for diversity
- **Conformal Prediction**: Uncertainty quantification

**Conclusion**: Impressive engineering, but too complex for initial implementation.

### Step 5: Simpler Alternative
Proposed a minimal approach with just counting:
- 3 SQL tables
- 3 TypeScript functions
- No ML required
- ~3 hours to implement

User rejected this as insufficient for the mission.

### Step 6: State-of-the-Art Design
Final design combining the best ideas:
- **Source Semantic Index**: Embeddings + Strong's + HNSW
- **Episode Memory**: Full prediction/outcome tracking
- **Pattern Engine**: K-means++ clustering like ReasoningBank
- **Adaptive Ranker**: Learned weights with EWC consolidation
- **Prompt Composer**: Injects learned patterns
- **Feedback Loop**: Continuous improvement

---

## Approaches Considered

### Approach 1: Simple Counting (Rejected)
**Document**: [simpler-approach.md](./simpler-approach.md)

```
Edit Distance Tracking → Example Effectiveness Score
Word Frequency Counting → Consistent Translation Hints
Correction Tracking → Mistake Avoidance
```

**Why Rejected**: User wanted state-of-the-art, not minimum viable.

---

### Approach 2: Full RuVector Port (Not Recommended)
**Document**: [ruvector-crate-analysis.md](./ruvector-crate-analysis.md)

Would involve:
- Compiling Rust to WASM
- GNN-enhanced embeddings
- Full EWC on neural weights
- 6+ months implementation

**Why Not Recommended**: Overkill for translation. The complexity doesn't match the domain.

---

### Approach 3: Hybrid State-of-the-Art (RECOMMENDED)
**Document**: [state-of-the-art-architecture.md](./state-of-the-art-architecture.md)

Takes the best ideas from RuVector but implements them appropriately:

| Feature | Source | Adaptation |
|---------|--------|------------|
| Source embeddings | Novel | Use Strong's + multilingual models |
| HNSW index | RuVector | Standard implementation |
| MMR diversity | RuVector | Direct port |
| Episode memory | AgentDB | Simplified for translation |
| K-means++ clustering | ReasoningBank | For pattern discovery |
| EWC consolidation | RuVector | On ranking weights only, not neural nets |
| Conformal prediction | RuVector | For uncertainty quantification |

**Why Recommended**: Achieves state-of-the-art results with reasonable implementation timeline (6-8 weeks).

---

## Key Technical Decisions

### 1. Source-Anchored Embeddings
**Decision**: Embed source language, not target

**Why**: Target language is unknown (first literature ever). Source (Greek/Hebrew/English) is known and has embeddings.

**Implementation**: Hybrid embedding = text embedding + Strong's embedding + morphology encoding

---

### 2. Episode-Based Learning
**Decision**: Record every prediction with full context and outcome

**Why**:
- Enables computing example effectiveness
- Allows pattern extraction
- Provides data for future improvements
- Makes the system debuggable

---

### 3. EWC on Ranking Weights
**Decision**: Use EWC to prevent forgetting, but only on ranking weights (7 numbers), not neural network weights

**Why**:
- Full EWC on neural nets requires complex infrastructure
- Ranking weights are simple (7 floats)
- Still prevents catastrophic forgetting
- Much simpler to implement

---

### 4. Phased Implementation
**Decision**: 4-phase rollout over 8 weeks

**Why**:
- Get value early (Phase 1 alone helps)
- Measure before adding complexity
- Allows course correction
- Reduces risk

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
**Document**: [phase1-implementation-spec.md](./phase1-implementation-spec.md)

- Episode recording
- Effectiveness tracking
- Word mapping extraction
- Pattern injection into prompts

**Expected Outcome**: Edit distance should decrease after ~50 verses.

### Phase 2: Semantic Layer (Weeks 3-4)
- Strong's number integration
- Source text embeddings
- HNSW index
- MMR for diversity

**Expected Outcome**: Find semantically similar verses even with no word overlap.

### Phase 3: Advanced Patterns (Weeks 5-6)
- Correction pattern tracking
- K-means++ clustering
- Style preference learning

**Expected Outcome**: System learns translator's style and common LLM mistakes.

### Phase 4: Adaptive Learning (Weeks 7-8)
- Learnable ranking weights
- EWC consolidation
- Uncertainty quantification
- Auto-accept thresholds

**Expected Outcome**: System adapts its ranking strategy to this specific project.

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Perfect Predictions | 30%+ | `edit_distance = 0` |
| Minor Edits | 50%+ | `edit_distance < 0.1` |
| Word Consistency | 90%+ | Same source word → same translation |
| Time to Accept | Decreasing | Track milliseconds |
| Learning Curve | Visible | Plot edit distance vs verse count |

---

## File Locations for Implementation

| Component | Location |
|-----------|----------|
| Learning Engine | `src/providers/translationSuggestions/learningEngine/` (new) |
| Enhanced Ranking | `src/providers/translationSuggestions/shared.ts` (modify) |
| Episode Recording | `src/providers/translationSuggestions/llmCompletion.ts` (modify) |
| Outcome Recording | `src/providers/codexCellEditorProvider/codexDocument.ts` (modify) |
| Database | `.codex/learning.db` (new, per project) |

---

## Dependencies to Add

```json
{
  "dependencies": {
    "sqlite3": "^5.1.6",
    "uuid": "^9.0.0"
  },
  "optionalDependencies": {
    "@xenova/transformers": "^2.x"  // For Phase 2 embeddings
  }
}
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Performance impact | Async recording, batch queries, caching |
| Database bloat | Prune old episodes, summarize patterns |
| Incorrect patterns | Require minimum count (2+) before using |
| Catastrophic forgetting | EWC consolidation on ranking weights |
| Cold start | Works with token overlap until learning kicks in |

---

## Next Steps

1. **Review this architecture** with the team
2. **Create feature branch** for Phase 1 implementation
3. **Implement database schema** (Day 1)
4. **Implement episode recording** (Days 2-3)
5. **Integrate with existing flow** (Days 4-7)
6. **Test with real translations** (Days 8-10)
7. **Measure baseline metrics** before/after

---

## Contact

For questions about this design, refer to:
- The detailed documents linked above
- The commit history on branch `claude/codex-self-learning-loop-01SfKRshCdcc4h6RZZYmtkWm`
- The code comments in Phase 1 implementation spec

---

## Appendix: Why Not Just Use...?

### Why not just use fine-tuning?
- Target language has no training data
- Would need to fine-tune per project
- Expensive and slow
- Can't adapt in real-time

### Why not just use RAG?
- We are using RAG (few-shot examples)
- This system makes RAG better
- Learns which examples work

### Why not just use GPT-4?
- Already using LLMs
- This system makes LLM predictions better
- Adapts to specific translator's style

### Why not just wait for better models?
- Ultra-low-resource languages won't be in training data
- Learning from human feedback is always valuable
- Time saved now helps real translators
