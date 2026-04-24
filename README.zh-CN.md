# Everything GitHub Copilot

[![Stars](https://img.shields.io/github/stars/johmaru/everything-githubcopilot?style=flat)](https://github.com/johmaru/everything-githubcopilot/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**适用于 VS Code 的 GitHub Copilot 自定义包**

仓库级指令、路径特定指令、提示文件、自定义代理、确定性钩子和技能定义 — 全部放在 `.github/` 目录下，VS Code 自动发现。

> **English README:** [README.md](README.md)
> **日本語:** [README.ja.md](README.ja.md)

---

## 指南

- [简明指南](./the-shortform-guide.md) — 布局、自定义类型和编写规则。**请先阅读。**
- [详细指南](./the-longform-guide.md) — 指令设计、提示与代理边界、钩子和验证。
- [安全指南](./the-security-guide.md) — 信任边界、审批、沙箱、清理和安全自动化。

---

## 快速开始

### 1. 克隆并在 VS Code 中打开

```bash
git clone https://github.com/johmaru/everything-githubcopilot.git
cd everything-githubcopilot
```

### 2. 安装依赖

```bash
npm install
```

### 3. VS Code 自动发现

以下文件由 GitHub Copilot 自动发现：

- `.github/copilot-instructions.md` — 仓库级指令
- `.github/instructions/**/*.instructions.md` — 路径特定指令 (71 个文件)
- `.github/prompts/*.prompt.md` — 可复用工作流 (20 个提示)
- `.github/agents/*.agent.md` — 自定义代理 (21 个代理: 4 个用户可见核心 + 17 个内部专家)
- `.github/hooks/deterministic-hooks.json` — 确定性钩子
- `.github/skills/` — 技能定义 (120+ 个技能)

### 4. 验证

```bash
npm test
npm run lint
```

---

## 安装到您的项目

将所有 Copilot 自定义作为 shared project payload 复制到任意项目：`.github/`、`.github/workflows/`、`AGENTS.md`、`.codex/`、`schemas/`、`scripts/codex-flow.js`、`scripts/ci/`、`scripts/hooks/`、`tests/fixtures/`、`rust/semantic-indexer/`，以及在目标项目尚未存在时复制 `.vscode/settings.json`。如果目标项目已经有 `.vscode/settings.json`，安装器会给出警告并保留原文件。

对于 Codex CLI，project setup 还会分发 project-local 的 `.codex/` runtime assets，创建 canonical 的 `.agents/skills/` 作为 `.github/skills/` 到 Codex skill discovery 的桥接目录，并额外创建 `.codex/skills/` 作为 direct path consumer 的兼容 alias。Codex 会继续读取根目录 `AGENTS.md` 作为项目 instructions，而 `.codex/AGENTS.md` 只保留为随仓库分发的 Codex 兼容说明。

完成 project setup 后，可在目标项目中运行 `node scripts/codex-flow.js "<task>"`。这个 external orchestrator 会按顺序执行 `plan -> implement -> review`，并把 phase artifact 写入 `.github/sessions/codex-flow/`。

为了在不增加常驻开销的前提下接近 Copilot 的续跑体验，同一个 launcher 还支持 `node scripts/codex-flow.js --resume-latest` 来从最新 run 的第一个未完成 phase 继续执行，以及 `node scripts/codex-flow.js --review-latest` 来只重跑 review phase。轻量 handoff file 会保存在同一个 artifact root 下，而 `.github/sessions/checkpoint.md` 只会在 phase 实际运行期间作为临时 bridge 使用。

runtime 依赖会优先跟随目标项目的 package manager (`packageManager`、`pnpm-lock.yaml`、`yarn.lock`、`package-lock.json`、`bun.lockb` / `bun.lock`)，找不到时才回退到 `npm`。当前依赖集合是 `@huggingface/transformers`、`ajv`、`better-sqlite3`、`sqlite-vec`。

target path 是必填项，而且必须位于 source checkout 之外。setup wrapper 不再回退到 source repository 的父目录。

```powershell
# Windows
.\scripts\setup-project.ps1 C:\path\to\your-project
```

```bash
# Linux / macOS
./scripts/setup-project.sh /path/to/your-project
```

---

## 用户级安装

将指令、代理、技能、提示、钩子和 schema 安装到 `~/.copilot/`，并更新当前用户的 VS Code 设置，让所有工作区都能发现它们。

注意: user-level installer 只面向 VS Code Copilot。Codex CLI 需要的 `.codex/`、project-local `.agents/skills/` 桥接目录，以及 `.codex/skills/` 兼容 alias 应通过 project setup 分发到各个项目中。安装器不会管理 `~/.codex/skills`，因此那里出现的 invalid `SKILL.md` 警告需要在你的 Codex home 中修复或删除。

安装器会同步仓库当前的 VS Code discovery baseline：启用 `~/.copilot` 下的 instructions / agents / skills / prompts / hooks，启用 `AGENTS.md`，保持 `CLAUDE.md` 关闭，并显式关闭 legacy `.claude` 规则与 hook 入口。

### npm / npx

```bash
npm run install:user
npm run uninstall:user
npm run reinstall:user
```

```bash
npx everything-githubcopilot install
npx everything-githubcopilot uninstall
npx everything-githubcopilot reinstall
```

```powershell
# Windows
.\scripts\setup-system.ps1
.\scripts\setup-system.ps1 -Action reinstall
.\scripts\cleanup-system.ps1
```

```bash
# Linux / macOS
./scripts/setup-system.sh install
./scripts/setup-system.sh reinstall
./scripts/cleanup-system.sh
```

卸载时会按安装前的原始 VS Code user settings 内容精确恢复。如果 `~/.copilot/` 中已经有未受安装器管理的内容，而且没有 installer state file，安装会直接停止而不是覆盖。

安装器不会擅自生成未公开的 Autopilot、默认审批或 allowed tools 设置。唯一可能写入的审批相关设置是 `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions`，而且只有在执行安装命令时显式提供 `EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS=1` 才会启用。

---

## 使用

- **Codex-only launcher:** project setup 后，在目标项目中运行 `node scripts/codex-flow.js "<task>"`，会执行默认的外部 `plan -> implement -> review` lane，并把 phase artifacts 写入 `.github/sessions/codex-flow/`。
- **Codex workflows:** 使用 `node scripts/codex-flow.js --workflow bugfix "<task>"`、`--workflow refactor` 或 `--workflow review` 来选择面向任务的 phase routing。
- **Codex incremental follow-up:** `node scripts/codex-flow.js --resume-latest` 会从最新 run 的第一个未完成 phase 继续，`node scripts/codex-flow.js --review-latest` 只重跑已经完成 plan / implement 的最新 run 的 review phase。
- **Prompts:** `/plan`, `/plan-and-implement`, `/architect`, `/tdd`, `/code-review`, `/review`, `/build-fix`, `/fix-test`, `/docs`, `/e2e`, `/refactor-clean`, `/research-plan`, `/checkpoint`, `/evolve`, `/learn`, `/verify`, `/knowledge-audit`
- **Verification:** `/verify` 会对当前变更集重新运行 repository verification loop，默认只报告 regression 和剩余风险，不修改文件。
- **Knowledge audit:** `/knowledge-audit` 会检查 instructions、skills、prompts、agents 是否存在过期、矛盾、重复或覆盖缺口。
- **Language reviews:** `/typescript-review`, `/python-review`, `/go-review`
- **Static AST exploration:** `npm run entry-points:index -- --root .`, `npm run entry-points:query -- --root . --query "semantic indexer"`, `npm run rust:index -- --root . --format summary`, `npm run rust:index -- --root . --file rust/semantic-indexer/src/cli.rs` 可用于 repo-wide indexing、ranked entry-point lookup、semantic-indexer summary 和 file-level symbol inventory。
- **User-visible agents:** `planner`, `coder`, `researcher`, `supporter` 可直接用于 planning、implementation、deep investigation 和不编辑文件的 safer support。
- **Internal specialists:** `architect`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `docs-lookup`, `e2e-runner`, `refactor-cleaner`, `best-practice-researcher`, `typescript-reviewer`, `python-reviewer`, `go-reviewer`, `agent-auditor`, `code-structure-auditor`, `design-coherence-auditor`, `knowledge-curator`, `safety-checker` 由 core agents 或 prompts 显式调用。

## Memory Surface

- **Session resume artifacts:** `/checkpoint` 写入 `.github/sessions/checkpoint.md`，`PreCompact` 写入 `.github/sessions/compact-snapshot.md`，`SessionStart` 会先恢复这些 artifacts，再恢复 prior summaries。
- **Copilot/Codex shared continuity:** `.github/hooks/deterministic-hooks.json` 中的 Copilot hooks 和 `.codex/hooks.json` 中的 Codex hooks 调用同一个 `scripts/hooks/*.js` memory layer，因此两个 provider 会保存和恢复同一个 local store。
- **SQLite-backed continuity:** `scripts/hooks/db.js` 将 sessions、pending tasks、observations、project-scoped knowledge 持久化到 `.github/sessions/copilot.db`，下一次 session 可以在不依赖 hosted memory service 的情况下恢复 active work。
- **Hybrid retrieval:** `SessionStart` 组合 keyword match、已经 embedded 的 knowledge、confidence、recency、hit count 和 project scope。启动时不会加载 embedding model。
- **Durable learnings:** `/learn` 用来整理应该保留的知识及其归属。需要写入 sanitized、可搜索的 repo knowledge 时，使用 `node scripts/hooks/learn-embed.js`；不要把 secrets 或临时 scratch notes 放入这条路径。
- **Embedding backfill:** session 结束后可运行 `node scripts/hooks/learn-embed.js --backfill --limit 25` 来异步 embedding pending knowledge。如果 `sqlite-vec` 不可用，系统会保留 row，并回退到 keyword retrieval。
- **Noise control:** auto-observation 会抑制 `Bash -> Bash` 这类低信息量 shell-only sequence，并优先保存带 trigger/action metadata 的 error-resolution、workflow 和 hotspot knowledge。
- **Scope boundary:** core workflow continuity 来自 shipped checkpoint、session 和 knowledge hooks。GitHub Copilot built-in memory 是可选项，不是此 repository 的必需依赖。

## Optional MCP Integrations

- **Documentation lookup:** Context7 或其他 documentation-oriented MCP server 可以提高 setup 和 API 问题的新鲜度，但本 repository 不依赖它们也能工作。
- **Boundary:** 不要把 `.vscode/mcp.json`、hosted memory 或 remote MCP tools 视为 required install path。Core prompts、agents、hooks、validators 和默认 Codex profile 必须保留 local fallback。

---

## 包含内容

```
.github/
  copilot-instructions.md          # 仓库级指导
  instructions/                    # 71 路径特定指令
  prompts/                         # 20 可复用工作流
  agents/                          # 21 自定义代理 (4 个用户可见核心 + 17 个内部专家)
  hooks/deterministic-hooks.json   # 确定性钩子
  skills/                          # 120+ 技能定义
  workflows/                       # CI / release workflows

.codex/                            # Codex CLI compatibility surface
  config.toml                      # Codex reference configuration
  AGENTS.md                        # Codex compatibility notes
  agents/                          # Codex multi-agent role configs
  hooks.json                       # Codex-compatible hooks
  rules/                           # Codex execution policy rules

.agents/skills/                    # project setup 创建的 Codex skill bridge

scripts/codex-flow.js              # project setup 分发的 Codex-only launcher

.vscode/
  settings.json                    # VS Code workspace settings

scripts/ci/
  validate-copilot-customizations.js
  validate-github-hooks.js
  validate-no-personal-paths.js
```

---

## 许可证

MIT
