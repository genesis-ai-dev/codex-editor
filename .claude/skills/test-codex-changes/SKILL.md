---
name: test-codex-changes
description: Build, launch, and manually test a branch of the Codex Editor extension inside the Codex desktop app via computer-use, then post findings as a PR comment. Use when asked to "test this branch", "test PR #N", "try out my changes", "review this PR in the app", or similar. Covers only the non-obvious, repo-specific mechanics; you drive the UI yourself and report anything confusing, slow, broken, or counterintuitive.
---

# Test Codex Changes

## Philosophy

The value of this skill is **fresh-eyes testing**. If it told you exactly which buttons to click, you'd replay the script and miss UX problems — confusing labels, surprising modals, slow responses, missing feedback. Explore the UI yourself and report what you observe, including anything that felt awkward.

Isolate the branch under test in a worktree so the user's main tree stays untouched. If the repo has a purpose-built worktree tool (e.g. a `debug-branch.sh`), prefer it — such tools often also set up isolated user-data-dirs and window titles so parallel sessions don't collide.

## Build

From the worktree root, in order:

```bash
pnpm i
cd webviews/codex-webviews && pnpm i && cd ../..
npm run build:webviews
npx webpack --config webpack.config.js
```

Full first build is ~5 min. Webpack's `test:` sub-bundle logs a mocha *"Critical dependency"* warning — expected, not a failure. A clean build ends with `compiled successfully` for the `test-runner` config.

## Launch

The `code` CLI is not on PATH. Use the binary inside the installed app, pointed at your worktree:

```bash
/Applications/Codex.app/Contents/Resources/app/bin/codex --extensionDevelopmentPath=$(pwd) > /tmp/codex-dev-<branch>.log 2>&1 &
```

Title bar will show `[Extension Development Host]`. Process name in `ps` is `Electron`; bundle id is `com.codex`.

## Computer-use access

Request access by bundle id `com.codex`. If `request_access` returns `not_installed` the MCP's app catalog is stale — ask the user to restart the computer-use MCP server. `lsregister -f` alone won't help.

Codex loses frontmost focus every time you run a Bash call or switch tools. Before each click sequence, re-open it (`open_application` with `com.codex`). Black screenshots mean nothing granted is frontmost.

## What to test

**Always:** automatic (LLM) translation end-to-end on at least one verse — it's the core feature and the most common regression.

**Based on the diff:** look at changed files and map them to UI surfaces. Rough map:

| Path | UI |
|---|---|
| `src/smartEdits/`, `llmCompletion.ts` | automatic translation |
| `src/exportHandler/` | export flow |
| `src/providers/NewSourceUploader/` | source file import |
| `src/providers/codexCellEditorProvider/` | the main `.codex` editor (open, edit, save cells) |
| `src/projectManager/syncManager.ts` | git sync |
| `webviews/codex-webviews/src/<ViewName>/` | the webview panel of the same name |

If a change's UI impact isn't obvious from filenames, read the diff for new commands, message types, or exported functions. Still ambiguous? Ask the user. For docs/config-only diffs, say so and skip the UI pass.

**While you're in there:** poke around. A label you can't guess, a modal that asks the same question twice, an op with no loading feedback, a dialog that opens behind something — flag it. The value is your confusion, not silent success.

## Rebuilding mid-session

- `src/` changes: rerun webpack, then Cmd+R in the dev host window.
- Single-webview changes: `pnpm run build:<AppName>` from `webviews/codex-webviews/` (e.g. `build:CodexCellEditor`), then Cmd+R. `pnpm run smart-watch` in that dir rebuilds whichever view you're iterating on.

## Reporting

Take notes **as you go**, not reconstructed at the end — include timing ("took 8s with no spinner"), whether behaviour matched what the diff suggested, and what felt easy or hard.

Post findings to the PR (prefer a PR comment over pushing to the branch). Suggested structure:

- **Summary** — one sentence: did the change work?
- **What I tested** — bullet list with ✅ / ⚠️ / ❌
- **Findings** — counterintuitive, slow, or broken; include repro steps
- **Nits** — small things that aren't blockers

## Gotchas

- **Do not commit, amend, or push** unless asked — testing is read-only on the code.
- `/tmp/codex-dev-<branch>.log` captures stderr if the app crashes on launch.
- The project loaded in the dev host is whatever the user last had open. Explore what's actually there; don't assume content.
- Respect `CLAUDE.md` conventions (no `any`, <500 lines/file). If the branch violates them, note it in the PR comment.
- Leave the worktree in place when done unless asked to clean up — the user may want to poke at it.
