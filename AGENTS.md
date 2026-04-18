# AGENTS.md — Hermes Researcher

Guidelines for AI agents working on this codebase.

## Project Overview

Hermes Researcher is a deep-research platform that orchestrates multi-phase pipelines on top of [Hermes Agent](https://github.com/NousResearch/hermes-agent) (v0.9+). The middleware is the brain — it decomposes goals into research plans, runs parallel investigations, synthesizes reports, and self-evaluates quality.

## Architecture

```
Browser (React 19 + Vite)
    |  /api/*  (Vite proxy in dev, Hono static in prod)
Middleware (Hono + SQLite + sqlite-vec)   port 8787
    |  /v1/runs (tools+SSE)  |  /v1/chat/completions (streaming)
Hermes Gateway                            port 8642
```

- **Frontend** (`src/`): stateless — all state fetched from middleware API
- **Middleware** (`server/src/`): orchestrates pipeline, persists everything, broadcasts SSE
- **Shared** (`shared/types.ts`): TypeScript types used by both frontend and server
- **Data**: `~/.hermes-researcher/tasks.db` (SQLite + WAL), `~/.hermes-researcher/settings.json`

## Key Files

### Server

| File | Responsibility |
|---|---|
| `index.ts` | Hono routes, SSE endpoint, CORS, static serving |
| `runner.ts` | Pipeline orchestrator — mode dispatch, phase execution, retry cache, quality loop |
| `prompt.ts` | All prompt templates per phase — plan, research, draft, critique, revise, evaluation |
| `hermes.ts` | Hermes API client — `/v1/runs` (tools+SSE), `/v1/chat/completions` (streaming), health |
| `db.ts` | SQLite schema, prepared statements, store object with all DB operations |
| `settings.ts` | Settings persistence (`settings.json`), model routing, gateway env helpers |
| `knowledge.ts` | Knowledge extraction from reports, upsert with dedup (embedding + FTS) |
| `retrieval.ts` | Hybrid retrieval: sqlite-vec ANN + FTS5 BM25 + RRF fusion + LLM reranking |
| `embedding.ts` | Multi-provider embedding client (OpenAI / Volcengine Doubao / Ollama) |
| `scheduler.ts` | Cron-based task scheduler with date variable substitution |
| `discord.ts` | Discord webhook delivery — rich embeds with auto-split |

### Frontend

| File | Responsibility |
|---|---|
| `App.tsx` | Router setup (react-router), health polling, global init |
| `store/tasks.ts` | Zustand store — task list, active detail, SSE subscription, streaming text |
| `api/client.ts` | API client — all fetch calls + SSE subscriber |
| `components/tasks/TaskDetail.tsx` | Slide-out panel — report rendering, streaming, diff, followup, also exports `sanitizeStreamingMarkdown` |
| `components/tasks/PipelineView.tsx` | Phase visualization with streaming text in running phases |
| `components/tasks/TaskCreator.tsx` | New task form with template picker, mode, language, toolsets |
| `components/Settings.tsx` | Connection, Embedding, Pipeline, Model Routing, Templates |
| `components/Schedules.tsx` | Cron schedule management with Discord delivery config |
| `components/Knowledge.tsx` | Knowledge base browser — search, browse, delete |

## Pipeline Flow (Deep Mode)

```
Plan (lite/streaming)
  → Research × N (parallel /v1/runs)
  → [Research adequacy gate — spawn supplementary if gaps found]
  → Draft (/v1/runs)
  → Critique (lite/streaming, conversation_history carries draft)
  → Revise (/v1/runs, conversation_history carries draft+critique)
  → [Quality gate — score 1-10, iterate critique→revise if <7, max 2 rounds]
```

- **"lite" phases** (plan, critique): use streaming `/v1/chat/completions` via `runPhaseLite` — cheaper, no tools, broadcast `message.delta` events
- **"full" phases** (research, draft, revise): use `/v1/runs` via `runPhase` — full tool access, structured SSE events
- **Token optimization**: critique/revise receive prior outputs via `conversation_history` or `messages` array instead of re-embedding in prompt

## Conventions

### Code Style
- TypeScript strict mode, no `any` — use `Record<string, unknown>` for untyped objects
- Server files use `.ts` extension with ESM imports (e.g. `import { foo } from "./bar.ts"`)
- Frontend uses standard `.tsx` / `.ts` without extension in imports
- Tailwind v4 with `@theme` in `globals.css` — VoltAgent dark theme colors
- No docstrings/comments unless logic is non-obvious

### Error Handling
- Pipeline phases: errors caught per-phase, status set to "failed", broadcast to frontend
- Knowledge extraction / chains: non-blocking `.catch(() => {})`, fail-open
- Evaluation prompts (adequacy gate, quality loop): fail-open — if LLM returns bad JSON, skip evaluation and continue
- JSON parsing from LLM: always use cascade: ````json` block → raw `JSON.parse` → `jsonrepair` → brace extraction

### Naming
- Task IDs: `task_` + UUID without dashes
- Schedule IDs: `sched_` + UUID without dashes
- Template IDs: `tpl_` + 12 char UUID prefix
- Phase run IDs for lite phases: `lite_{phaseId}_{timestamp}`
- DB columns: `snake_case`. TypeScript interfaces: `camelCase`. Conversion in `rowToXxx` functions.

### State Management
- Backend is single source of truth for all task/schedule/knowledge state
- Frontend `zustand` store is a cache — `refreshList` / `refreshActive` re-fetch from API
- `streamingText` accumulates `message.delta` events — cleared on `phase.started`, NOT on `refreshActive`
- `localStorage` only used for: language preference key (`hermes-language`)

### SSE Events
- Server broadcasts `PipelineEvent` via `broadcast(taskId, event)`
- Frontend subscribes via fetch-based SSE (not EventSource — needs no auth headers)
- Key events: `phase.started`, `phase.completed`, `phase.failed`, `message.delta`, `pipeline.completed`, `pipeline.failed`, `pipeline.quality_check`, `pipeline.supplementary_research`

### Database
- SQLite with WAL mode + foreign keys ON
- `sqlite-vec` loaded for vector operations — `knowledge_vec` table dimensions must match embedding config
- If embedding dimensions change, drop `knowledge_vec` table — it recreates on restart
- Schema changes: `db.exec` in `db.ts` with `IF NOT EXISTS` — additive only, no migrations

### Hermes Integration
- Gateway config via env vars in `~/.hermes/.env` (NOT config.yaml for API server settings)
- `API_SERVER_KEY` required for non-loopback binding
- `API_SERVER_MAX_CONCURRENT_RUNS` env var (patched in v0.9.0 source, upstream PR pending: NousResearch/hermes-agent#8867)
- Tool progress on `/v1/chat/completions`: custom `event: hermes.tool.progress` with `{tool, emoji, label}` payload
- Tool events on `/v1/runs`: structured `tool.started` / `tool.completed` / `reasoning.available`

## What NOT to Do

- Don't persist task state in frontend (zustand persist) — backend is source of truth
- Don't delete the DB unless schema actually changed — use `ALTER TABLE` for additive changes
- Don't hardcode API keys or credentials — they live in `~/.hermes/.env` and `settings.json`
- Don't use `toISOString()` for user-facing dates — it's UTC, use local timezone formatting
- Don't add `catch(() => {})` to pipeline phases — errors must propagate to mark phases as failed
- Don't re-embed full draft text in critique/revise prompts — use `conversation_history` / `messages`

## Ports

| Port | Service |
|---|---|
| 5173 | Vite dev server (frontend) |
| 8787 | Middleware (Hono) |
| 8642 | Hermes Gateway |
