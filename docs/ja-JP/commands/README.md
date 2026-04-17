# コマンド

VS Code の Copilot Chat におけるユーザー向け command surface は、`.github/prompts/*.prompt.md` にある slash prompt です。VS Code の Copilot Chat で `/command-name` と入力して起動します。

Codex CLI では別の shipped surface があり、project setup 後の target project で `node scripts/codex-flow.js "<task>"` を実行します。これは project-local な external orchestrator で、`plan -> implement -> review` を順に回します。常駐 watcher は shipped せず、軽い follow-up lane として `--resume-latest` と `--review-latest` を使います。

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

## Codex CLI の起動

project setup 後の target project で実行します:

```bash
node scripts/codex-flow.js "add a codex-only launcher"
node scripts/codex-flow.js --resume-latest
node scripts/codex-flow.js --review-latest
```

artifact は `.github/sessions/codex-flow/` に保存されます。

`--resume-latest` は最新 run の未完了 phase から再開し、`--review-latest` は review だけを再実行します。active phase の handoff は artifact root 配下に残り、`.github/sessions/checkpoint.md` は phase 実行中だけの一時 bridge として使われます。

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
