# GitHub Copilot Migration Status

This document tracks the current state of the repository after migration from the legacy ECC layout.

## Completed

### Repository cleanup (v2.0.0)

Legacy ECC directories and files have been removed:

- Deleted legacy root directories: `.claude`, `.cursor`, `.kiro`, `.claude-plugin`, `agents`, `commands`, `rules`, `skills`, `hooks`, `contexts`, `ecc2`, `manifests`, `plugins`, `mcp-configs`, `examples`
- Deleted root files: `CLAUDE.md`, `install.ps1`, `install.sh`, `VERSION`, `.env.example`, `SPONSORING.md`, `SPONSORS.md`
- Deleted legacy CI validators and scripts (21 JS files, 5 directories)
- Deleted legacy test directories and files
- The current `.agents/skills/` path is a new Codex compatibility bridge, not a restored legacy authoring surface

### Active Copilot structure

- `.github/copilot-instructions.md` — repository-wide instructions
- `.github/instructions/` — 71 path-specific instruction files
- `.github/prompts/` — 20 reusable slash workflows
- `.github/agents/` — 21 custom agents (4 user-visible: planner, coder, researcher, supporter; 17 internal specialists)
- `.github/hooks/deterministic-hooks.json` — deterministic edit/validation hooks
- `.github/skills/` — 120+ skill definitions (converted from legacy)

### Prompts

plan, plan-and-implement, architect, tdd, code-review, review, build-fix, fix-test, docs, e2e, typescript-review, python-review, go-review, refactor-clean, research-plan, checkpoint, evolve, learn, verify, knowledge-audit

### User-visible core agents (directly invocable)

planner, coder, researcher, supporter

### Internal specialist agents (explicitly invoked)

17 internal specialists: architect, tdd-guide, code-reviewer, security-reviewer, build-error-resolver, docs-lookup, e2e-runner, typescript-reviewer, python-reviewer, go-reviewer, refactor-cleaner, best-practice-researcher, agent-auditor, code-structure-auditor, design-coherence-auditor, knowledge-curator, safety-checker — called by core agents (planner/coder/researcher/supporter) or from prompt files

### Validation and CI

- `scripts/ci/validate-copilot-customizations.js` validates `.github` instructions, prompts, agents, and skills
- `scripts/ci/validate-github-hooks.js` validates deterministic hook files
- `scripts/ci/validate-no-personal-paths.js` checks for hardcoded personal paths
- `npm test` runs all three validators
- `npm run lint` runs ESLint + markdownlint
- Benchmark/eval scripts are shipped for the active Copilot path: `entry-points:eval`, `skill-router:eval`, `correction:eval`, `verification:eval`, `phase6:benchmark`

### User-level installer

- `scripts/installer/cli.js` provides `install`, `uninstall`, and `reinstall` commands for `~/.copilot/`
- `scripts/setup-system.ps1` and `scripts/setup-system.sh` wrap the shared installer for user-level setup
- `scripts/cleanup-system.ps1` and `scripts/cleanup-system.sh` wrap the shared uninstall flow
- Installer state tracks the previous VS Code user settings content so uninstall can restore it exactly
- Install refuses to overwrite a pre-existing unmanaged `~/.copilot/` directory without installer state
- User-level setup now syncs the repo baseline for instructions, agents, skills, prompts, hooks, `AGENTS.md`, and legacy `.claude` discovery toggles

### Project-level installer

- `scripts/installer/project-setup.js` is the shared implementation behind `scripts/setup-project.ps1` and `scripts/setup-project.sh`
- Project setup copies `.github/`, `.github/workflows/`, `AGENTS.md`, `.codex/`, `schemas/`, `scripts/ci/`, `scripts/hooks/`, `tests/fixtures/`, and `rust/semantic-indexer/`
- Existing `.vscode/settings.json` files are preserved with a warning; missing ones are seeded from the shipped workspace baseline
- Dependency bootstrap follows the target project's package manager when it can detect one, and falls back to `npm` otherwise
- Project setup installs the project-local `.agents/skills/` bridge for Codex skill discovery, using a junction when available and a copied fallback when junction creation fails

### Package identity

- `package.json`: name=`everything-githubcopilot`, version=`2.0.0`
- Runtime dependencies: `@huggingface/transformers`, `ajv`, `better-sqlite3`, `sqlite-vec`

### Codex CLI compatibility surface

- Root `AGENTS.md` — Codex project instruction source; `.codex/AGENTS.md` is compatibility guidance, not the source-of-truth instruction file
- `.codex/config.toml` — runtime config with 24 agents, MCP servers, profiles, `codex_hooks = true`
- `.codex/agents/` — 24 TOML agent definitions (4 core + 17 specialist + 3 legacy)
- `.codex/hooks.json` — Codex-compatible hooks (SessionStart, PreToolUse, PostToolUse, Stop)
- `.codex/rules/security.rules` — Starlark execution policy carrying the Codex-facing enforcement subset; this repository does not ship runtime `.codex/instructions/`
- `.codex/AGENTS.md` — Codex compatibility notes for hooks, rules, and agents
- `.agents/skills/` — project-local bridge from `.github/skills/` for Codex skill auto-discovery; setup creates a junction when possible and a copied fallback otherwise
- `.github/prompts/` remains the canonical workflow authoring surface; this repository does not ship runtime `.codex/prompts/`
- Custom Codex agents are packaged as compatibility assets, but the repository does not treat interactive picker/runtime behavior as a guaranteed contract across Codex builds; stable orchestration remains Copilot-first or external-control-plane-first.
- Current validators verify the Codex compatibility surface and instruction boundaries, not whether a particular Codex build exposes custom agents through a stable picker UX.
- `scripts/hooks/codex-pre-tool-use.js` — PreToolUse hook blocking `--no-verify`
- Project setup (`scripts/installer/project-setup.js`) copies `.codex/` into target projects and installs the `.agents/skills/` bridge

### Documentation

- `README.md` rewritten for Copilot-first framing
- `AGENTS.md` rewritten as Copilot guide
- Translation files (zh-CN, ja-JP) maintained; ko-KR, pt-BR, tr, zh-TW removed (EN/JP/CN only)
- Most legacy ECC docs in `docs/` were replaced with redirect notices, while selected operator and compatibility guides remain active under `docs/ja-JP/commands/`

## Remaining work

This section is a migration-era note, not the active execution backlog. Current backlog ownership lives in local planning docs when present, for example PRODUCT.md.

### Content review needed

- `the-shortform-guide.md`, `the-longform-guide.md`, `the-security-guide.md` may still contain ECC references
- `CONTRIBUTING.md` and `TROUBLESHOOTING.md` may still reference deleted directories
- `CHANGELOG.md` contains ECC history (keep as historical record)

### Expansion opportunities

- Additional language-specific reviewers beyond TypeScript, Python, and Go
- Additional prompts for workflows currently not covered
- Broader instruction coverage for languages and frameworks
- Expand deterministic hooks under `.github/hooks/`

- Migration note: Narrow compatibility validators and packaging debt incrementally instead of treating them as blockers for the active Copilot-first path.
- Migration note: Leave P3 work, especially non-active translation cleanup and broad archival, until the active Copilot path is stable.
