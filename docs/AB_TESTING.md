# A/B Testing (Overview)

A/B testing in Codex shows two translation suggestions side‑by‑side once in a while so you can pick the better one. This helps us learn which retrieval and prompting strategies work best without slowing you down.

## How it works
- Triggering: Tests run at random with a hardcoded probability of 1% (1 in 100). This is defined by `AB_TEST_PROBABILITY` in `src/utils/abTestingRegistry.ts`.
- Variants: When triggered, two candidates are generated in parallel.
- Auto‑apply: If the two results are effectively identical, we apply one automatically and no modal is shown.
- Choosing: If they differ, a simple chooser appears; click the option that reads best. Dismissing the modal after choosing just closes it.

## What’s being compared
- Search algorithm for few‑shot retrieval: `fts5-bm25` vs `sbs`.
- Few‑shot example format: `source-and-target` vs `target-only`.
(Model comparisons are disabled by default.)

## Results & privacy
- Local log: Each choice is appended to `files/ab-test-results.jsonl` in your workspace (newline‑delimited JSON).
- Win rates: The editor may compute simple win‑rates by variant label and show them in the chooser.
- Network: If analytics posting is enabled in code, the extension may attempt to send anonymized A/B summaries to a configured endpoint. If your environment blocks network access, the extension continues without error.

## Disable A/B testing
Set `AB_TEST_PROBABILITY` to `0` in `src/utils/abTestingRegistry.ts`.

## Developer pointers (optional)
- Registry and helpers: `src/utils/abTestingRegistry.ts`, `src/utils/abTestingSetup.ts`.
- Completion flow: `src/providers/translationSuggestions/llmCompletion.ts`.
- Provider ↔ webview messaging: `src/providers/codexCellEditorProvider/*`.
- Webview UI: `webviews/codex-webviews/src/CodexCellEditor/components/ABTestVariantSelector.tsx`.
- Storage/analytics helpers: `src/utils/abTestingUtils.ts`, `src/utils/abTestingAnalytics.ts`.

That’s it — short and simple. If anything here is unclear, feel free to refine this page.
