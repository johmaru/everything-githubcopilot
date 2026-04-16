# GitHub Copilot Workspace Instructions

This repository is a GitHub Copilot customization pack for VS Code. Treat `.github/` as the active configuration surface.

## Agent Architecture

This workspace uses a four-layer agent system modeled after ForgeCode's muse/forge/sage pattern, with an additional **supporter** layer for safer support:

| Agent | File | Role | Model | Tool Access |
|-------|------|------|-------|-------------|
| planner | `agents/planner.agent.md` | Strategic planning & analysis | Configured planning model | Read-only + web + questions |
| coder | `agents/coder.agent.md` | Implementation & verification | Configured implementation model with optional fallback | Full |
| researcher | `agents/researcher.agent.md` | Codebase investigation (subagent) | Configured research model | Read-only |
| supporter | `agents/supporter.agent.md` | Safer support & guidance (no edits) | Configured support model | Read-only + web + questions |

### Implementation Lane (編集あり)
**planner → (handoff) → coder → (handoff) → researcher (review)**
On failure: **coder → (handoff) → planner (re-plan)**

### Support Lane (編集なし・安全)
**supporter → (handoff) → planner** (実装計画へ昇格)
**supporter → (handoff) → researcher** (深い調査)

- Use **planner** before touching critical systems. It must never call `#edit/*` or destructive terminal commands.
- Use **coder** for implementation. It follows planner's output step by step and runs the verification loop after every change.
- **researcher** is user-visible and can be called directly for deep investigation. The planner/coder -> researcher path is part of the current workflow, while broader internal specialist auto-selection remains future work.
- Use **code-reviewer** only for high-risk or cross-cutting repository changes such as workspace instructions, agents, file instructions, prompts, skills, hooks, installer scripts, package metadata, validators, schemas, or security-sensitive automation. Keep researcher as the default implementation review path.
- Use **supporter** when you want AI assistance without any file edits. It provides safer guidance, clarifies requirements, investigates the codebase, and can handoff to planner or researcher when needed. **supporter never edits files or runs commands.**
- Do not bypass the verification loop. coder must confirm ✅ on save / syntax / test / regression before reporting done.
- Do not skip truncation guards. Every file read must note `[読取: total_lines=X, showing=Y-Z]`.

## Code Exploration

- For repo-internal dependency tracing, symbol impact analysis, rename safety checks, dead export checks, and cross-file responsibility mapping, prefer `#search/usages` before plain text search. Treat it as the primary static reference search surface.
- Use `#search/codebase` or text search to discover rough candidate files, then use `#search/usages` to confirm actual references and call paths.
- Use `semantic-indexer` through `npm run entry-points:index`, `npm run entry-points:query`, `npm run rust:index -- --format summary`, or targeted `npm run rust:index -- --file <path>` calls when the task needs file-level symbol inventories, exported-surface counts, kind/doc-coverage reports, symbol density comparisons, or a repo-wide static AST summary that plain usage search cannot provide efficiently.
- Reserve GitHub code search and broader external research for reuse and library discovery, not for primary dependency tracing inside this repository.

## Skills (ForgeCode Optimizations)

| Skill | Directory | Auto-applies when |
|-------|-----------|-------------------|
| schema-optimization | `skills/schema-optimization/` | JSON generation or tool calls |
| verification-loop | `skills/verification-loop/` | Any code change |
| truncation-guard | `skills/truncation-guard/` | Any file read |

These encode the techniques that raised ForgeCode's Terminal-Bench 2.0 score from 25% to 81.8%. They are always-on via agent instructions and also loadable on demand.

## File Layout Rules

- Put project-wide guidance here and keep it short.
- Put path-specific behavior in `.github/instructions/*.instructions.md` with explicit `applyTo` patterns.
- Put reusable slash workflows in `.github/prompts/*.prompt.md`.
- Put persistent specialist personas in `.github/agents/*.agent.md`.
- Put deterministic automation in `.github/hooks/*.json`.
- Put reusable agent capabilities in `.github/skills/*/SKILL.md`.

Use `.github` as the source of truth.

- `.codex/` and `.opencode/` are maintained compatibility surfaces. They adapt `.github/` guidance for Codex CLI and OpenCode respectively.
- For Codex, project instructions remain rooted in `AGENTS.md`; `.codex/` carries config, agent registrations, hooks, and rules, Codex expects skills at `.agents/skills/`, and project setup creates that bridge from `.github/skills/`. Project setup distributes these Codex compatibility assets into target projects.
- Do not add new authoritative guidance outside `.github/` unless it explicitly targets a compatibility surface (e.g. `.codex/`, `.opencode/`).
- Do not make critical behavior depend on semantic skill loading alone. Important rules must be always-on or `applyTo`-scoped.
- Keep instructions terse and self-contained. Split long guidance into smaller files instead of growing this file.
- When editing prompts, agents, instructions, or skills, keep YAML frontmatter valid and make `description` phrases explicit enough for discovery.
- Prefer prompts for repeatable single tasks and custom agents for persistent roles (planner, coder, researcher, review, security).
- Prefer deterministic validation and light hooks over heavy autonomous orchestration.

## Communication

- Respond in the user's requested language. Keep code, commands, and paths in English unless the user asks otherwise.
- Do not guess. If a spec is unclear, ask the user or search the codebase first.
- Suggest updates to this file or any local project docs when you find incomplete or conflicting information.

## Validation

```bash
npm test
npm run lint
```

When the layout changes, update CI, package metadata, and the docs that describe how Copilot should load this repository.

## プロジェクト引き継ぎコンテキスト

このファイルはVSCode Copilot Chatの全エージェントに自動注入される
最小限の安定情報です。詳細な進捗・計画・調査結果は、存在する場合はローカルの進捗文書や handoff 文書を参照。

## プロジェクト概要

ForgeCode相当のAIコーディングエージェントシステムを、
VSCode Copilot Chat + 構成可能なモデル設定 + カスタムエージェントで構築する。

- 例: PRODUCT.md
- 例: HANDOFF.md
- 例: docs/migration-status.md

## 環境前提

- **planner / researcher / supporter**: 読み取り中心の計画・調査・支援に適した構成済みモデルを使う
- **coder**: 実装と検証を安定して実行できる構成済みモデルを使う
- 利用するモデルは、必要なツール呼び出しや検証フローをサポートしていること

## ワークフロー

### Implementation Lane (実装レーン)
**planner → (handoff) → coder → (handoff) → researcher (review)**
**失敗時: coder → (handoff) → planner (re-plan)**

### Support Lane (支援レーン・編集なし)
**supporter → (handoff) → planner** (実装計画へ昇格)
**supporter → (handoff) → researcher** (深い調査)

## 強制ルール

- planner: `#edit/*` や破壊的操作を行わない
- coder: 検証ループ必須（保存/構文/テスト/回帰）
- 全エージェント: トランケーション保護 `[読取: total_lines=X, showing=Y-Z]`
- 推測禁止、不明点は質問、変更は最小限
- 未解決のエラーや既知問題を残して完了する場合は、`scripts/hooks/learn-embed.js` を使って `source=agent`, `kind=unresolved_issue`, `label=err`, `importance=<critical|high|medium|low>` と現在の workspace に対応する `project id` を付けてベクトルDBに保存する。summary は 1 行の短文に圧縮し、引用符・改行・シェルメタ文字を埋め込まない
- 未解決事項の保存内容には、再現条件・影響範囲・次に見るべきファイルを含める
- ベクトルDBへ保存する未解決事項には機密情報、トークン、個人パス、秘密値を含めない

## Handoff 必須項目

handoff時は以下を含める:
1. **目的**: このタスクの1文要約
2. **現在フェーズ**: 計画/実装/レビュー
3. **重要決定**: 影響の大きい判断
4. **変更対象ファイル**: パス一覧
5. **検証結果**: ✅/❌ の状態
6. **未解決事項**: 次エージェントへの質問
7. **次の一手**: 推奨アクション
8. **SESSION_ID**: セッション継続に必要な識別子

## 情報の所在

| 情報 | 所在 |
|------|------|
| 進捗・ロードマップ・リスク | 任意のローカル進捗文書（例: PRODUCT.md） |
| 補足の引き継ぎ履歴 | 任意のローカル handoff 文書（例: HANDOFF.md） |
| 進捗・ロードマップの変更履歴 | docs/migration-status.md |
| ワークフロー・環境前提・強制ルール | .github/copilot-instructions.md |
| エージェント固有動作 | .github/agents/*.agent.md |
| スキル定義 | .github/skills/*/SKILL.md |
| ユーザー向け操作説明 | docs/ |

## コーディング規約

- ユーザーの希望言語で応答（コード・コマンド・パス名は必要に応じて英語を維持）
- 変更は最小限、テスト破壊は即報告・修正
- 推測でコードを書かない、不明な仕様はコードベースを読む

## このプロジェクト独自ルール
- 重要な決定や未解決事項は必ず次のエージェントへのhandoffに含める
- 未解決事項はベクトルDBに保存して後続のエージェントが参照できるようにする
- 重要な決定には理由を添える（例: なぜこのアプローチを選んだのか）
- 変更対象ファイルは必ず列挙する（例: `src/app.js`, `tests/app.test.js`）
- 作業が終わったら、存在する進捗ドキュメントがあれば更新する（例: PRODUCT.md の進捗セクション）
なければ、ユーザーにファイル作成を提案して、そこに進捗やリスクを記録するよう促す
- 進捗ドキュメントには、現在のタスクの状態、次のステップ、リスクや懸念事項を記載する
ユーザーが読む事を想定して、わかりやすく簡潔に書く
