# Phase 2 Context Management Verification

この文書は、Phase 2 のうち VS Code 実行面でしか観測できない項目を手動で確認するためのプロトコルです。

## 目的

- manual `/compact` の実運用を再現可能な手順にする
- auto-compaction 95% 閾値の観測方法を残す
- `20ターン` 超セッションと `10ステップ超` タスクの成功基準を evidence として残す

## 事前条件

- `.github/hooks/deterministic-hooks.json` で `SessionStart` と `PreCompact` が有効
- `scripts/hooks/session-start.js` と `scripts/hooks/pre-compact.js` が最新
- `npm test` と `npm run lint` が直前の変更で通っている

## シナリオ A: manual compact resume

### 目的

`/compact focus on` を使った後に、checkpoint と compact snapshot が優先注入されることを確認する。

### 手順

1. 5 ターン以上の調査または実装セッションを作る
2. `/checkpoint` を実行する
3. `/compact focus on Phase 2 resume continuity` を実行する
4. 次のセッション開始時の追加コンテキストを確認する

### 期待結果

- `checkpoint.md` の内容が prior summaries より前に入る
- `compact-snapshot.md` の branch と modified files が続けて入る
- active tasks が `## Active Tasks` として復帰する
- 読み込まれた `checkpoint.md` と `compact-snapshot.md` は consume-once で削除される

### 保存する evidence

- セッション日時
- branch
- 注入された先頭 2 セクションの要約
- consume-once が確認できたか

### 記録テンプレート

- シナリオ ID: A
- 実施日時: YYYY-MM-DD HH:mm
- セッション種別: manual `/compact focus on`
- 事前 artifact: `checkpoint.md` / `compact-snapshot.md` の有無
- 観測結果: 先頭 2 セクションの順序、Active Tasks の復元有無、consume-once の結果
- artifact / context: 注入された branch、modified files、追加コンテキストの要約
- 結果: Pass / Fail と 1 行要約
- 継続判断: 再試行 / 継続 / 追加調査 / 完了扱い のいずれか。必要なら補足で `PRODUCT 転記` を添える

### 完了判定

- `Checkpoint Resume` と `Pre-Compact Snapshot` が prior summaries より前に並ぶ
- `checkpoint.md` と `compact-snapshot.md` の consume-once が確認できる
- 上の記録テンプレートを埋めた上で `PRODUCT.md` へ転記できる状態になっている

## シナリオ B: auto-compaction 95% threshold

### 目的

VS Code 実行面で自動 compaction が発火した時でも `PreCompact` snapshot が残ることを確認する。

### 手順

1. 長い探索セッションを継続して context pressure を高める
2. auto-compaction が走るまで対話を続ける
3. compaction 後の次ターンまたは次セッションで追加コンテキストを確認する

### 期待結果

- `.github/sessions/compact-snapshot.md` が compaction 前に生成される
- 次回 `SessionStart` で snapshot が prior summaries より前に注入される
- modified files は最大 10 件で切り詰められる

### 保存する evidence

- compaction が起きた時刻
- snapshot に含まれた branch
- modified files の件数

### 記録テンプレート

- シナリオ ID: B
- 実施日時: YYYY-MM-DD HH:mm
- セッション種別: auto-compaction 95% threshold
- 発火条件: context pressure と compaction 発生の観測方法
- 観測結果: snapshot 生成、注入順、modified files の切り詰め状況
- artifact / context: snapshot 内の branch、収集件数、表示件数、次回 SessionStart の要約
- 結果: Pass / Fail と 1 行要約
- 継続判断: 再試行 / 継続 / 追加調査 / 完了扱い のいずれか。必要なら補足で `再観測` や `計測補強` を添える

### 完了判定

- compaction 前に `.github/sessions/compact-snapshot.md` が生成される
- 次回 `SessionStart` で snapshot が prior summaries より前に注入される
- 10 件上限や切り詰めの事実を記録テンプレートで説明できる

## シナリオ C: 10-step phase split continuity

### 目的

`10ステップ超` のタスクで planner がフェーズ分割し、次フェーズで resume continuity が保たれることを確認する。

### 手順

1. planner に 10 ステップ超の計画を必要とするタスクを依頼する
2. フェーズ分割された計画を保存する
3. 途中で `/checkpoint` または `/compact focus on` を挟む
4. 次フェーズで coder が計画を継続できるか確認する

### 期待結果

- planner 出力に phase split が現れる
- 次フェーズ開始時に必要な context が失われていない
- TODO と active tasks が continuation を支える形で復元される

### 保存する evidence

- planner 出力の phase split 要約
- resume 後に保持されていた未完了ステップ
- `Resume Metadata` の `Active Task Count` / `Displayed Task Count` / `Active Tasks Truncated`
- coder が追加質問なしで続行できたか

### 記録テンプレート

- シナリオ ID: C
- 実施日時: YYYY-MM-DD HH:mm
- 対象タスク: 10 ステップ超の planner タスク名
- phase split: planner が分割したフェーズ要約
- 観測結果: 復元された Active Tasks、未完了ステップ、coder の継続可否
- artifact / context: checkpoint / compact の有無、resume 後に残った要点の要約
- 結果: Pass / Fail と 1 行要約
- 継続判断: 再試行 / 継続 / 追加調査 / 完了扱い のいずれか。必要なら補足で `フェーズ継続` や `resume 改善` を添える

### 完了判定

- planner 出力に 10 ステップ超タスクのフェーズ分割が確認できる
- resume 後に未完了ステップと Active Tasks が continuation を支える形で残る
- `Resume Metadata` で active tasks の総件数と表示件数の差分を判断できる
- coder が追加質問なしで次フェーズを続行できたか判断できる

## 成功基準

- `20ターン` 以上の会話で checkpoint / compact / resume を挟んでも品質が明確に崩れない
- `10ステップ超` のタスクで phase split と引き継ぎ継続が確認できる
- manual `/compact focus on` で必要な artifact が優先注入される

## 記録先

- 確定した実施結果は `PRODUCT.md` の Phase 2 実施ログへ転記する
- 未観測の項目は未完了のまま残し、推測で完了扱いにしない
