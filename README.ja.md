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
- `.github/instructions/**/*.instructions.md` — パス別インストラクション (71 ファイル)
- `.github/prompts/*.prompt.md` — スラッシュワークフロー (20 プロンプト)
- `.github/agents/*.agent.md` — カスタムエージェント (21 エージェント: 4 ユーザー可視コア + 17 内部スペシャリスト)
- `.github/hooks/deterministic-hooks.json` — 確定的フック
- `.github/skills/` — スキル定義 (120+ スキル)

### 4. バリデーション

```bash
npm test
npm run lint
```

---

## 自分のプロジェクトにインストール

すべての Copilot カスタマイズを shared project payload として任意のプロジェクトへコピーします。`.github/` 一式、`.github/workflows/`、`AGENTS.md`、`.codex/`、`schemas/`、`scripts/codex-flow.js`、`scripts/ci/`、`scripts/hooks/`、`tests/fixtures/`、`rust/semantic-indexer/`、そして `.vscode/settings.json` が未作成ならその設定も同期します。既存の `.vscode/settings.json` は上書きせず、警告だけを出して保持します。

Codex CLI 向けには、project setup が project-local な `.codex/` runtime assets を配布し、`.github/skills/` を Codex から見せるための `.agents/skills/` ブリッジ作成も試みます。Codex は project instructions として root の `AGENTS.md` を読み続けます。`.codex/AGENTS.md` は shipped な Codex surface 向けの互換メモとして扱われます。

project setup 後は、target project で `node scripts/codex-flow.js "<task>"` を実行すると、external orchestrator として `plan -> implement -> review` を順に回します。phase artifact は `.github/sessions/codex-flow/` に保存されます。

低オーバーヘッドな追従フローとして、同じ launcher で `node scripts/codex-flow.js --resume-latest` を使うと最新 run の未完了 phase から再開でき、`node scripts/codex-flow.js --review-latest` を使うと review phase だけを再実行できます。軽量な handoff file は同じ artifact root に保存され、`.github/sessions/checkpoint.md` は phase 実行中だけの一時 bridge として使います。常駐 watcher は shipped しません。

runtime 依存は target project から検出できる package manager (`packageManager`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb` / `bun.lock`) を優先して導入し、見つからない時だけ `npm` にフォールバックします。同梱する依存は `@huggingface/transformers`, `ajv`, `better-sqlite3`, `sqlite-vec` です。

target path は必須で、source checkout の外側でなければなりません。setup wrapper は source repository の親 directory への暗黙 fallback を行いません。

```powershell
# Windows
.\scripts\setup-project.ps1 C:\path\to\your-project
```

```bash
# Linux / macOS
./scripts/setup-project.sh /path/to/your-project
```

---

## ユーザー単位でインストール

インストラクション、エージェント、スキル、プロンプト、フック、スキーマを `~/.copilot/` にインストールし、現在のユーザーの VS Code 設定を更新して全ワークスペースから参照できるようにします。

注: user-level installer は VS Code Copilot 向けです。Codex CLI 用の `.codex/` と project-local な `.agents/skills/` ブリッジは project setup で各 project に配布してください。`~/.codex/skills` は管理対象外なので、そこに出る invalid `SKILL.md` 警告は user 環境側で修正または削除する必要があります。

user settings では、`~/.copilot` の instructions / agents / skills / prompts / hooks の discovery を有効化し、`AGENTS.md` discovery を有効、`CLAUDE.md` discovery を無効のまま維持します。あわせて legacy `.claude` rules / hooks の discovery は明示的に無効化して、repo の shipped baseline に揃えます。

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

### Windows

```powershell
.\scripts\setup-system.ps1
.\scripts\setup-system.ps1 -Action reinstall
.\scripts\cleanup-system.ps1
```

### Linux / macOS

```bash
./scripts/setup-system.sh install
./scripts/setup-system.sh reinstall
./scripts/cleanup-system.sh
```

アンインストール時は、インストール前の VS Code user settings の内容をそのまま復元します。`~/.copilot/` に既存の unmanaged な内容があり、installer state file が無い場合は上書きせず停止します。

installer は未公開の Autopilot 設定や default approvals、allowed tools を勝手に生成しません。opt-in で扱う approval 関連設定は `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions` のみで、これも `EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS=1` を付けて install を実行した時だけ有効になります。

---

## 同梱内容

```
.github/
  copilot-instructions.md          # リポジトリ全体のガイダンス
  instructions/                    # 71 パス別インストラクション
  prompts/                         # 20 スラッシュワークフロー
  agents/                          # 21 カスタムエージェント (4 ユーザー可視コア + 17 内部スペシャリスト)
  hooks/deterministic-hooks.json   # 確定的フック
  skills/                          # 120+ スキル定義
  workflows/                       # CI / release workflows

.codex/                            # Codex CLI compatibility surface
  config.toml                      # Codex reference configuration
  AGENTS.md                        # Codex compatibility notes
  agents/                          # Codex multi-agent role configs
  hooks.json                       # Codex-compatible hooks
  rules/                           # Codex execution policy rules

.agents/skills/                    # project setup が作成する Codex skill bridge

scripts/codex-flow.js              # project setup が配布する Codex-only launcher

.vscode/
  settings.json                    # VS Code workspace settings

scripts/ci/
  validate-copilot-customizations.js
  validate-github-hooks.js
  validate-no-personal-paths.js
```

---

## ライセンス

MIT
