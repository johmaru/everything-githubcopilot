# ECC for Codex CLI

This supplements the root `AGENTS.md` with Codex-specific guidance.

## Model Recommendations

| Task Type                         | Recommended Model |
| --------------------------------- | ----------------- |
| Routine coding, tests, formatting | GPT 5.4           |
| Complex features, architecture    | GPT 5.4           |
| Debugging, refactoring            | GPT 5.4           |
| Security review                   | GPT 5.4           |

## Skills Discovery

Skills are auto-discovered from `.agents/skills/` (a junction to `.github/skills/`).
Each skill contains a `SKILL.md` with name/description frontmatter.

- Invoke explicitly via `$skill-name`
- Or implicitly via description matching in the agent prompt

Available skills (selected highlights from 110+):

- tdd-workflow — Test-driven development with 80%+ coverage
- security-review — Comprehensive security checklist
- coding-standards — Universal coding standards
- verification-loop — Build, test, lint, typecheck, security
- api-design — REST API design patterns
- frontend-patterns — React/Next.js patterns
- backend-patterns — API design, database, caching
- e2e-testing — Playwright E2E tests
- deep-research — Multi-source research with firecrawl and exa MCPs
- exa-search — Neural search via Exa MCP
- blueprint — Multi-session construction plans
- schema-optimization — Tool call schema improvements
- truncation-guard — File read truncation protection

## Hooks

Codex supports experimental hooks via `features.codex_hooks = true` in config.toml.

**Supported events:**

- `SessionStart` — fires on startup or resume
- `PreToolUse` — fires before Bash commands only (not Write/Edit/MCP)
- `PostToolUse` — fires after Bash commands only
- `Stop` — fires when session ends

**Active hooks in `.codex/hooks.json`:**

- PreToolUse: block `--no-verify` on git commands, warn before `git push`
- PostToolUse: record tool observations
- SessionStart: inject prior session summary
- Stop: persist session summary, cleanup backups and typecheck state

**Limitations:**

- PreToolUse/PostToolUse only intercept Bash tool calls
- Write/Edit/MultiEdit enforcement uses `.codex/rules/security.rules` instead
- Windows hooks are temporarily disabled

## Execution Policy (Rules)

Security and config protection that cannot run via hooks (Write/Edit interception)
is enforced via `.codex/rules/security.rules` in Starlark format:

- Linter/formatter config files are forbidden from edits
- `git push --force`, `git reset --hard`, `rm -rf` require confirmation
- `DROP TABLE` and `DROP DATABASE` are forbidden

Test rules with: `codex execpolicy check "edit eslint.config.js"`

## MCP Servers

Treat the project-local `.codex/config.toml` as the default Codex baseline for ECC.
The current baseline enables GitHub, Context7, Exa, Memory, Playwright, and Sequential Thinking.
Add heavier extras in `~/.codex/config.toml` only when a task actually needs them.

## Multi-Agent Support

Codex supports multi-agent workflows via `features.multi_agent = true`.

**24 agents registered** in `.codex/config.toml`:

Core agents (4):

- planner — Strategic planning and analysis (read-only)
- coder — Implementation with verification loops (workspace-write)
- researcher — Deep codebase investigation (read-only)
- supporter — Safe guidance without file edits (read-only)

Specialist agents (17):

- architect, tdd-guide, code-reviewer, security-reviewer
- build-error-resolver, e2e-runner, refactor-cleaner, safety-checker
- agent-auditor, best-practice-researcher, code-structure-auditor
- design-coherence-auditor, docs-lookup, go-reviewer
- knowledge-curator, python-reviewer, typescript-reviewer

Legacy agents (3):

- explorer — Read-only codebase explorer
- reviewer — PR review for correctness and security
- docs-researcher — API and release-note verification

Use `/agent` inside Codex CLI to inspect and steer agents.

## Implementation Lane

planner → coder → researcher (review)
On failure: coder → planner (re-plan)

## Support Lane (no edits)

supporter → planner (promote to implementation)
supporter → researcher (deep investigation)

## Key Differences from VS Code Copilot

| Feature      | VS Code Copilot           | Codex CLI                                       |
| ------------ | ------------------------- | ----------------------------------------------- |
| Hooks        | 8+ event types, all tools | 4 events, Bash-only for Pre/PostToolUse         |
| Context file | copilot-instructions.md   | AGENTS.md                                       |
| Skills       | Plugin-based discovery    | `.agents/skills/` auto-discovery                |
| Instructions | `.github/instructions/`   | AGENTS.md + rules                               |
| Rules        | Hook-based                | `.codex/rules/*.rules` (Starlark)               |
| Agents       | `.github/agents/*.md`     | `.codex/agents/*.toml` + `[agents.*]` in config |
| Security     | Hook-based enforcement    | Rules + hooks (Bash) + instructions             |
| MCP          | Full support              | Full support via `config.toml`                  |

## Security Enforcement

1. **Rules**: `.codex/rules/security.rules` blocks forbidden file edits and destructive commands
2. **Hooks**: PreToolUse blocks `--no-verify` and warns before `git push`
3. **Instructions**: AGENTS.md enforces input validation, secret management, and review workflows
4. **Sandbox**: Agent-level `sandbox_mode` restricts file access (read-only, workspace-write)
5. Always validate inputs at system boundaries
6. Never hardcode secrets — use environment variables
7. Run `npm audit` / `pip audit` before committing
8. Review `git diff` before every push
9. Use `sandbox_mode = "workspace-write"` in config
