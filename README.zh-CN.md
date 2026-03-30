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
- `.github/instructions/*.instructions.md` — 路径特定指令 (69 个文件)
- `.github/prompts/*.prompt.md` — 可复用工作流 (12 个提示)
- `.github/agents/*.agent.md` — 自定义代理 (13 个代理)
- `.github/hooks/deterministic-hooks.json` — 确定性钩子
- `.github/skills/` — 技能定义 (117 个技能)

### 4. 验证

```bash
npm test
npm run lint
```

---

## 安装到您的项目

将所有 Copilot 自定义（指令、提示、代理、钩子、技能）复制到任意项目中。

```powershell
# Windows
.\scripts\setup-project.ps1 C:\path\to\your-project
```

```bash
# Linux / macOS
./scripts/setup-project.sh /path/to/your-project
```

---

## 系统级安装

将指令、代理、技能和提示安装到 `~/.copilot/`，应用于所有 VS Code 工作区。

```powershell
# Windows
.\scripts\setup-system.ps1
```

```bash
# Linux / macOS
./scripts/setup-system.sh
```

### 卸载

```powershell
# Windows
.\scripts\cleanup-system.ps1
```

```bash
# Linux / macOS
./scripts/cleanup-system.sh
```

---

## 包含内容

```
.github/
  copilot-instructions.md          # 仓库级指导
  instructions/                    # 69 路径特定指令
  prompts/                         # 12 可复用工作流
  agents/                          # 13 自定义代理
  hooks/deterministic-hooks.json   # 确定性钩子
  skills/                          # 117 技能定义
```

---

## 许可证

MIT
