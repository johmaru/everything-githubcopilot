---
name: strategic-compact
description: 任意の自動コンパクションではなく、タスクフェーズを通じてコンテキストを保持するための論理的な間隔での手動コンパクションを提案します。
---

# Strategic Compactスキル

任意の自動コンパクションに依存するのではなく、ワークフローの戦略的なポイントで手動の`/compact`を提案します。

## 有効化する場面

- 長いセッションで context pressure が高い時
- 調査 → 計画 → 実装 → テストのようにフェーズが切り替わる時
- 大きなマイルストーン完了後に次のフェーズへ移る時
- 別タスクへ切り替える前に探索コンテキストを整理したい時

## なぜ戦略的コンパクションか？

自動コンパクションは任意のポイントでトリガーされます：
- 多くの場合タスクの途中で、重要なコンテキストを失う
- タスクの論理的な境界を認識しない
- 複雑な複数ステップの操作を中断する可能性がある

論理的な境界での戦略的コンパクション：
- **探索後、実行前** - 研究コンテキストをコンパクト、実装計画を保持
- **マイルストーン完了後** - 次のフェーズのために新しいスタート
- **主要なコンテキストシフト前** - 異なるタスクの前に探索コンテキストをクリア

## 仕組み

このリポジトリの現行実装では、以下が baseline です。

1. `PreCompact` hook が compaction 前に `.github/sessions/compact-snapshot.md` を書き出す
2. `SessionStart` が `checkpoint.md`、`compact-snapshot.md`、prior summaries から resume する
3. ユーザーが論理的な区切りで manual `/compact` を実行する

この時点での supported path は **manual `/compact`** です。

既存の reminder script `suggest-compact.sh` は optional で、デフォルトでは配線されていません。

もし `suggest-compact.sh` や同等の reminder を有効化する場合は、PreToolUse（Edit/Write）で実行して次を行います：

1. **ツール呼び出しを追跡** - セッション内のツール呼び出しをカウント
2. **閾値検出** - 設定可能な閾値で提案（デフォルト：50回）
3. **定期的なリマインダー** - 閾値後25回ごとにリマインド

## フック設定

このリポジトリで現在すでに有効なもの：

- `PreCompact` は配線済み
- manual `/compact` が Phase 2 の supported path

optional な reminder 配線例：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command", "command": "bash .github/skills/strategic-compact/suggest-compact.sh" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "bash .github/skills/strategic-compact/suggest-compact.sh" }]
      }
    ]
  }
}
```

## 設定

環境変数：
- `COMPACT_THRESHOLD` - 最初の提案前のツール呼び出し（デフォルト：50、optional な reminder hook を有効にした場合のみ適用）

## コンパクション判断ガイド

| フェーズ遷移 | compact するか | 理由 |
|-------------|----------------|------|
| Research → Planning | Yes | 調査コンテキストは重く、計画が要約結果になる |
| Planning → Implementation | Yes | 計画を保持しつつコード用の余白を作れる |
| Implementation → Testing | Maybe | 直前のコード詳細が必要なら保持する |
| Debugging → Next feature | Yes | デバッグ痕跡を次タスクへ持ち込まない |
| Mid-implementation | No | 変数名や file path を失うコストが高い |
| Failed approach 後 | Yes | 行き止まりの思考を切ってやり直せる |

## コンパクション後に残るもの

| 残るもの | 失われるもの |
|----------|--------------|
| `copilot-instructions.md` | 中間推論や詳細な会話履歴 |
| TodoWrite のタスクリスト | 以前読んだファイル内容 |
| memory files | 細かな文脈の積み上げ |
| Git state | ツール呼び出し履歴 |
| disk 上のファイル | 会話だけで伝えた細かな好み |

## ベストプラクティス

1. **計画後にコンパクト** - 計画が確定したら、コンパクトして新しくスタート
2. **デバッグ後にコンパクト** - 続行前にエラー解決コンテキストをクリア
3. **実装中はコンパクトしない** - 関連する変更のためにコンテキストを保持
4. **提案を読む** - フックは*いつ*を教えてくれますが、*するかどうか*は自分で決める
5. **コンパクト前に書き残す** - 必要な context は `/checkpoint` や file に保存してから実行する
6. **manual `/compact` に要約を添える** - 例: `/compact focus on Phase 2 resume continuity`

## 関連

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - トークン最適化セクション
- メモリ永続化フック - コンパクションを超えて存続する状態用
- `continuous-learning` スキル - セッション終了前の学習抽出
