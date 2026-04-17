# Orchestrateコマンド

複雑なタスクのための連続的なエージェントワークフロー。

これは workflow pattern の reference guide であり、このリポジトリがそのまま shipped する slash prompt ではありません。実際の shipped command surface は `.github/prompts/*.prompt.md` です。

## Codex CLI互換の注意

このドキュメントは `planner -> coder -> researcher` という標準レーンを定義するものです。Codex CLI では custom agent registry がビルドによって stable な picker として露出しない場合があるため、Codex 単独で同じ UI/UX を前提にしないでください。

- shipped な Codex-only front door としては、project setup 後の `node scripts/codex-flow.js "<task>"` を使います。これは external orchestrator として `plan -> implement -> review` を順に回し、artifact を `.github/sessions/codex-flow/` に保存します。
- 低オーバーヘッドな追従レーンとして、`node scripts/codex-flow.js --resume-latest` は最新 run の未完了 phase から再開し、`node scripts/codex-flow.js --review-latest` は review だけを再実行します。phase handoff は artifact root に残り、`.github/sessions/checkpoint.md` は phase 実行中だけの一時 bridge として使われます。
- Codex の named agent spawn が実ビルドで確認できた場合だけ、Codex 側で直接 delegation を使います。
- それ以外では Copilot か外部オーケストレータが phase と handoff を管理し、Codex は worker として参加させます。
- 単一スレッドで role prompt を切り替えるだけの代用は、このレーンの正式な代替として扱いません。

外部 orchestration に切り替える場合でも、root `AGENTS.md`、検証ループ、review lane、validation コマンドの境界は維持します。外に出すのは phase routing と handoff control だけです。

## 参照構文

`/orchestrate [ワークフロータイプ] [タスク説明]`

## ワークフロータイプ

### feature

完全な機能実装ワークフロー（四層エージェント）:

```
planner -> coder -> researcher
```

または、編集せずに相談から始める場合:

```
supporter -> planner -> coder -> researcher
```

### bugfix

バグ調査と修正ワークフロー:

```
coder -> researcher
```

### refactor

安全なリファクタリングワークフロー:

```
planner -> coder -> researcher
```

### security

セキュリティ重視のレビュー:

```
planner -> coder -> researcher + security-reviewer
```

## 四層エージェントアーキテクチャ

本システムはForgeCodeのmuse/forge/sageパターンに基づく四層エージェントアーキテクチャを採用しています:

### 実装レーン（編集あり）

| エージェント | 役割                 | モデル                        | ツールアクセス |
| ------------ | -------------------- | ----------------------------- | -------------- |
| planner      | 戦略計画             | 構成済み planning model       | 読み取り専用   |
| coder        | 実装・検証           | 構成済み implementation model | 完全アクセス   |
| researcher   | 調査サブエージェント | 構成済み research model       | 読み取り専用   |

ワークフロー: **planner → (handoff) → coder → (handoff) → researcher**
失敗時: **coder → (handoff) → planner** (再計画)

### 支援レーン（編集なし・安全）

| エージェント | 役割       | モデル                 | ツールアクセス |
| ------------ | ---------- | ---------------------- | -------------- |
| supporter    | 安全な支援 | 構成済み support model | 読み取り専用   |

ワークフロー: **supporter → (handoff) → planner** (実装計画へ昇格)
ワークフロー: **supporter → (handoff) → researcher** (深い調査)

## 実行パターン

ワークフロー内の各エージェントに対して:

1. 前のエージェントからのコンテキストで**エージェントを呼び出す**
2. 出力を構造化されたハンドオフドキュメントとして**収集**
3. チェーン内の**次のエージェントに渡す**
4. 結果を最終レポートに**集約**

Codex build の制約で custom agent picker が安定しない場合は、この実行パターン自体は維持しつつ、エージェントの切替を外部オーケストレータから制御します。この判断は target build / OS / profile ごとに smoke test で再確認してください。

## ハンドオフドキュメント形式

エージェント間でハンドオフドキュメントを作成します:

```markdown
## HANDOFF: [前のエージェント] -> [次のエージェント]

### コンテキスト

[実行された内容の要約]

### 発見事項

[重要な発見または決定]

### 変更されたファイル

[変更されたファイルのリスト]

### 未解決の質問

[次のエージェントのための未解決項目]

### 推奨事項

[推奨される次のステップ]
```

## 例: 機能ワークフロー（三層エージェント）

```
/orchestrate feature "Add user authentication"
```

以下を実行します:

1. **Plannerエージェント** (構成済み planning model, 読み取り専用)
   - 要件を分析
   - 実装計画を作成
   - 依存関係を特定
   - 出力: `HANDOFF: planner → coder`

2. **Coderエージェント** (構成済み implementation model, 完全アクセス)
   - プランナーのハンドオフを読み込む
   - 検証ループ（✅/❌）で実装
   - 必要に応じてresearcherを呼び出し
   - 出力: `HANDOFF: coder → researcher` または `HANDOFF: coder → (完了)`

3. **Researcherエージェント** (構成済み research model, 読み取り専用)
   - 変更差分の read-only review
   - 回帰とリスクの確認
   - 必要に応じて追加調査を実施
   - 出力: レビュー結果

### 検証ループ（Coderエージェント）

各ステップ実装後、以下を検証:

- ✅ 保存確認
- ✅ 構文チェック
- ✅ テスト実行
- ✅ 回帰チェック

3回失敗で `HANDOFF: coder → planner`（再計画）

## 最終レポート形式

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Add user authentication
Agents: planner → coder → researcher

SUMMARY
-------
[1段落の要約]

AGENT OUTPUTS
-------------
Planner: [計画要約]
Coder: [実装要約、検証結果]
Researcher: [調査結果（該当する場合）]

FILES CHANGED
-------------
[変更されたすべてのファイルをリスト]

VERIFICATION RESULTS
--------------------
- ✅ 保存確認
- ✅ 構文チェック
- ✅ テスト実行: XX/XX 成功
- ✅ 回帰チェック

TEST RESULTS
------------
[テスト合格/不合格の要約]

SECURITY STATUS
---------------
[セキュリティの発見事項]

RECOMMENDATION
--------------
[リリース可 / 要修正 / ブロック中]
```

## 並行実行

独立したチェックの場合、エージェントを並行実行します:

```markdown
### 並行フェーズ

同時に実行:

- code-reviewer (高リスク変更の品質レビュー)
- security-reviewer (セキュリティ)
- architect (設計)

### 結果のマージ

出力を単一のレポートに結合
```

## 引数

$ARGUMENTS:

- `feature <説明>` - 完全な機能ワークフロー
- `bugfix <説明>` - バグ修正ワークフロー
- `refactor <説明>` - リファクタリングワークフロー
- `security <説明>` - セキュリティレビューワークフロー
- `custom <エージェント> <説明>` - カスタムエージェントシーケンス

`custom` シーケンスは control plane が agent routing を実行できる前提の記法です。Codex current build で direct named delegation が不安定な場合、これを Codex 単独の stable UI とみなさないでください。

## カスタムワークフローの例

```
/orchestrate custom "architect,tdd-guide,researcher" "Redesign caching layer"
```

## ヒント

1. 複雑な機能には**plannerから始める**
2. 高リスク変更では**code-reviewerを含める**
3. 認証/決済/個人情報には**security-reviewerを使用**
4. **ハンドオフを簡潔に保つ** - 次のエージェントが必要とするものに焦点を当てる
5. 必要に応じて**エージェント間で検証を実行**
