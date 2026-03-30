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
- `.github/instructions/*.instructions.md` — path-specific instructions (69 files)
- `.github/prompts/*.prompt.md` — reusable slash workflows (12 prompts)
- `.github/agents/*.agent.md` — persistent specialist personas (13 agents)
- `.github/hooks/deterministic-hooks.json` — deterministic edit/validation hooks
- `.github/skills/` — skill definitions (117 skills)

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

This copies `.github/` assets and `.vscode/settings.json` into the target project. Open it in VS Code and Copilot loads everything automatically.

---

## Install System-Wide

Install instructions, agents, skills, and prompts to `~/.copilot/` so they apply to every VS Code workspace.

### Windows (PowerShell)

```powershell
.\scripts\setup-system.ps1
```

### Linux / macOS

```bash
./scripts/setup-system.sh
```

This copies customizations system-wide and configures VS Code user settings to enable `~/.copilot/` discovery paths.

### Uninstall

To remove system-wide customizations:

```powershell
# Windows
.\scripts\cleanup-system.ps1
```

```bash
# Linux / macOS
./scripts/cleanup-system.sh
```

---

### 5. Use

- **Prompts:** `/plan`, `/architect`, `/tdd`, `/code-review`, `/build-fix`, `/docs`, `/e2e`, `/refactor-clean`, `/research-plan`
- **Language reviews:** `/typescript-review`, `/python-review`, `/go-review`
- **Agents:** `planner`, `architect`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `docs-lookup`, `e2e-runner`, `refactor-cleaner`, `best-practice-researcher`
- **Language reviewers:** `typescript-reviewer`, `python-reviewer`, `go-reviewer`

---

## What's Inside

```
.github/
  copilot-instructions.md          # Repository-wide guidance
  instructions/                    # 69 path-specific instruction files
  prompts/                         # 12 reusable slash workflows
  agents/                          # 13 custom agent personas
  hooks/deterministic-hooks.json   # Deterministic edit/validation hooks
  skills/                          # 117 skill definitions
  workflows/                       # CI validation

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
npm test       # Runs all validators
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
