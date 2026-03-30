# GitHub Copilot Workspace Instructions

This repository is a GitHub Copilot customization pack for VS Code. Treat `.github/` as the active configuration surface.

- Put project-wide guidance here and keep it short.
- Put path-specific behavior in `.github/instructions/*.instructions.md` with explicit `applyTo` patterns.
- Put reusable slash workflows in `.github/prompts/*.prompt.md`.
- Put persistent specialist personas in `.github/agents/*.agent.md`.
- Put deterministic automation in `.github/hooks/*.json`.

Use `.github` as the source of truth.

- Do not add new authoritative guidance outside `.github/` unless it explicitly targets a compatibility surface (e.g. `.codex/`, `.opencode/`).
- Do not make critical behavior depend on semantic skill loading alone. Important rules must be always-on or `applyTo`-scoped.
- Keep instructions terse and self-contained. Split long guidance into smaller files instead of growing this file.
- When editing prompts, agents, or instructions, keep YAML frontmatter valid and make `description` phrases explicit enough for discovery.
- Prefer prompts for repeatable single tasks and custom agents for persistent roles such as planning, TDD, review, and security review.
- Prefer deterministic validation and light hooks over heavy autonomous orchestration.

For repo changes, validate with:

```bash
npm test
npm run lint
```

When the layout changes, update CI, package metadata, and the docs that describe how Copilot should load this repository.