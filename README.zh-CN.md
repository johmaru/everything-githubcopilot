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

对于 Codex CLI，project setup 还会分发 project-local 的 `.codex/` runtime assets，并尝试创建 `.agents/skills/`，把 `.github/skills/` 作为 Codex skill discovery 的桥接目录。Codex 会继续读取根目录 `AGENTS.md` 作为项目 instructions，而 `.codex/AGENTS.md` 只保留为随仓库分发的 Codex 兼容说明。

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

注意: user-level installer 只面向 VS Code Copilot。Codex CLI 需要的 `.codex/` 和 project-local `.agents/skills/` 桥接目录应通过 project setup 分发到各个项目中。安装器不会管理 `~/.codex/skills`，因此那里出现的 invalid `SKILL.md` 警告需要在你的 Codex home 中修复或删除。

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
