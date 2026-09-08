---
name: to-pr
description: Write a pull request title and description in chat, ready to copy, using this repo's PR template. Use this whenever the user asks for a PR description, PR summary, or pull request write-up for their branch or changes — including "write the PR for this", "make a PR description", or "get this ready for a PR". If the user asks to actually open the PR on GitHub, still use this skill to write the body first.
---

# Writing a PR description from the repo template

The goal: produce a complete PR title and description the user can paste into GitHub. Write it **in the chat**, not as a file, and do not open the PR with `gh` unless the user explicitly asks.

## Step 1: Read the template and the actual changes

- Read `.github/pull-request-template.md` so the output always matches the current version of the template.
- Describe what actually changed, not what was intended. Look at the real diff first: `git log` and `git diff` against `main` for the current branch (or whatever branch/changes the user points at). Every claim in the Summary and Changes sections should be backed by something in the diff.

## Step 2: Title and linked issue

The title is the issue number, a dash, then the issue's full title, e.g. `1147-Task: Pin pnpm version in CI and add build-script approvals (pnpm 12 breaks installs)`. Branch names in this repo usually start with the issue number, so check the branch name first; commit messages often carry it too. If you can't find an issue number in the branch name, commits, or conversation, ask the user for it rather than guessing — the Summary's `Closes #...` line depends on it.

Fetch the issue to get its exact title and its Acceptance Criteria: use `gh issue view <number>` if `gh` is available, otherwise the public API (`curl https://api.github.com/repos/genesis-ai-dev/codex-editor/issues/<number>`). If the issue can't be fetched, ask the user to paste it.

## Step 3: Fill in the template

- The template's `## PR Title` section is instructions for the title, not a heading to reproduce — GitHub keeps the title in its own field. Put the bare title on the first line of your output, then keep every remaining heading from the template (Summary, Changes, Test Checklist, Screenshots), in order.
- **Summary**: the `Closes #[number]` line, then a short plain-English description of what the change does and why.
- **Changes**: a list that mirrors the linked issue's Acceptance Criteria where possible. Each entry describes a change a reviewer can find in the diff. When the implementation deliberately deviates from an acceptance criterion, describe what actually changed and call out the deviation and its reason as its own entry — reviewers should learn about it from the PR, not discover it in the diff.
- **Test Checklist**: the template asks Claude to do the checklist itself before submitting. Take that seriously: only check `[x]` items you have actually verified (ran the build, ran the tests, exercised the feature). Leave anything unverified as `[ ]` and say plainly, outside the block, what still needs a human to check. Group with sub-headers when there are several areas, as the template shows.
- **Screenshots**: keep the section, but only note a screenshot is needed when the change is visual; otherwise write "Not needed".

## Step 4: Write in simple English

PRs here are read by reviewers with different backgrounds, so:

- Short sentences, everyday words. "Makes the editor open faster by loading the dictionary in the background" beats "defers dictionary hydration off the critical path".
- Avoid jargon and internal shorthand. When a technical term is unavoidable, add a few words of plain-English explanation the first time it appears.
- Write for a reviewer who hasn't read this conversation: no unexplained codenames or abbreviations.

## Step 5: Output

Put the finished PR description in one fenced markdown code block so it can be copied in a single click, with the title as the first line. Any commentary (unverified checklist items, missing issue number, open questions) goes in a sentence or two outside the block.
