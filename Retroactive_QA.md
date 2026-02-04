# Project Standards: Retroactive QA for Translation

## The Story

**User pain:** "I translated for three months before realizing I wasn't differentiating 2nd person singular/plural. I've validated hundreds of verses. Where do I even start fixing this?"

**Core insight:** Translation orgs need enforceable quality standards, not just style guide PDFs that translators might forget. When standards evolve or inconsistencies emerge, you need to find and fix violations across your entire project—not manually hunt through validated content.

## The Solution: Project Standards Panel

A sidebar showing two sections of quality checks:

**Organization Standards** (locked section, gray header)

- Rules set by org leadership—can't be deleted
- Can be temporarily disabled (checkbox) but reset on app restart
- Tagged with 🏢 icon
- Tooltip: "Org standards will sync from your organization's server in a future update"

**Project Standards** (editable section, blue header)

- Rules specific to this translation project
- Full control: edit, disable permanently, delete
- Tagged with 📋 icon

**Quick actions bar:**

- "Focus Mode" toggle → disables ALL standards temporarily
- "New Standard" button
- "Import from Document" button

Each standard card shows:

- Rule description in plain language
- Violation count with visual indicator (🟢 0 / 🟡 3-10 / 🔴 10+)
- Source tag (auto-generated / imported / manual / org-enforced)
- For org standards: disable checkbox only
- For project standards: edit/disable/delete controls

**User actions:**

- Click violation count → see list of offending cells across all files
- Click cell → jump directly to it for review/fix
- Click "Edit" (project only) → adjust rule, AI regenerates regex
- Click "+" → manually add check, AI helps write regex from examples
- Click "Import" → upload style guide, AI extracts rules with citations
- Toggle Focus Mode → temporarily disable everything to reduce noise

## Build Phases

### Phase 1: Manual Standards with Scope ✅

**Standard types supported:** Regex-pattern only (terminology, formatting, proper nouns)

**Deliverables:**

- Sidebar UI with org/project sections
- Mock org standards (divine names, God pronouns, Holy Spirit capitalization)
- Create/edit/delete project standards with regex patterns
- AI-assisted regex generation from examples
- Violation detection using SQLite index (efficient batch queries)
- Violation list with jump-to-cell navigation
- Focus Mode toggle to disable all checks temporarily
- Edit/disable/delete controls for project standards
- Disable-only for org standards (with tooltip about future sync)

**Example standards:**

- "Use 'LORD' (all caps) for YHWH, 'Lord' for Adonai"
- "Capitalize pronouns referring to God (He, His, Him)"
- "Capitalize 'Spirit' when referring to Holy Spirit"

**Performance features:**

- Regex compilation caching
- SQLite batch queries (avoid reading files from disk)
- Chunked processing with UI responsiveness
- Violation count caching with TTL

---

### Phase 2: Learning from Edits + Medium Complexity Standards

**New standard types:**

- `key-term-consistency`: Source word → target mapping validation
- `context-aware`: Sentence-level rules (quotation attribution, tense consistency)

**Features:**

1. **Edit pattern detection**
    - Monitor edit history for recurring changes
    - "User changed X→Y in 5 places across files"
    - Auto-suggest new standards from patterns

2. **Source-target mapping**
    - Track which source words map to which target translations
    - Flag inconsistent translations of the same source term
    - Example: "δικαιόω should always be 'justify', not 'make righteous'"

3. **Context-aware rules**
    - Quotation attribution: "When Jesus speaks, use 'Jesus said' first reference"
    - Tense consistency: "Use historical present in narrative sections"
    - Measurement conversions: "cubits → meters, denarii → day's wages"

4. **User approval workflow**
    - Review suggested standards before activation
    - Bulk approve/reject pattern-detected standards
    - Confidence scoring for suggestions

---

### Phase 3: Document Import + Advanced Standards

**New standard types:**

- `semantic`: LLM-based comprehension checks
- `back-translation`: Validation through reverse translation

**Features:**

1. **Document import**
    - Upload PDF/DOCX style guides
    - AI extracts rules with citations ("Wycliffe Style Guide p.4")
    - Batch review interface for imported standards
    - Support for multiple guide formats

2. **Semantic standards**
    - Theological precision: "Ensure 'faith' preserves trust/belief distinction"
    - Meaning drift detection: "Don't soften judgment language"
    - Requires LLM comprehension for each cell

3. **Back-translation validation**
    - Generate back-translation for suspicious cells
    - Compare against source for meaning drift
    - Flag passages where back-translation diverges significantly
    - Integration test approach: "Does this still mean what it should?"

4. **Register/tone analysis**
    - Detect stylistic shifts across books
    - "Maintain formal register in legal passages, intimate in psalms"
    - Match author styles (Paul's logical arguments vs John's declarations)

---

### Phase 4: Polish + Integration

**Features:**

1. **Health score integration**
    - Standards compliance affects project health indicators
    - Per-file and per-book compliance scores
    - Dashboard view of project-wide standard adherence

2. **Standards portability**
    - Export standards as shareable JSON
    - Import standards between projects
    - Standard templates library (common patterns)
    - Versioned org standards

3. **Org server sync**
    - Replace mock org standards with real server sync
    - Org admins manage standards centrally
    - Projects inherit org standards automatically
    - Override/extend workflow for project-specific rules

4. **AI-powered fixes**
    - Suggested corrections for violations
    - Batch fix capabilities with review
    - Learning from user corrections

5. **Reporting**
    - Compliance reports for stakeholders
    - Trend analysis over time
    - Translator-specific violation patterns

## Success Metric

Beta users find and fix 50+ consistency issues in existing validated content that they didn't know existed. PMs report feeling confident they can enforce quality without micromanaging translators.

---

_Key design principle: Make invisible quality problems visible, then make fixing them effortless. Give orgs control, give translators clarity._
