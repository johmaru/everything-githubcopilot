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

Codex CLI 向けには、project setup が project-local な `.codex/` runtime assets を配布し、`.github/skills/` を Codex から見せる canonical な `.agents/skills/` ブリッジを作成し、さらに `.codex/skills/` を direct path consumer 向けの互換 alias として作成します。Codex は project instructions として root の `AGENTS.md` を読み続けます。`.codex/AGENTS.md` は shipped な first-class Codex compatibility lane 向けの互換メモとして扱われます。

project setup 後は、target project で `node scripts/codex-flow.js "<task>"` を実行すると、external orchestrator として `plan -> implement -> review` を順に回します。phase artifact は `.github/sessions/codex-flow/` に保存されます。`apply_patch` hook 対応済みの Codex build では、`apply_patch|Write|Edit` に対して shipped edit hooks も動き、Copilot lane に近い edit-time quality gate を Codex 側でも使えます。

低オーバーヘッドな追従フローとして、同じ launcher で `node scripts/codex-flow.js --workflow default "<task>"`, `--workflow bugfix`, `--workflow refactor`, `--workflow review`, `--resume-latest`, `--review-latest` を使えます。軽量な handoff file は同じ artifact root に保存され、`.github/sessions/checkpoint.md` は phase 実行中だけの一時 bridge として使います。常駐 watcher は shipped しません。

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

インストラクション、エージェント、スキル、プロンプト、フック、スキーマを `~/.copilot/` にインストールし、現在のユーザーの VS Code 設定を更新して全ワークスペースから参照できるようにします。後方互換のため、デフォルト provider は Copilot のままです。

同じ user-level installer で、`--provider codex` を指定すると Codex global assets も導入できます。`--provider all` なら Copilot と Codex の両方を入れます。Codex assets は `~/.codex/everything-githubcopilot/` と `~/.codex/skills/everything-githubcopilot/` に namespaced に配置されます。active な `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.codex/rules/everything-githubcopilot-security.rules` は安全な場合だけ作成し、既存の Codex config / hook files は上書きせず、managed template を namespace 側に残します。

user settings では、`~/.copilot` の instructions / agents / skills / prompts / hooks の discovery を有効化し、`AGENTS.md` discovery を有効、`CLAUDE.md` discovery を無効のまま維持します。あわせて legacy `.claude` rules / hooks の discovery は明示的に無効化して、repo の shipped baseline に揃えます。

### npm / npx

```bash
npm run install:user
npm run install:user:codex
npm run install:user:all
npm run uninstall:user
npm run reinstall:user
```

```bash
npx everything-githubcopilot install
npx everything-githubcopilot install --provider codex
npx everything-githubcopilot install --provider all
npx everything-githubcopilot uninstall
npx everything-githubcopilot reinstall
```

### Windows

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

アンインストール時は、インストール前の VS Code user settings の内容をそのまま復元します。`~/.copilot/` に既存の unmanaged な内容があり、installer state file が無い場合は上書きせず停止します。

Codex uninstall は別の `~/.codex/.everything-githubcopilot-codex-install.json` state file を使い、managed path だけを削除します。Codex lane を削除する場合は `everything-githubcopilot uninstall --provider codex`、`.\scripts\cleanup-system.ps1 -Provider codex`、または `./scripts/cleanup-system.sh codex` を使ってください。

installer は未公開の Autopilot 設定や default approvals、allowed tools を勝手に生成しません。opt-in で扱う approval 関連設定は `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions` のみで、これも `EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS=1` を付けて install を実行した時だけ有効になります。

---

## 使い方

- **Codex-only launcher:** project setup 後、target project で `node scripts/codex-flow.js "<task>"` を実行すると、default の外部 `plan -> implement -> review` lane を使い、phase artifact を `.github/sessions/codex-flow/` に保存します。
- **Codex workflows:** `node scripts/codex-flow.js --workflow bugfix "<task>"`、`--workflow refactor`、`--workflow review` で task に合わせた phase routing を使えます。
- **Codex incremental follow-up:** `node scripts/codex-flow.js --resume-latest` は最新 run の最初の未完了 phase から続行し、`node scripts/codex-flow.js --review-latest` は plan / implement 済みの最新 run の review phase だけを再実行します。
- **Prompts:** `/plan`, `/plan-and-implement`, `/architect`, `/tdd`, `/code-review`, `/review`, `/build-fix`, `/fix-test`, `/docs`, `/e2e`, `/refactor-clean`, `/research-plan`, `/checkpoint`, `/evolve`, `/learn`, `/verify`, `/knowledge-audit`
- **Verification:** `/verify` は現在の変更セットに対して repository verification loop を再実行し、既定ではファイルを変更せず regression や残リスクを報告します。
- **Knowledge audit:** `/knowledge-audit` は instructions, skills, prompts, agents の stale / contradiction / duplication / coverage gap を確認します。
- **Language reviews:** `/typescript-review`, `/python-review`, `/go-review`
- **Static AST exploration:** `npm run entry-points:index -- --root .`, `npm run entry-points:query -- --root . --query "semantic indexer"`, `npm run rust:index -- --root . --format summary`, `npm run rust:index -- --root . --file rust/semantic-indexer/src/cli.rs` で repository 全体の indexing、ranked entry-point lookup、semantic-indexer summary、file-level symbol inventory を確認できます。
- **User-visible agents:** `planner`, `coder`, `researcher`, `supporter` は planning、implementation、deep investigation、編集なしの safer support に直接使えます。
- **Internal specialists:** `architect`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `docs-lookup`, `e2e-runner`, `refactor-cleaner`, `best-practice-researcher`, `typescript-reviewer`, `python-reviewer`, `go-reviewer`, `agent-auditor`, `code-structure-auditor`, `design-coherence-auditor`, `knowledge-curator`, `safety-checker` は core agents や prompts から明示的に呼び出されます。

## Memory Surface

- **Session resume artifacts:** `/checkpoint` は `.github/sessions/checkpoint.md` を書き、`PreCompact` は `.github/sessions/compact-snapshot.md` を書きます。`SessionStart` は prior summaries より先にこれらの artifact を復元します。
- **Copilot/Codex 共通の continuity:** `.github/hooks/deterministic-hooks.json` の Copilot hooks と `.codex/hooks.json` の Codex hooks は同じ `scripts/hooks/*.js` memory layer を呼ぶため、両 provider は同じ local store に保存・復元します。
- **SQLite-backed continuity:** `scripts/hooks/db.js` は sessions, pending tasks, observations, project-scoped knowledge を `.github/sessions/copilot.db` に保存し、hosted memory service に依存せず次回 session で active work を復元します。
- **Hybrid retrieval:** `SessionStart` は keyword match、既に embedding 済みの knowledge、confidence、recency、hit count、project scope を組み合わせます。起動時に embedding model はロードしません。
- **Durable learnings:** `/learn` は保持すべき知識と保存先を整理します。sanitized で検索可能な repo knowledge にしたい場合は `node scripts/hooks/learn-embed.js` を使い、secret や一時 scratch note はこの経路に入れないでください。
- **Embedding backfill:** session 終了後に `node scripts/hooks/learn-embed.js --backfill --limit 25` を実行すると pending knowledge を非同期に embedding 化できます。`sqlite-vec` が使えない場合も row は保持され、keyword retrieval にフォールバックします。
- **Noise control:** auto-observation は `Bash -> Bash` のような低情報量の shell-only sequence を抑制し、trigger/action metadata を持つ error-resolution、workflow、hotspot knowledge を優先します。
- **Scope boundary:** core workflow continuity は shipped checkpoint, session, knowledge hooks が担います。GitHub Copilot built-in memory の有効化は任意で、この repository の必須要件ではありません。

## Optional MCP Integrations

- **Documentation lookup:** Context7 など documentation-oriented MCP server は setup や API 質問の鮮度を上げられますが、この repository はそれらなしで動作します。
- **Boundary:** `.vscode/mcp.json`、hosted memory、remote MCP tools を required install path として扱わないでください。Core prompts, agents, hooks, validators, default Codex profile は local fallback を維持します。

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
  config.toml                      # local-first Codex reference configuration
  AGENTS.md                        # Codex compatibility notes
  agents/                          # Codex multi-agent role configs
  hooks.json                       # Codex-compatible Bash / apply_patch hooks
  rules/                           # Codex execution policy rules

.agents/skills/                    # project setup が作成する Codex skill bridge

scripts/codex-flow.js              # project setup が配布する Codex-only workflow orchestrator

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
