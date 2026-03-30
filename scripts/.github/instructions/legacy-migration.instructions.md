---
name: "Legacy Migration Inputs"
description: "Use when editing legacy compatibility directories."
applyTo: ".codex/**,.opencode/**"
---

# Legacy Migration Inputs

- These paths are compatibility surfaces, not the active GitHub Copilot source of truth.
- Before adding new behavior here, decide whether the active implementation belongs under `.github` instead.
- Avoid expanding legacy-only orchestration, session persistence, or semantic-skill-first patterns.