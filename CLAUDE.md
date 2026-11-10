# Readloft

Self-hosted ebook library + reader.

## Layout
- `shared/types.ts` — API contract + types. Change here first; server and web both depend on it.
- `server/` — Hono API, `node:sqlite`, scanner, metadata extractors. Runs TS natively on Node 24: relative imports need `.ts`, no enums/namespaces/parameter properties (`erasableSyntaxOnly`).
- `web/` — React + Vite. Reader wraps `<foliate-view>` from `web/public/foliate-js` (vendored via `npm run setup`, git-ignored). Load foliate/pdf.js only via `src/lib/runtimeImport.ts`, never plain `import()`.

## Commands
- `npm run setup` — vendor foliate-js
- `npm run dev` — API :8080, web :5173
- `npm run typecheck` / `npm run build`

## Model policy
Three roles. Every spawn sets the agent name; never pick a model ad hoc.

| Agent | Model | Effort | Job |
| --- | --- | --- | --- |
| `boss` | Opus 5.5 | medium | Main session. Plans, hands out tasks, reviews code, reviews the running app, talks to the user. Does not write feature code itself. |
| `worker` | Sonnet | medium | Writes code: features, bug fixes, refactors, tests from a clear spec given by boss. |
| `janitor` | Haiku | high | Tests the app (run, smoke-test, curl, typecheck/build) and makes low-complexity changes: typos, renames, copy, config tweaks, 1–2 file mechanical edits. |

Rules:
- Boss writes a complete brief per task: goal, files, constraints, how to verify, output format (short report).
- Boss reviews every worker/janitor result (diff + typecheck) before reporting to the user.
- If janitor's result fails review, escalate to worker; if worker's fails, boss handles it.
- Subagents never install packages, commit, push, or change infra; those go to the user via boss.
- Definitions live in `.claude/agents/`.
