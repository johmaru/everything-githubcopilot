# Agent オーケストレーション

## 利用可能な Agent

`.github/agents/` を source of truth として参照:

### ユーザーから直接呼び出せるコア Agent

| Agent      | 目的                   | 使用タイミング               |
| ---------- | ---------------------- | ---------------------------- |
| planner    | 実装計画               | 複雑な機能、リファクタリング |
| coder      | 実装・検証             | 直接実装するとき             |
| researcher | 深い調査・分析         | コードベース調査が必要なとき |
| supporter  | 安全な支援（編集なし） | 編集せずに相談したいとき     |

### 内部専門 Agent

| Agent                    | 目的                           | 使用タイミング               |
| ------------------------ | ------------------------------ | ---------------------------- |
| architect                | システム設計                   | アーキテクチャの意思決定     |
| tdd-guide                | テスト駆動開発                 | 新機能、バグ修正             |
| code-reviewer            | コードレビュー                 | 高リスクまたは横断的変更時   |
| security-reviewer        | セキュリティ分析               | コミット前                   |
| build-error-resolver     | ビルドエラー修正               | ビルド失敗時                 |
| e2e-runner               | E2Eテスト                      | 重要なユーザーフロー         |
| refactor-cleaner         | デッドコードクリーンアップ     | コードメンテナンス           |
| safety-checker           | 編集後安全性チェック           | 高リスク編集直後             |
| agent-auditor            | Agent定義監査                  | 構造整合性チェック時         |
| best-practice-researcher | ベストプラクティス調査         | 実装前の調査                 |
| code-structure-auditor   | コード構造監査                 | インポートや参照の整合性確認 |
| design-coherence-auditor | 設計整合性監査                 | スキーマや型の整合性確認     |
| docs-lookup              | ドキュメント検索               | API・ライブラリ参照時        |
| go-reviewer              | Go コードレビュー              | Go 変更時                    |
| knowledge-curator        | ナレッジ蓄積                   | 学習・知識管理               |
| python-reviewer          | Python コードレビュー          | Python 変更時                |
| typescript-reviewer      | TypeScript/JavaScript レビュー | TS/JS 変更時                 |

注記: 実装レーンの既定 review は planner -> coder -> researcher で、code-reviewer は高リスクまたは横断的変更に追加で使います。

## Agent の即座の使用

ユーザープロンプト不要:

1. 複雑な機能リクエスト - **planner** agent を使用
2. 高リスクなコード作成/変更直後 - **code-reviewer** agent を使用
3. バグ修正または新機能 - **tdd-guide** agent を使用
4. アーキテクチャの意思決定 - **architect** agent を使用

高リスク変更には、workspace instructions、agents、file instructions、prompts、skills、hooks、installer scripts、package metadata、validators、schemas、security-sensitive automation が含まれます。

## 並列タスク実行

独立した操作には常に並列 Task 実行を使用してください:

```markdown
# 良い例: 並列実行

3つの agent を並列起動:

1. Agent 1: 認証モジュールのセキュリティ分析
2. Agent 2: キャッシュシステムのパフォーマンスレビュー
3. Agent 3: ユーティリティの型チェック

# 悪い例: 不要な逐次実行

最初に agent 1、次に agent 2、そして agent 3
```

## 多角的分析

複雑な問題には、役割分担したサブ agent を使用:

- 事実レビュー担当
- シニアエンジニア
- セキュリティエキスパート
- 一貫性レビュー担当
- 冗長性チェック担当
