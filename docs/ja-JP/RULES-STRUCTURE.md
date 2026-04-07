# ルール構造ガイド（Rules Structure Guide）

このリポジトリにおける GitHub Copilot カスタマイズの全体構造を文書化します。

## ディレクトリ全体像

```
.github/                              ← 設定の源泉（Source of Truth）
├── copilot-instructions.md           ← 常時有効なプロジェクト全体ガイダンス
├── instructions/                     ← ファイルスコープのルール
│   ├── common-*.instructions.md      ← 全言語共通ルール（10ファイル）
│   ├── {lang}-*.instructions.md      ← 言語別ルール（複数言語 × 5カテゴリ）
│   ├── javascript-node.instructions.md
│   ├── markdown-customizations.instructions.md
│   ├── tdd-workflow-standards.instructions.md
│   └── legacy-migration.instructions.md
├── agents/                           ← 専門エージェント定義（21体、うち4体がユーザー直接呼び出し可能）
├── prompts/                          ← スラッシュワークフロー（20個）
├── hooks/                            ← 決定論的フック定義
│   └── deterministic-hooks.json
└── skills/                           ← ドメインナレッジパッケージ（120+）

scripts/hooks/                        ← フック実装スクリプト（23ファイル、以下は代表例）
├── _shared.js                        ← 共通ユーティリティ
├── db.js                             ← SQLite DAOレイヤー
├── embedding.js                      ← ベクトル埋め込みモジュール
├── session-start.js                  ← SessionStartフック
├── session-stop.js                   ← Stopフック
├── pre-compact.js                    ← PreCompactフック
├── learn-embed.js                    ← ナレッジ学習CLI
├── safety-backup.js                  ← 一時安全バックアップCLI
├── quality-gate.js                   ← 品質ゲートチェック
├── config-protection.js              ← 設定ファイル保護
├── doc-file-warning.js               ← ドキュメントパス警告
├── post-edit-format.js               ← 自動フォーマット
├── post-edit-typecheck.js            ← TypeScriptチェック
├── post-edit-console-warn.js         ← console.log警告
├── observe-tool.js                   ← ツール観測ログ
└── pre-bash-git-push-reminder.js     ← git push前確認
```

---

## 1. Instructions（ルール / 指示ファイル）

### 概要

`applyTo` パターンにより、対象ファイルにのみ自動適用されるルールです。

### 命名規則

```
{scope}-{category}.instructions.md
```

- **scope**: `common`（全ファイル）または言語名（`typescript`, `python` 等）
- **category**: `coding-style`, `testing`, `security`, `patterns`, `hooks`

### 共通ルール（Common）— 全ファイル適用

| ファイル                      | 内容                                               | applyTo                                 |
| ----------------------------- | -------------------------------------------------- | --------------------------------------- |
| `common-agents`               | エージェント呼び出し規則                           | `**/*`                                  |
| `common-coding-style`         | イミュータビリティ、ファイル構成                   | `**/*`                                  |
| `common-development-workflow` | 開発ワークフロー（Research → Plan → TDD → Review） | `**/*`                                  |
| `common-git-workflow`         | コミットメッセージ形式、PR手順                     | `**/*`                                  |
| `common-hooks`                | フックシステム使用方針                             | `**/*`                                  |
| `common-patterns`             | 共通デザインパターン                               | `**/*`                                  |
| `common-performance`          | モデル選択、コンテキストウィンドウ管理             | `**/*`                                  |
| `common-quality-standards`    | 品質・セキュリティ基準                             | `.github/**/*.md`, `scripts/**/*.js` 等 |
| `common-security`             | セキュリティチェックリスト                         | `**/*`                                  |
| `common-testing`              | テスト要件（TDD、80%カバレッジ）                   | `**/*`                                  |

### 言語別ルール — 11言語対応

各言語に5カテゴリのルールファイルがあります：

| カテゴリ              | 内容                 |
| --------------------- | -------------------- |
| `{lang}-coding-style` | コーディングスタイル |
| `{lang}-testing`      | テスト手法           |
| `{lang}-security`     | セキュリティ対策     |
| `{lang}-patterns`     | デザインパターン     |
| `{lang}-hooks`        | フック設定           |

**対応言語**: TypeScript/JavaScript, Python, Rust, Go, Java, Kotlin, C++, C#, Swift, PHP, Perl

### 特殊ルール

| ファイル                  | 対象                                 | 用途                   |
| ------------------------- | ------------------------------------ | ---------------------- |
| `javascript-node`         | `**/*.js`, `**/*.ts`, `package.json` | Node.js / JS / TS 全般 |
| `markdown-customizations` | `**/*.md`                            | Markdownカスタマイズ   |
| `tdd-workflow-standards`  | `scripts/**/*.js`, `tests/**/*.js`   | TDDワークフロー        |
| `legacy-migration`        | `.codex/**`, `.opencode/**`          | レガシー互換性         |

---

## 2. Agents（エージェント定義）

### 概要

特定の役割を持つ専門エージェントです。プロンプトやワークフロー、またはコアエージェントから明示的に呼び出されます。

### 一覧（21体）

#### ユーザーから直接呼び出し可能なコアエージェント（4体）

| エージェント | 役割                   | 使用タイミング           |
| ------------ | ---------------------- | ------------------------ |
| `planner`    | 実装計画               | 複雑な機能・リファクタ   |
| `coder`      | 実装・検証             | 計画に基づく実装時       |
| `researcher` | 深い調査・分析         | コードベース調査が必要時 |
| `supporter`  | 安全な支援（編集なし） | 編集せずに相談したい時   |

#### 内部専門エージェント（プロンプト/workflowから明示呼び出し）（17体）

これらのエージェントは `user-invocable: false` が設定されており、ユーザーから直接呼び出すことはできません。代わりに、コアエージェント（planner/coder/researcher/supporter）やプロンプトファイルから必要に応じて呼び出されます。

| エージェント               | 役割                   | 使用タイミング               |
| -------------------------- | ---------------------- | ---------------------------- |
| `architect`                | システム設計           | アーキテクチャ決定時         |
| `best-practice-researcher` | ベストプラクティス調査 | 実装前の調査                 |
| `build-error-resolver`     | ビルドエラー修正       | ビルド失敗時                 |
| `code-reviewer`            | コードレビュー         | 高リスクまたは横断変更時     |
| `docs-lookup`              | ドキュメント検索       | API・ライブラリ参照時        |
| `e2e-runner`               | E2Eテスト              | クリティカルフロー検証       |
| `go-reviewer`              | Go コードレビュー      | Go 変更時                    |
| `knowledge-curator`        | ナレッジ蓄積           | 学習・知識管理               |
| `python-reviewer`          | Python コードレビュー  | Python 変更時                |
| `refactor-cleaner`         | デッドコード削除       | コードメンテナンス           |
| `security-reviewer`        | セキュリティ分析       | コミット前                   |
| `safety-checker`           | 編集後安全性チェック   | 高リスク編集直後             |
| `tdd-guide`                | TDD支援                | 新機能・バグ修正             |
| `typescript-reviewer`      | TS/JS コードレビュー   | TypeScript/JavaScript 変更時 |
| `agent-auditor`            | エージェント定義監査   | 構造整合性チェック時         |
| `code-structure-auditor`   | コード構造監査         | インポート・参照整合性時     |
| `design-coherence-auditor` | 設計整合性監査         | スキーマ・型整合性時         |

### フロントマター形式

```yaml
---
name: 'agent-name'
description: '呼び出し条件の説明'
argument-hint: '引数の説明'
---
```

---

## 3. Prompts（スラッシュワークフロー）

### 概要

`/command` 形式で呼び出す再利用可能なワークフローです。各プロンプトは通常、専門エージェントに紐づきます。

### 一覧（20個）

| プロンプト            | エージェント             | 用途                       |
| --------------------- | ------------------------ | -------------------------- |
| `/plan`               | planner                  | 実装計画の作成             |
| `/plan-and-implement` | planner                  | 計画から実装まで一括実行   |
| `/architect`          | architect                | アーキテクチャレビュー     |
| `/tdd`                | tdd-guide                | TDDワークフロー実行        |
| `/code-review`        | code-reviewer            | 高リスク変更のレビュー     |
| `/review`             | researcher               | 汎用レビュー               |
| `/build-fix`          | build-error-resolver     | ビルドエラーの修正         |
| `/fix-test`           | build-error-resolver     | テスト失敗の修正           |
| `/docs`               | docs-lookup              | ドキュメント参照           |
| `/e2e`                | e2e-runner               | E2Eテスト生成・実行        |
| `/refactor-clean`     | refactor-cleaner         | デッドコード削除           |
| `/research-plan`      | best-practice-researcher | ベストプラクティス調査     |
| `/python-review`      | python-reviewer          | Pythonレビュー             |
| `/go-review`          | go-reviewer              | Goレビュー                 |
| `/typescript-review`  | typescript-reviewer      | TS/JSレビュー              |
| `/learn`              | knowledge-curator        | ナレッジ学習・記録         |
| `/knowledge-audit`    | knowledge-curator        | ナレッジ資産監査           |
| `/checkpoint`         | knowledge-curator        | セッションチェックポイント |
| `/verify`             | coder                    | 実装検証ループ             |
| `/evolve`             | knowledge-curator        | ナレッジ進化               |

### フロントマター形式

```yaml
---
name: 'command-name'
description: '説明'
agent: 'agent-name' # オプション
argument-hint: '引数の説明'
---
```

---

## 4. Hooks（決定論的フック）

### 概要

ツール実行やセッションイベントに対して自動実行される決定論的な処理です。`deterministic-hooks.json` で定義されます。

### イベントタイプ

#### PreToolUse — ツール実行前

| マッチャー               | スクリプト                      | 動作                                        |
| ------------------------ | ------------------------------- | ------------------------------------------- |
| `git` コマンド           | `npx block-no-verify`           | `--no-verify` フラグをブロック              |
| `git push`               | `pre-bash-git-push-reminder.js` | push前にレビューを促す                      |
| `Write`                  | `doc-file-warning.js`           | 非標準ドキュメントパスを警告                |
| `Write\|Edit\|MultiEdit` | `config-protection.js`          | リンター/フォーマッター設定の編集をブロック |

#### PostToolUse — ツール実行後

| マッチャー               | スクリプト                  | 動作                             |
| ------------------------ | --------------------------- | -------------------------------- |
| `*`                      | `observe-tool.js`           | ツール利用の観測ログを記録       |
| `Edit\|Write\|MultiEdit` | `quality-gate.js`           | 品質ゲートチェック（async、30s） |
| `Edit\|Write\|MultiEdit` | `post-edit-format.js`       | JS/TSファイルの自動フォーマット  |
| `Edit\|Write\|MultiEdit` | `post-edit-typecheck.js`    | TypeScriptチェック（async）      |
| `Edit\|Write\|MultiEdit` | `post-edit-console-warn.js` | `console.log` の存在を警告       |

#### SessionStart — セッション開始時

| スクリプト         | 動作                                                   | タイムアウト |
| ------------------ | ------------------------------------------------------ | ------------ |
| `session-start.js` | 前回セッションの要約・未完了タスク・蓄積ナレッジを注入 | 60秒         |

#### Stop — セッション終了時

| スクリプト                       | 動作                                   | タイムアウト |
| -------------------------------- | -------------------------------------- | ------------ |
| `session-stop.js`                | セッション要約をSQLiteに永続化         | 10秒         |
| `safety-backup.js cleanup`       | 当該セッションの一時バックアップを削除 | 10秒         |
| `post-edit-typecheck.js cleanup` | 非同期TypeScriptチェック状態を削除     | 10秒         |

#### PreCompact — コンテキスト圧縮前

| スクリプト       | 動作                                 | タイムアウト |
| ---------------- | ------------------------------------ | ------------ |
| `pre-compact.js` | ワークスペース状態のスナップショット | 10秒         |

---

## 5. Skills（ドメインナレッジパッケージ）

### 概要

特定のドメイン知識や高度なワークフローをカプセル化したパッケージです。必要に応じてオンデマンドで読み込まれます。

### 構造

```
.github/skills/{skill-name}/
├── SKILL.md              ← メインのスキル定義（必須）
├── scripts/              ← 補助スクリプト（オプション）
└── ...                   ← その他のリソース
```

### スキルカテゴリ（120+ スキル）

| カテゴリ           | スキル例                                                            | 数   |
| ------------------ | ------------------------------------------------------------------- | ---- |
| **AIエージェント** | agent-eval, agent-harness-construction, agentic-engineering         | ~10  |
| **フロントエンド** | frontend-patterns, frontend-slides, design-system                   | ~5   |
| **バックエンド**   | backend-patterns, api-design, django-patterns                       | ~10  |
| **データベース**   | postgres-patterns, clickhouse-io, database-migrations               | ~5   |
| **テスト**         | tdd-workflow, e2e-testing, ai-regression-testing                    | ~8   |
| **セキュリティ**   | security-review, security-scan, safety-guard                        | ~5   |
| **言語別**         | python-patterns, rust-patterns, golang-patterns, kotlin-patterns 等 | ~30  |
| **DevOps**         | deployment-patterns, docker-patterns, verification-loop             | ~5   |
| **コンテンツ**     | article-writing, content-engine, video-editing                      | ~8   |
| **ドメイン専門**   | carrier-relationship-management, energy-procurement 等              | ~10  |
| **その他**         | blueprint, deep-research, prompt-optimizer, codebase-onboarding 等  | ~20+ |

### フロントマター形式

```yaml
---
name: skill-name
description: 'スキルの説明'
tools: Read, Write, Edit, Bash # オプション：使用ツール制限
---
```

---

## 6. フック実装スクリプト

### 概要

`scripts/hooks/` 以下のJavaScriptファイルが実際のフック処理を実装します。

### 永続化基盤

| ファイル       | 役割                                              |
| -------------- | ------------------------------------------------- |
| `_shared.js`   | stdin解析、JSON出力、ファイルI/O共通関数          |
| `db.js`        | SQLite DAOレイヤー（better-sqlite3 + sqlite-vec） |
| `embedding.js` | ベクトル埋め込み生成（@huggingface/transformers） |

### データフロー

```
SessionStart ──┐
               ▼
┌──────────────────────────┐     ┌────────────────────┐
│ session-start.js         │────▶│ SQLite (copilot.db) │
│ • 前回サマリー注入       │     │ • sessions          │
│ • 未完了タスク注入       │     │ • session_files     │
│ • 蓄積ナレッジ注入       │     │ • pending_tasks     │
│ • 追加コンテキスト注入   │     │ • knowledge         │
└──────────────────────────┘     │ • knowledge_vec     │
                                 └────────────────────┘
               ▲                          ▲
┌──────────────┘                          │
│ session-stop.js           learn-embed.js│
│ • セッション要約保存      • ナレッジ保存│
│ • 変更ファイル記録        • 埋め込み生成│
│ • 未完了タスク保存                      │
└──────────────────────────┐              │
               ▼           ▼              │
pre-compact.js             /learn ────────┘
│ • 圧縮前スナップショット
```

### DB スキーマ

| テーブル        | 用途                                                 |
| --------------- | ---------------------------------------------------- |
| `sessions`      | セッション記録（開始/終了時刻、ブランチ、要約）      |
| `session_files` | セッション中の変更ファイル                           |
| `pending_tasks` | 未完了タスク                                         |
| `knowledge`     | 蓄積ナレッジ（source, kind, content）                |
| `knowledge_vec` | ナレッジのベクトル埋め込み（sqlite-vec, float[384]） |

---

## 7. セットアップと依存関係

### ネイティブ依存関係

| パッケージ                  | バージョン | 用途                     |
| --------------------------- | ---------- | ------------------------ |
| `better-sqlite3`            | ^12.8.0    | SQLiteセッション永続化   |
| `sqlite-vec`                | ^0.1.8     | ベクトル類似検索         |
| `@huggingface/transformers` | ^3.8.1     | ローカルONNX埋め込み生成 |

### インストール方法

```bash
# プロジェクト単位
./scripts/setup-project.sh /path/to/your-project

# npm / npx で user-level install
npm run install:user
npx everything-githubcopilot install

# ユーザー単位
./scripts/setup-system.sh      # Linux/Mac
.\scripts\setup-system.ps1     # Windows
```

`session-start.js` は初回チャット時に前回セッション要約と蓄積コンテキストを注入します。

---

## 8. ルールの優先順位

```
copilot-instructions.md        ← 最高優先度（常時有効）
  ↓
instructions/*.instructions.md  ← applyToパターンでスコープ限定
  ↓
agents/*.agent.md              ← エージェント呼び出し時に適用
  ↓
prompts/*.prompt.md            ← /command 実行時に適用
  ↓
hooks/deterministic-hooks.json ← イベント駆動で自動実行
  ↓
skills/*/SKILL.md              ← オンデマンドで読み込み
```

### 設計原則

1. **`.github/` を唯一の真実源とする** — 他のディレクトリに権威あるガイダンスを置かない
2. **決定論的ロードを優先** — セマンティック検出への依存を最小化
3. **小さなファイルに分割** — 1ファイルを肥大化させず分割する
4. **applyTo の明示** — 暗黙のスコープを避ける
5. **description で発見性を確保** — Copilotが自動検出できる記述的な説明文

---

## 9. 検証コマンド

```bash
# フック定義の検証
node scripts/ci/validate-github-hooks.js

# Copilotカスタマイズの検証
node scripts/ci/validate-copilot-customizations.js

# 個人パスの混入チェック
node scripts/ci/validate-no-personal-paths.js

# 全検証
npm run validate

# リント
npm run lint
```
