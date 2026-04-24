# Everything GitHub Copilot

[![Stars](https://img.shields.io/github/stars/johmaru/everything-githubcopilot?style=flat)](https://github.com/johmaru/everything-githubcopilot/stargazers)
[![Forks](https://img.shields.io/github/forks/johmaru/everything-githubcopilot?style=flat)](https://github.com/johmaru/everything-githubcopilot/network/members)
[![Contributors](https://img.shields.io/github/contributors/johmaru/everything-githubcopilot?style=flat)](https://github.com/johmaru/everything-githubcopilot/graphs/contributors)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **[日本語](README.ja.md)** | **[简体中文](README.zh-CN.md)**

**A GitHub Copilot customization pack for VS Code.**

Repository instructions, path-specific instructions, prompt files, custom agents, deterministic hooks, and skills — all under `.github/`, ready for VS Code to discover automatically.

---

## The Guides

<table>
<tr>
<td width="33%">
<a href="./the-shortform-guide.md">
<img src="./assets/images/guides/shorthand-guide.png" alt="The Shortform Guide to Everything GitHub Copilot" />
</a>
</td>
<td width="33%">
<a href="./the-longform-guide.md">
<img src="./assets/images/guides/longform-guide.png" alt="The Longform Guide to Everything GitHub Copilot" />
</a>
</td>
<td width="33%">
<a href="./the-security-guide.md">
<img src="./assets/images/security/security-guide-header.png" alt="The Security Guide to Everything GitHub Copilot" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>Shortform Guide</b><br/>Layout, customization types, and authoring rules. <b>Read this first.</b></td>
<td align="center"><b>Longform Guide</b><br/>Instruction design, prompt and agent boundaries, hooks, and validation.</td>
<td align="center"><b>Security Guide</b><br/>Trust boundaries, approvals, sandboxing, sanitization, and safe automation.</td>
</tr>
</table>

---

## Quick Start

### 1. Clone and open in VS Code

```bash
git clone https://github.com/johmaru/everything-githubcopilot.git
cd everything-githubcopilot
```

### 2. Install dependencies

```bash
npm install
```

### 3. VS Code loads customizations automatically

The following files are discovered by GitHub Copilot in VS Code:

- `.github/copilot-instructions.md` — repository-wide instructions
- `.github/instructions/**/*.instructions.md` — path-specific instructions (71 files)
- `.github/prompts/*.prompt.md` — reusable slash workflows (20 prompts)
- `.github/agents/*.agent.md` — persistent specialist personas (21 agents: 4 user-visible core + 17 internal specialists)
- `.github/hooks/deterministic-hooks.json` — deterministic edit/validation hooks
- `.github/skills/` — skill definitions (120+ skills)

### 4. Validate

```bash
npm test
npm run lint
```

---

## Install Into Your Own Project

Copy all Copilot customizations (instructions, prompts, agents, hooks, skills) into any existing project.

### Windows (PowerShell)

```powershell
.\scripts\setup-project.ps1 C:\path\to\your-project
```

### Linux / macOS

```bash
./scripts/setup-project.sh /path/to/your-project
```

An explicit target path is required, and it must be outside the source checkout. The setup wrappers no longer fall back to the parent directory of the source repository.

This copies the shared project payload into the target project: `.github/` assets, `.github/workflows/`, `.vscode/settings.json` when absent, `AGENTS.md`, `.codex/` (Codex CLI compatibility surface), `schemas/`, `scripts/codex-flow.js`, `scripts/ci/`, `scripts/hooks/`, `tests/fixtures/`, and `rust/semantic-indexer/`. It preserves an existing `.vscode/settings.json` with a warning instead of overwriting it.

For Codex CLI, project setup also installs the project-local `.codex/` runtime assets, creates `.agents/skills/` as the canonical bridge from `.github/skills/` into Codex skill discovery, and creates `.codex/skills/` as a compatibility alias for tools that still read that path directly. Codex continues to read the root `AGENTS.md` for project instructions, while `.codex/AGENTS.md` remains compatibility notes for the shipped first-class Codex compatibility lane.

After project setup, the supported Codex-only front door is `node scripts/codex-flow.js "<task>"` from the target project. The launcher acts as the external `plan -> implement -> review` orchestrator and writes phase artifacts under `.github/sessions/codex-flow/`. Codex builds with `apply_patch` hook support also run the shipped edit hooks for `apply_patch|Write|Edit`, giving Codex the same edit-time quality gates as the Copilot lane where the runtime supports them.

For lower-overhead follow-up work, the same launcher also supports `node scripts/codex-flow.js --workflow default "<task>"`, `--workflow bugfix`, `--workflow refactor`, `--workflow review`, `--resume-latest` to continue the first incomplete phase of the latest run, and `--review-latest` to rerun only the review phase. It writes lightweight handoff files under the same artifact root and uses `.github/sessions/checkpoint.md` only as a transient bridge while a phase is actively running instead of shipping an always-on watcher.

Runtime dependencies now install from the target project's package manager when setup can detect one (`packageManager`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, or `bun.lockb` / `bun.lock`), and fall back to `npm` otherwise. The bundled runtime set is `@huggingface/transformers`, `ajv`, `better-sqlite3`, and `sqlite-vec`.

---

## Install User-Level

Install instructions, agents, skills, prompts, hooks, and schemas into `~/.copilot/` for the current user, ship the Rust semantic indexer payload for local AST exploration, and update VS Code user settings so every workspace can discover the supported customization surfaces. The default provider remains Copilot for backward compatibility.

The same user-level installer can now opt into Codex global assets with `--provider codex` or install both lanes with `--provider all`. Codex assets are namespaced under `~/.codex/everything-githubcopilot/` and `~/.codex/skills/everything-githubcopilot/`; active `~/.codex/config.toml`, `~/.codex/hooks.json`, and `~/.codex/rules/everything-githubcopilot-security.rules` are created only when safe. Existing Codex config or hook files are left untouched, with the managed templates available in the namespace.

The installer now syncs the shipped VS Code discovery baseline for user settings: `~/.copilot` instructions, agents, skills, prompts, and hooks are enabled, `AGENTS.md` discovery is enabled, `CLAUDE.md` discovery stays disabled, and legacy `.claude` instruction / hook locations are explicitly turned off.

### npm / npx

```bash
npm run install:user
npm run install:user:codex
npm run install:user:all
npm run uninstall:user
npm run reinstall:user
```

You can also run the packaged CLI directly:

```bash
npx everything-githubcopilot install
npx everything-githubcopilot install --provider codex
npx everything-githubcopilot install --provider all
npx everything-githubcopilot uninstall
npx everything-githubcopilot reinstall
```

### Windows (PowerShell)

```powershell
.\scripts\setup-system.ps1
.\scripts\setup-system.ps1 -Provider codex
.\scripts\setup-system.ps1 -Provider all
.\scripts\setup-system.ps1 -Action reinstall
.\scripts\cleanup-system.ps1
```

### Linux / macOS

```bash
./scripts/setup-system.sh install
./scripts/setup-system.sh install codex
./scripts/setup-system.sh install all
./scripts/setup-system.sh reinstall
./scripts/cleanup-system.sh
```

The installer stores the previous VS Code user settings content so uninstall can restore it exactly. If `~/.copilot/` already contains unmanaged files and no installer state file, installation stops instead of overwriting them.

Codex uninstall uses a separate `~/.codex/.everything-githubcopilot-codex-install.json` state file and removes only managed paths. Use `everything-githubcopilot uninstall --provider codex`, `.\scripts\cleanup-system.ps1 -Provider codex`, or `./scripts/cleanup-system.sh codex` to remove the Codex lane.

The installer intentionally does not invent unsupported Autopilot, default-approval, or allowed-tool settings. The only approval-adjacent user setting it can opt into is `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions`, and even that is enabled only when the install command is run with `EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS=1`.

---

### 5. Use

- **Codex-only launcher:** after project setup, run `node scripts/codex-flow.js "<task>"` in the target project to execute the default external `plan -> implement -> review` lane and store the phase artifacts under `.github/sessions/codex-flow/`
- **Codex workflows:** use `node scripts/codex-flow.js --workflow bugfix "<task>"`, `--workflow refactor`, or `--workflow review` for task-specific phase routing
- **Codex incremental follow-up:** use `node scripts/codex-flow.js --resume-latest` to continue the first incomplete phase of the latest run, or `node scripts/codex-flow.js --review-latest` to rerun only the review phase when the latest run has already completed plan and implement
- **Prompts:** `/plan`, `/plan-and-implement`, `/architect`, `/tdd`, `/code-review`, `/review`, `/build-fix`, `/fix-test`, `/docs`, `/e2e`, `/refactor-clean`, `/research-plan`, `/checkpoint`, `/evolve`, `/learn`, `/verify`, `/knowledge-audit`
- **Verification:** `/verify` reruns the repository verification loop on the current change set and reports regressions or remaining risks without changing files by default
- **Knowledge audit:** `/knowledge-audit` checks instructions, skills, prompts, and agents for staleness, contradictions, duplication, or coverage gaps
- **Language reviews:** `/typescript-review`, `/python-review`, `/go-review`
- **Static AST exploration:** `npm run entry-points:index -- --root .`, `npm run entry-points:query -- --root . --query "semantic indexer"`, `npm run rust:index -- --root . --format summary`, and `npm run rust:index -- --root . --file rust/semantic-indexer/src/cli.rs` cover repo-wide indexing, ranked entry-point lookup, aggregate semantic-indexer summaries, and direct semantic-indexer CLI access when you need file-level symbol inventories, kind/export/doc-coverage reports, or raw AST records for exported API and symbol-density analysis.
- **User-visible agents:** `planner`, `coder`, `researcher`, `supporter` — directly invocable for planning, implementation, deep investigation, and safer support without edits
- **Internal specialists:** `architect`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `docs-lookup`, `e2e-runner`, `refactor-cleaner`, `best-practice-researcher`, `typescript-reviewer`, `python-reviewer`, `go-reviewer`, `agent-auditor`, `code-structure-auditor`, `design-coherence-auditor`, `knowledge-curator`, `safety-checker` — explicitly invoked by core agents or prompts

### Memory Surface

- **Session resume artifacts:** `/checkpoint` writes `.github/sessions/checkpoint.md`, `PreCompact` writes `.github/sessions/compact-snapshot.md`, and `SessionStart` restores those artifacts before prior summaries.
- **SQLite-backed continuity:** `scripts/hooks/db.js` persists sessions, pending tasks, and project-scoped knowledge in `.github/sessions/copilot.db` so the next session can recover active work without relying on a hosted memory service.
- **Durable learnings:** `/learn` curates what should be kept and where it belongs. Use `node scripts/hooks/learn-embed.js` when the result should become sanitized, searchable repo knowledge for future semantic retrieval, and keep secrets or transient scratch notes out of that path.
- **Scope boundary:** Core workflow continuity comes from the shipped checkpoint, session, and knowledge hooks. Enabling GitHub Copilot built-in memory is optional and not required for this repository.

### Optional MCP Integrations

- **Documentation lookup:** Context7 or other documentation-oriented MCP servers can improve freshness for setup and API questions, but the repository works without them.
- **Boundary:** Do not treat `.vscode/mcp.json`, hosted memory, or remote MCP tools as part of the required install path. Core prompts, agents, hooks, validators, and the default Codex profile must keep a local fallback.

---

## What's Inside

```
.github/
  copilot-instructions.md          # Repository-wide guidance
  instructions/                    # 71 path-specific instruction files
  prompts/                         # 20 reusable slash workflows
  agents/                          # 21 custom agent personas (4 user-visible core + 17 internal specialists)
  hooks/deterministic-hooks.json   # Deterministic edit/validation hooks
  skills/                          # 120+ skill definitions
  workflows/                       # CI validation

.codex/                            # Codex CLI compatibility surface
  config.toml                      # Local-first Codex reference configuration
  AGENTS.md                        # Codex compatibility notes
  agents/                          # Codex multi-agent role configs
  hooks.json                       # Codex-compatible Bash and apply_patch hooks
  rules/                           # Codex execution policy rules

.agents/skills/                    # Project-local Codex skill bridge created by setup

scripts/codex-flow.js              # Project-local Codex-only workflow orchestrator

.vscode/
  settings.json                    # VS Code workspace settings

scripts/ci/
  validate-copilot-customizations.js
  validate-github-hooks.js
  validate-no-personal-paths.js
```

---

## Validation

```bash
npm test       # Runs validators, hook regressions, and installer tests
npm run lint   # ESLint + markdownlint
```

## Contributing

- Add instructions under `.github/instructions/`
- Add reusable workflows under `.github/prompts/`
- Add persistent specialist personas under `.github/agents/`
- Add deterministic hook definitions under `.github/hooks/`

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=johmaru/everything-githubcopilot&type=Date)](https://star-history.com/#johmaru/everything-githubcopilot&Date)

---

## Links

- [Shortform Guide](./the-shortform-guide.md)
- [Longform Guide](./the-longform-guide.md)
- [Security Guide](./the-security-guide.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

MIT
