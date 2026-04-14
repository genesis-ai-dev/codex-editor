---
name: test-codex-changes
description: Build, launch, and manually test a branch of the Codex Editor extension inside the Codex desktop app via computer-use, then post findings as a PR comment. Use when asked to "test this branch", "test PR #N", "try out my changes", "review this PR in the app", or similar. The skill gives you the mechanical steps (which are not discoverable); you drive the UI yourself and report anything confusing, slow, broken, or counterintuitive.
---

# Test Codex Changes

Build a branch in its own worktree, launch the Codex Editor extension, drive the UI, and post findings to the PR.

## Philosophy

The value of this skill is **fresh-eyes testing**. If this file told you exactly which buttons to click, you'd just replay a script and miss UX problems — confusing labels, surprising modals, slow responses, missing feedback, etc. So the instructions below cover only the mechanical steps that aren't discoverable (build commands, launch flag, access grants, reporting). Once the app is running, you explore the UI yourself and report what you observe — including anything that felt awkward.

## 1. Check out the branch in a worktree

Never switch the user's main working tree. Create a worktree so their existing work stays untouched:

```bash
BRANCH=<branch-name>
WT="../codex-editor-worktrees/${BRANCH//\//_}"
git fetch origin "$BRANCH"
git worktree add "$WT" "origin/$BRANCH"
cd "$WT"
```

If a PR number was given instead of a branch, resolve it first: `gh pr view <N> --json headRefName -q .headRefName`.

If the user already has a tool for managing Codex debug worktrees (e.g. a `debug-branch.sh` in the repo), prefer that — it may also set up isolated user-data-dirs and window titles so sessions don't collide. Check for it before falling back to raw `git worktree`.

## 2. Build

Run from the worktree root. Slow — chain and show progress.

```bash
pnpm i
cd webviews/codex-webviews && pnpm i && cd ../..
npm run build:webviews
npx webpack --config webpack.config.js
```

The webpack `test:` sub-bundle logs a mocha "Critical dependency" warning — expected, not a failure. A clean build ends with `compiled successfully` for the `test-runner` config.

## 3. Launch

The `code` CLI is NOT on PATH. Use the bundled binary inside Codex.app, pointed at the worktree:

```bash
/Applications/Codex.app/Contents/Resources/app/bin/codex --extensionDevelopmentPath=$(pwd) > /tmp/codex-dev-${BRANCH//\//_}.log 2>&1 &
```

Title bar shows `[Extension Development Host]`. Process name in `ps` is `Electron`; bundle id is `com.codex`.

## 4. Grant computer-use access

```
request_access(apps=["com.codex"], reason="...")
```

If it returns `not_installed`: ask the user to restart the computer-use MCP server, then retry. `lsregister -f /Applications/Codex.app` alone is not enough — the MCP caches its app catalog at startup.

Codex loses frontmost focus every time you run a Bash call or switch tools. Before each click sequence:

```
open_application(app="com.codex")
```

Black screenshots mean nothing granted is frontmost — re-open Codex.

## 5. What to test

### Always
- **Automatic (LLM) translation** end-to-end on at least one verse. It's the core feature and the most common regression.

### Based on the diff
```bash
git log --oneline dev..HEAD
git diff --stat dev..HEAD
git diff dev..HEAD -- src/ webviews/ sharedUtils/
```

Look at the changed files and work out which UI surface they drive. Rough map:

- `src/smartEdits/`, `llmCompletion.ts` → automatic translation
- `src/exportHandler/` → export flow
- `src/providers/NewSourceUploader/` → source file import
- `src/providers/codexCellEditorProvider/` → the main `.codex` editor (open, edit, save cells)
- `src/projectManager/syncManager.ts` → git sync
- `webviews/codex-webviews/src/<ViewName>/` → the corresponding webview panel

If you can't tell what UI a change drives, read the diff more carefully — function names, added commands, and new message types usually give it away. If still ambiguous, ask the user.

### While you're in there
Poke around. If something feels off — a label you can't guess, a modal that asks the same question twice, an op with no loading feedback, a dialog that opens behind something — flag it. The value is your confusion, not silent success.

## 6. Take notes as you go

Keep a running note file in the worktree while testing — every observation in the moment, not reconstructed at the end:

```
/tmp/codex-test-notes-<branch>.md
```

For each flow record:
- What you tried
- What happened (including timing — "took 8s with no spinner")
- Whether it matched what the diff suggested should happen
- Anything easy, hard, or surprising
- Screenshot path for noteworthy moments

Save screenshots with `screenshot(save_to_disk=true)` so you can reference their paths later.

## 7. Post to the PR

Resolve the PR for the branch — prefer commenting on a PR over pushing to a branch:

```bash
gh pr list --head "$BRANCH" --json number,url,state
```

If no PR exists, tell the user and ask whether to open one or hold off.

Write the comment as markdown. Structure:

- **Summary** — one sentence: did the change work?
- **What I tested** — bullet list of flows, with ✅ / ⚠️ / ❌
- **Findings** — anything counterintuitive, slow, or broken; include reproduction steps
- **Nits** — small things you noticed that aren't blockers
- **Screenshots** — see below

Post with:

```bash
gh pr comment <N> --body-file /tmp/codex-test-comment.md
```

### Attaching screenshots

`gh` doesn't have a first-class image upload. Options, in order of preference:

1. **`gh gist create`** for the image files, then reference the raw URLs in the markdown (`![caption](raw-url)`). Works reliably, one gist per test run keeps things tidy.
2. If only a few images, inline them by uploading to an existing gist or using the repo's own `docs/` or an artifacts branch (only if the repo has that convention — check first).
3. If none of the above work, list local paths in the comment and tell the user the screenshots are on their machine at `<path>`.

Don't invent URLs. If the upload fails, say so in the comment.

## 8. Clean up

Leave the worktree in place by default — the user may want to poke at it. Tell them the path and the cleanup command:

```bash
git worktree remove <path>
```

Don't remove it yourself unless they ask.

## Rebuilding after edits mid-session

- `src/` changes: rerun webpack, then Cmd+R in the dev host window.
- Webview changes: `cd webviews/codex-webviews && pnpm run build:<AppName>` then Cmd+R. `pnpm run smart-watch` in that dir rebuilds whichever webview you're iterating on.

## Gotchas

- **Do not commit, amend, or push** unless asked. Testing is read-only on the code.
- `/tmp/codex-dev-<branch>.log` captures stderr if the app crashes on launch.
- The project loaded in the dev host is whatever the user last had open. Don't assume content; explore what's actually there.
- Respect `CLAUDE.md` conventions — no `any`, target <500 lines per file. If the branch violates these, note it in the PR comment.
