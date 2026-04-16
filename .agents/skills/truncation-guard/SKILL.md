---
name: truncation-guard
description: >
  ファイル読取時のトランケーション保護。
  ファイル操作を含む全タスクで自動適用。
---

# トランケーション保護

## ルール
ファイル読取時に必ず記載:
`[読取: total_lines=XXX, showing=YY-ZZ]`

## 判断基準
- 表示範囲が全体の80%未満 → 追加読取の必要性を明示
- 500行超 → チャンク読取、変更箇所前後50行を確認
- 設定ファイル・テストファイル → 500行以下は全体を読む。500行超は複数チャンクで全体を走査する
- 部分読取だけで「他に関連コードはない」と断定してはいけない

## この repository で優先して全体読取する対象
- `.github/prompts/*.prompt.md`
- `.github/agents/*.agent.md`
- `.github/instructions/*.instructions.md`
- `.github/skills/*/SKILL.md`
- `.github/hooks/*.json`
- `README.md`, `PRODUCT.md`, `AGENTS.md`

## repository 固有の補足
- 大きいドキュメントは、対象章だけでなく状態要約や inventory 節も合わせて確認する
- validator や hook script を直す場合は、実装ファイルだけでなく関連テストも読む
