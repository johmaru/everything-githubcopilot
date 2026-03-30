# Everything GitHub Copilot

[![Stars](https://img.shields.io/github/stars/johmaru/everything-githubcopilot?style=flat)](https://github.com/johmaru/everything-githubcopilot/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**VS Code 向け GitHub Copilot カスタマイズパック**

リポジトリ全体のインストラクション、パス別インストラクション、プロンプトファイル、カスタムエージェント、確定的フック、スキル定義 — すべて `.github/` 配下に配置し、VS Code が自動的に検出します。

> **English README:** [README.md](README.md)
> **简体中文:** [README.zh-CN.md](README.zh-CN.md)

---

## ガイド

- [ショートフォームガイド](./the-shortform-guide.md) — レイアウト、カスタマイズの種類、作成ルール。**まずこちらをお読みください。**
- [ロングフォームガイド](./the-longform-guide.md) — インストラクション設計、プロンプトとエージェントの境界、フック、バリデーション。
- [セキュリティガイド](./the-security-guide.md) — 信頼境界、承認、サンドボックス、サニタイズ、安全な自動化。

---

## クイックスタート

### 1. クローンして VS Code で開く

```bash
git clone https://github.com/johmaru/everything-githubcopilot.git
cd everything-githubcopilot
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. VS Code が自動検出

以下のファイルが GitHub Copilot によって自動検出されます:

- `.github/copilot-instructions.md` — リポジトリ全体のインストラクション
- `.github/instructions/*.instructions.md` — パス別インストラクション (69 ファイル)
- `.github/prompts/*.prompt.md` — スラッシュワークフロー (12 プロンプト)
- `.github/agents/*.agent.md` — カスタムエージェント (13 エージェント)
- `.github/hooks/deterministic-hooks.json` — 確定的フック
- `.github/skills/` — スキル定義 (117 スキル)

### 4. バリデーション

```bash
npm test
npm run lint
```

---

## 自分のプロジェクトにインストール

すべての Copilot カスタマイズ (インストラクション、プロンプト、エージェント、フック、スキル) を任意のプロジェクトにコピーします。

```powershell
# Windows
.\scripts\setup-project.ps1 C:\path\to\your-project
```

```bash
# Linux / macOS
./scripts/setup-project.sh /path/to/your-project
```

---

## システム全体にインストール

インストラクション、エージェント、スキル、プロンプトを `~/.copilot/` にインストールし、すべての VS Code ワークスペースに適用します。

```powershell
# Windows
.\scripts\setup-system.ps1
```

```bash
# Linux / macOS
./scripts/setup-system.sh
```

### アンインストール

```powershell
# Windows
.\scripts\cleanup-system.ps1
```

```bash
# Linux / macOS
./scripts/cleanup-system.sh
```

---

## 同梱内容

```
.github/
  copilot-instructions.md          # リポジトリ全体のガイダンス
  instructions/                    # 69 パス別インストラクション
  prompts/                         # 12 スラッシュワークフロー
  agents/                          # 13 カスタムエージェント
  hooks/deterministic-hooks.json   # 確定的フック
  skills/                          # 117 スキル定義
```

---

## ライセンス

MIT
