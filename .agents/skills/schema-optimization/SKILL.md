---
name: schema-optimization
description: >
  GPT-5.4のツールコール精度を向上させるスキーマ最適化。
  JSON生成やツール呼び出しを含むタスクで自動適用。
---

# スキーマ最適化

ForgeCodeが Terminal-Bench 2.0 で 25%→81.8% を達成した知見。

## この repository での対象
- `.github/instructions/*.instructions.md`
- `.github/prompts/*.prompt.md`
- `.github/agents/*.agent.md`
- `.github/hooks/*.json`
- `schemas/*.json`

## required-first ordering
JSON Schemaで `required` を `properties` より前に配置。
GPT-5.4は先頭フィールドにアンカリングするため、
この順序でツールコールエラーが約30%減少する。

## フラット構造
ネストは最大2階層。3階層以上は中間オブジェクトに分解。

## 明示的な型
`any` や暗黙の型を避け、全フィールドに明示的な型を付ける。

## repository 固有の補足
- frontmatter の `description` は発見面なので、用途と trigger phrase を入れる
- prompt 名や agent 名は実在する surface に合わせる。例: `/research-plan`
- hooks と schema は決定論的な shape を優先し、ローカル script 参照は `scripts/hooks/` に寄せる
