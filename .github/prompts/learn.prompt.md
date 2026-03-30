---
name: "learn"
description: "Extract reusable patterns, preferences, or corrections from the current session and persist them for future use."
agent: "knowledge-curator"
argument-hint: "Describe what was learned or the pattern to capture"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Review the current session transcript for reusable patterns, corrections, or preferences.
2. Check existing instructions, skills, and memory notes for overlap or conflicts.
3. Persist each learning in the most appropriate location:
   - **Session-only** → `.github/sessions/` or `/memories/session/`
   - **Repo-scoped** → `/memories/repo/`
   - **Project-wide** → `.github/instructions/` (if broadly applicable)
   - **Searchable knowledge** → Run `node scripts/hooks/learn-embed.js --source <source> --kind <kind> --content "<text>"` to store the learning in SQLite with a vector embedding for semantic search.
4. Write concise, actionable entries — avoid prose or excessive context.
5. Report what was captured and where, plus any conflicts found.
