---
name: "Compatibility Surface Guidelines"
description: "Use when editing compatibility directories for Codex CLI and OpenCode."
applyTo: ".codex/**,.opencode/**"
---

# Compatibility Surface Guidelines

- `.codex/` and `.opencode/` are maintained compatibility surfaces, not the active GitHub Copilot source of truth.
- `.github/` is the canonical source. These directories mirror or adapt `.github/` guidance for their respective harnesses.
- Before adding new behavior here, decide whether the active implementation belongs under `.github/` instead.
- `.codex/` ships with project setup and is validated by CI. Keep its config, agents, and AGENTS.md consistent with the `.github/` baseline.
- Avoid expanding legacy-only orchestration, session persistence, or semantic-skill-first patterns.