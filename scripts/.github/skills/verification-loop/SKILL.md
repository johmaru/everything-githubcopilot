---
name: verification-loop
description: >
	コード変更後や /verify 実行時の validation, test, lint, regression 用の強制検証ループ。
	実装タスクで自動適用し、変更セットの再検証にも使う。
---
# 強制検証ループ

## ルール
コード変更後、「完了」報告前に必ず実行:

1. 保存確認: `#read/readFile` で変更反映を確認
2. 構文チェック: `#read/problems` でエラー・警告を確認
3. 狭い検証: 変更面ごとに最小の確認コマンドを先に実行
4. テスト実行: `#execute/runInTerminal` で関連テストをパス
5. 回帰チェック: 関連テストが壊れていないか確認

## checklist enforcement
- `todo` / `todo_write` / `manage_todo_list` が未使用なら checklist 状態は `neutral`
- checklist を使った session で未完了タスクが残る場合は `blocked` とし、完了報告ではなく follow-up と次の一手を返す
- checklist を使った session で未完了タスクが 0 件なら `pass`

## この repository の既定コマンド
- prompt / agent / instruction / skill 変更: `node scripts/ci/validate-copilot-customizations.js`
- hook / schema 変更: `node scripts/ci/validate-github-hooks.js`
- 個人パス混入確認: `node scripts/ci/validate-no-personal-paths.js`
- Markdown 変更: `npx markdownlint <touched files>`
- 最終確認: `npm test` と `npm run lint`

## 適用の目安
- 各ステップでは保存確認、diagnostics、最小の validator、変更面に直結する focused test を先に実行し、広い回帰確認は最後まで遅延させる
- `.github/` 配下や `README.md` を触ったら、まず validator と markdownlint を実行し、`npm test` と `npm run lint` は最終確認または high-risk 変更の closeout で実行する
- `scripts/` や `tests/` を触ったら、各ステップでは関連テストを先に実行し、最終確認で `npm test` を省略しない
- hook / schema / package metadata / installer / workspace instruction の変更は high-risk として扱い、最終確認で広い回帰確認を省略しない

## /verify での既定
- 現在の変更セットを対象に、保存確認、diagnostics、関連テスト、広い回帰確認を順に報告する
- checklist の結果も `neutral` / `blocked` / `pass` で報告する
- 明示的な修正依頼がない限り編集せず、`✅` / `❌` と次の推奨アクションを付けて報告する

## 失敗時
- 実装タスクでのテスト失敗 → 修正3回まで試行
- 読み取り専用の検証タスクでは修正せず、失敗内容と次の一手を報告
- 実装タスクで3回失敗 → plannerにハンドオフ
- 実装タスクでの構文エラー → 即修正（回数カウント外）
