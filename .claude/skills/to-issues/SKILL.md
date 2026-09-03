---
name: to-issues
description: Write a GitHub issue in chat, ready to copy, using this repo's issue templates (Task, Feature Request, or Bug Report). Use this whenever the user asks for a ticket, issue, task, bug report, or feature request to be written up — including when they paste a partner report, error description, or idea and want it turned into an issue, or say things like "make a ticket for this", "write this up as an issue", or "turn this into a bug report".
---

# Writing an issue from the repo templates

The goal: produce a complete issue the user can paste straight into GitHub. Write it **in the chat**, not as a file, and do not create the issue on GitHub unless the user explicitly asks.

## Step 1: Pick the right template

The templates live in `.github/ISSUE_TEMPLATE/`. Pick one and read it before writing, so the output always matches the current version of the template:

- **`bug-report.md`** — something is broken, wrong, or slower than it used to be. If a user or partner is reporting a problem with existing behavior, it's a bug.
- **`feature-request.md`** — a new capability or an improvement to how something works.
- **`task.md`** — everything else: investigations, chores, upgrades, data fixes, refactors. When a problem is reported but the cause is unknown and the first job is to investigate, a Task is often a better fit than a Bug — use your judgment, but ask if unsure.

If the request genuinely spans two templates, always ask; mention the choice in one sentence outside the copyable block.

## Step 2: Fill it in

- Keep every heading from the template, in order. Fill each section; if there is truly nothing to say for a section, write a short honest line (e.g. "None needed") rather than deleting the heading. When a template demands something you don't have — exact steps to reproduce, timings — write what the reporter actually described, prefixed with an honest caveat like "exact steps not confirmed yet", instead of inventing details or leaving the section empty.
- Start with a title line using the prefix from the template's frontmatter (`Task: `, `Bug: `, `Feature: `) followed by a short description.
- Only include facts you actually have. Don't invent steps to reproduce, version numbers, or causes. If the cause is unknown, make "find the cause" part of the work, and phrase suspicions as things to rule in or out, not conclusions.
- Acceptance Criteria are observable outcomes ("the page loads in under 2 seconds"), not implementation steps. Test Checklist items are things a person can actually go and verify, ideally matching one-to-one with how the reporter would confirm the problem is gone.
- If the report came from a specific person or partner, include confirming with them as a checklist item.

## Step 3: Write in simple English

These issues are read by translators, partners, and non-developers, not just the team. So:

- Use short sentences and everyday words. "The editor takes a long time to open" beats "editor initialization latency has regressed".
- Avoid jargon and internal shorthand. If a technical or internal term is unavoidable (a feature name, a file type), add a few words of plain-English explanation the first time it appears, e.g. "Sparkle (the AI translation suggestions)".
- Write for a reader who was not in this conversation: no "as discussed above", no unexplained codenames, no abbreviations the reader may not know.

## Step 4: Output

Put the finished issue in one fenced markdown code block so it can be copied in a single click, with the title as the first line. Any commentary (template choice, things you left out, open questions) goes in a sentence or two outside the block.
