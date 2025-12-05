# Codex Editor

@AGENTS.md

## Critical Reminders

- **Register in package.json**: Commands, views, custom editors need `contributes` entries
- **Check subdirectory CLAUDE.md**: When editing files, read any unloaded `CLAUDE.md` in parent directories
- **Test before commit**: `npm run test && npm run lint`
- **No root docs**: Plans/summaries go to `/plan/{task-slug}/`, never root

## Self-Learning Protocol

### On Errors/Struggles
When you encounter repeated issues (file not found, lookup needed, mistakes made):
1. Identify the most relevant CLAUDE.md (root or subdirectory)
2. Add a concise, generic fix that prevents future occurrences
3. Skip one-offs; only document patterns that help significant future cases
4. Keep files short—compress, don't bloat

### On User Corrections
When user says you did something wrong or states a preference:
1. Acknowledge and fix immediately
2. Update the relevant CLAUDE.md or AGENTS.md so it won't recur
3. Be specific: add to "Common Mistakes" or create new section

### On Skill Usage
After using a skill, before session ends:
1. Review: What didn't work? What mistakes occurred?
2. Update the SKILL.md with fixes for future runs
3. Remove outdated guidance that caused confusion
