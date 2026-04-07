# OpenCode ECC Plugin

> ⚠️ This README is specific to OpenCode usage.  
> If you installed ECC via npm (e.g. `npm install opencode-ecc`), refer to the root README instead.

Everything Claude Code (ECC) plugin for OpenCode - agents, commands, hooks, and skills.

## Installation

## Installation Overview

There are two ways to use Everything Claude Code (ECC):

1. **npm package (recommended for most users)**  
   Install via npm/bun/yarn and use the `ecc-install` CLI to set up rules and agents.

2. **Direct clone / plugin mode**  
   Clone the repository and run OpenCode directly inside it.

Choose the method that matches your workflow below.

### Option 1: npm Package

```bash
npm install ecc-universal
```

Add to your `opencode.json`:

```json
{
  "plugin": ["ecc-universal"]
}
```

This loads the ECC OpenCode plugin module from npm:

- hook/event integrations
- bundled custom tools exported by the plugin

It does **not** auto-register the full ECC command/agent/instruction catalog in your project config, and the published package does not bundle the repository-level `AGENTS.md`, `CONTRIBUTING.md`, or referenced `skills/*` files from this repo-local compatibility setup. For the full OpenCode setup, either:

- run OpenCode inside this repository, or
- copy the relevant `.opencode/commands/`, `.opencode/prompts/`, `.opencode/instructions/`, the referenced top-level docs, the required `skills/*` files, and the `instructions`, `agent`, and `command` config entries into your own project

After installation, the `ecc-install` CLI is also available:

```bash
npx ecc-install typescript
```

Current compatibility caveat: the legacy OpenCode hook plugin still assumes POSIX-style shell utilities and macOS notifications in several paths. On Windows, some audits/reminders may degrade unless you run under WSL/Git Bash or adapt the hook commands.

### Option 2: Direct Use

Clone and run OpenCode in the repository:

```bash
git clone https://github.com/johmaru/everything-githubcopilot
cd everything-githubcopilot
opencode
```

## Features

### Agents (12 specialized + 1 primary)

Primary agent:

| Agent | Description                                           |
| ----- | ----------------------------------------------------- |
| build | Primary coding agent for direct editing and execution |

Specialized subagents:

| Agent                | Description                       |
| -------------------- | --------------------------------- |
| planner              | Implementation planning           |
| architect            | System design                     |
| code-reviewer        | High-risk or cross-cutting review |
| security-reviewer    | Security analysis                 |
| tdd-guide            | Test-driven development           |
| build-error-resolver | Build error fixes                 |
| e2e-runner           | E2E testing                       |
| doc-updater          | Documentation and codemap updates |
| refactor-cleaner     | Dead code cleanup                 |
| go-reviewer          | Go code review                    |
| go-build-resolver    | Go build fixes                    |
| database-reviewer    | PostgreSQL review                 |

### Commands (26 configured)

| Command            | Description                               |
| ------------------ | ----------------------------------------- |
| `/plan`            | Create implementation plan                |
| `/tdd`             | TDD workflow                              |
| `/code-review`     | Review high-risk or cross-cutting changes |
| `/security`        | Security review                           |
| `/build-fix`       | Fix build errors                          |
| `/e2e`             | E2E tests                                 |
| `/refactor-clean`  | Remove dead code                          |
| `/orchestrate`     | Multi-agent workflow                      |
| `/learn`           | Extract patterns                          |
| `/checkpoint`      | Save progress                             |
| `/verify`          | Verification loop                         |
| `/eval`            | Evaluation                                |
| `/update-docs`     | Update docs                               |
| `/update-codemaps` | Update codemaps                           |
| `/test-coverage`   | Coverage analysis                         |
| `/setup-pm`        | Package manager                           |
| `/go-review`       | Go code review                            |
| `/go-test`         | Go TDD                                    |
| `/go-build`        | Go build fix                              |
| `/skill-create`    | Generate skills                           |
| `/instinct-status` | View instincts                            |
| `/instinct-import` | Import instincts                          |
| `/instinct-export` | Export instincts                          |
| `/evolve`          | Cluster instincts                         |
| `/promote`         | Promote project instincts                 |
| `/projects`        | List known projects                       |

### Plugin Hooks

| Hook                          | Event                 | Purpose                                                            |
| ----------------------------- | --------------------- | ------------------------------------------------------------------ |
| Prettier                      | `file.edited`         | Auto-format JS/TS in `strict` profile                              |
| TypeScript                    | `tool.execute.after`  | Check for type errors after TS edits in `strict` profile           |
| console.log                   | `file.edited`         | Warn about debug statements in `standard` and `strict`             |
| Notification                  | `session.idle`        | Desktop notification                                               |
| Git push reminder             | `tool.execute.before` | Remind you to review before `git push` in `strict`                 |
| Doc file warning              | `tool.execute.before` | Warn when creating ad-hoc docs in `standard` and `strict`          |
| Long-running command reminder | `tool.execute.before` | Suggest background execution for installs/builds/tests in `strict` |

### Custom Tools

| Tool           | Description                 |
| -------------- | --------------------------- |
| run-tests      | Run test suite with options |
| check-coverage | Analyze test coverage       |
| security-audit | Security vulnerability scan |

## Hook Event Mapping

OpenCode's plugin system maps to Claude Code hooks:

| Claude Code  | OpenCode              |
| ------------ | --------------------- |
| PreToolUse   | `tool.execute.before` |
| PostToolUse  | `tool.execute.after`  |
| Stop         | `session.idle`        |
| SessionStart | `session.created`     |
| SessionEnd   | `session.deleted`     |

OpenCode has 20+ additional events not available in Claude Code.

Platform note: the shipped legacy hook implementation currently uses POSIX-style shell commands and `osascript` for notifications. Treat hook parity as best-effort on Windows unless you run the plugin in a compatible shell environment.

### Hook Runtime Controls

OpenCode plugin hooks honor the same runtime controls used by Claude Code/Cursor:

```bash
export ECC_HOOK_PROFILE=standard
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

- `ECC_HOOK_PROFILE`: `minimal`, `standard` (default), `strict`
- `standard` enables warning-oriented hooks; `strict` additionally enables auto-formatting, TypeScript checks, and command reminders
- `ECC_DISABLED_HOOKS`: comma-separated hook IDs to disable

## Skills

The default OpenCode config loads 11 curated ECC skills via the `instructions` array:

- coding-standards
- backend-patterns
- frontend-patterns
- frontend-slides
- security-review
- tdd-workflow
- strategic-compact
- eval-harness
- verification-loop
- api-design
- e2e-testing

Additional specialized skills are shipped in `skills/` but not loaded by default to keep OpenCode sessions lean:

- article-writing
- content-engine
- market-research
- investor-materials
- investor-outreach

## Configuration

Full configuration in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "plugin": ["./plugins"],
  "instructions": ["skills/tdd-workflow/SKILL.md", "skills/security-review/SKILL.md"],
  "agent": {
    /* 13 total agents: 1 primary + 12 specialized */
  },
  "command": {
    /* 26 configured commands */
  }
}
```

## License

MIT
