# コマンド

このリポジトリのユーザー向け command surface は、`.github/prompts/*.prompt.md` にある slash prompt です。VS Code の Copilot Chat で `/command-name` と入力して起動します。

## アクティブなコマンドカテゴリ

### 計画 & 調査

- `/plan` - 実装計画を作成
- `/plan-and-implement` - 実装計画を作り、低リスクならそのまま実装へ handoff する
- `/architect` - アーキテクチャ観点で検討する
- `/research-plan` - 調査を含む計画を作成
- `/learn` - セッションや作業から学習事項を保存する
- `/checkpoint` - 現在の状態を要約し、次の再開点を残す
- `/evolve` - 学習事項を恒久的な guidance に昇格させる
- `/knowledge-audit` - instructions / skills / prompts / agents の知識整合性を監査する

### 実装 & 検証

- `/tdd` - テスト駆動で変更を進める
- `/build-fix` - ビルドや validator エラーを最小差分で修正する
- `/fix-test` - failing test / build / validator を診断し最小修正する
- `/e2e` - E2E テストを実行する
- `/verify` - 現在の変更に対して保存確認・diagnostics・テスト・回帰チェックを行う

### レビュー & ドキュメント

- `/code-review` - 現在の差分をレビューする
- `/review` - 実装やコード領域を read-only で調査レビューする
- `/docs` - ドキュメント更新を支援する
- `/refactor-clean` - 低リスクな整理を行う
- `/typescript-review` - TypeScript / JavaScript をレビューする
- `/python-review` - Python をレビューする
- `/go-review` - Go をレビューする

## コマンド実行

VS Code の Copilot Chat で実行します:

```text
/plan
/tdd
/verify
/knowledge-audit
```

## よく使うフロー

### 開発フロー

1. `/plan` - 実装計画を作成
2. `/tdd` - テストと実装を進める
3. `/code-review` - 差分をレビューする
4. `/verify` - 変更セット全体を再検証する

### 知識メンテナンス

1. `/checkpoint` - 現在の状態を保存する
2. `/learn` - 再利用価値のある学習事項を記録する
3. `/evolve` - 恒久的な guidance に昇格させる
4. `/knowledge-audit` - stale / contradiction / duplication を監査する

## 新しいコマンドを追加

カスタムコマンドを追加するには、`.github/prompts/` に `.prompt.md` ファイルを作成します。

```markdown
---
name: 'command-name'
description: 'Short discovery text shown in slash prompt search'
agent: 'planner'
argument-hint: 'Optional user input hint'
---

Use [the repository-wide instructions](../copilot-instructions.md) and any relevant files in [../instructions](../instructions).

1. Describe the task.
2. State the expected output.
3. Stop or hand off as needed.
```

`description` は discovery surface なので、用途が分かる trigger phrase を入れてください。
