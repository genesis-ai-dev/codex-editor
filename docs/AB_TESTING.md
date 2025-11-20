# A/B Testing (Overview)

A/B testing in Codex shows two translation suggestions side‑by‑side once in a while so you can pick the better one. This helps us learn which retrieval and prompting strategies work best without slowing you down.

## How it works
- Triggering: Tests run at random with a small probability (default 15%).
- Variants: When triggered, two candidates are generated in parallel.
- Auto‑apply: If the two results are effectively identical, we apply one automatically and no modal is shown.
- Choosing: If they differ, a simple chooser appears; click the option that reads best. Dismissing the modal after choosing just closes it.
- Frequency control: In the chooser, “See less/See more” nudges how often you’ll be asked in the future.

## What’s being compared
- Search algorithm for few‑shot retrieval: `fts5-bm25` vs `sbs`.
- Few‑shot example format: `source-and-target` vs `target-only`.
(Model comparisons are disabled by default.)

## Settings
- `codex-editor-extension.abTestingEnabled`: turn A/B testing on/off.
- `codex-editor-extension.abTestingProbability`: probability (0–1) for running a true A/B test. Default: `0.15` (15%).

Change these in VS Code Settings → Extensions → Codex Editor.

## Results & privacy
- Local log: Each choice is appended to `files/ab-test-results.jsonl` in your workspace (newline‑delimited JSON).
- Win rates: The editor may compute simple win‑rates by variant label and show them in the chooser.
- Network: If analytics posting is enabled in code, the extension may attempt to send anonymized A/B summaries to a configured endpoint. If your environment blocks network access, the extension continues without error.

## Disable A/B testing
- Set `codex-editor-extension.abTestingEnabled` to `false`, or
- Set `codex-editor-extension.abTestingProbability` to `0`.

## Developer pointers (optional)
- Registry and helpers: `src/utils/abTestingRegistry.ts`, `src/utils/abTestingSetup.ts`.
- Completion flow: `src/providers/translationSuggestions/llmCompletion.ts`.
- Provider ↔ webview messaging: `src/providers/codexCellEditorProvider/*`.
- Webview UI: `webviews/codex-webviews/src/CodexCellEditor/components/ABTestVariantSelector.tsx`.
- Storage/analytics helpers: `src/utils/abTestingUtils.ts`, `src/utils/abTestingAnalytics.ts`.

That’s it — short and simple. If anything here is unclear, feel free to refine this page.
