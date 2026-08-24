# intent-trace backend

The backend for **JavaAI / intent-trace** — an *intent-level version-control layer*
over AI-generated code edits. Instead of tracking raw git commits, it tracks
**intents**: high-level AI actions ("Fix type mismatch", "Update callers to new
API", "Refactor SQL query") that group related edits into one reviewable,
revertible decision, connected by a dependency DAG. Git commits attach to
intents — not the other way around.

It exists to solve the two problems in the product brief:

- **Risky rollbacks** — reverting an AI change blindly breaks hidden dependencies.
  Here, a revert computes its blast radius first and either **blocks** or performs
  an ordered **cascade**.
- **Limited visibility** — developers can't see the scope/dependencies of AI
  changes. Here, every intent exposes its `depends_on` and `required_by` sets
  (direct + transitive), a graph view, per-intent diffs, and a full audit log.

## Stack

Built on the coherent slice of the target stack:

- **TypeScript + Effect-TS on Bun** — the whole service layer is Effect
  (`Layer` dependency injection, typed errors, `PubSub`, `Stream`, `ManagedRuntime`).
- **Postgres + Drizzle** — schema and typed queries via Drizzle; the embedded
  **PGlite** driver runs real Postgres in-process so it boots with zero infra.
  Point `DATA_DIR` at a folder to persist, or swap the driver for hosted Postgres.
- **Append-only event log** — every state transition is recorded (the
  ClickHouse-shaped analytics stream; swap the sink in `services/Events.ts`).
- **Realtime** — an SSE endpoint backed by an Effect `PubSub` (the seam where
  Electric SQL would plug in for production sync).

## Run it

```bash
bun install
bun run src/main.ts     # start the API on :3000  (PORT / DATA_DIR configurable)
bun run src/demo.ts     # end-to-end scenario against the live HTTP server
bun test                # unit tests for the DAG algorithms
```

## API

| Method & path | Purpose |
|---|---|
| `GET  /health` | liveness |
| `POST /projects` · `GET /projects` | create / list projects |
| `GET  /projects/:id` | project metadata |
| `POST /projects/:id/files` · `GET .../files` | upload / list stored files (versions kept in history) |
| `GET  /projects/:id/files/content?path=` · `.../history?path=` | current file body · full version history |
| `POST /projects/:id/prompts` | **agent**: `{text}` → a proposed intent with real edits, deps, risk |
| `GET  /projects/:id/intents` · `.../graph` · `.../stream` | project-scoped list · graph · SSE |
| `POST /intents` · `GET /intents?workspaceId=` | create / list intents |
| `GET  /intents/graph` | nodes + edges for the Intent Graph visualization |
| `GET  /intents/:id` | intent + edits + `dependsOn` + `required_by` + commits + executions |
| `GET  /intents/:id/dependencies` | dependency panel: `depends_on` & `required_by`, direct + transitive |
| `POST /intents/:id/dependencies` | add a dependency edge (rejects cycles) |
| `POST /intents/:id/approve` | `proposed → approved`; `approve=true` required for high-risk (else `428`) |
| `POST /intents/:id/execute` | `approved → executed`: snapshot state, apply edits to files, **run tests in the sandbox** |
| `POST /intents/:id/revert` | `dry_run` (preview) and `cascade` (ordered rollback that restores file contents) |
| `POST /intents/:id/commits` | attach a git commit to an intent |
| `GET  /intents/:id/stream` | realtime SSE event stream for one intent |
| `GET  /events` · `GET /stats` | audit log + analytics rollup |

Status lifecycle: **`proposed → approved → executed → reverted`**.

### The three verbs from the brief

- **`dry_run`** — `POST /intents/:id/revert {"dry_run": true}` returns the full plan
  (`wouldRevert` in revert order, `requiredBy`, `affectedFiles`, `blocked`) and
  mutates nothing. This powers the impact-preview UI.
- **`cascade`** — `{"cascade": true}` reverts the target *and* every applied intent
  that transitively depends on it, in dependents-first topological order.
- **`required_by`** — the reverse dependency edges; a plain revert that would break
  a non-empty `required_by` set returns `409 RevertBlocked` with that set attached.

```bash
# preview the blast radius of reverting an intent
curl -XPOST localhost:3000/intents/$ID/revert -d '{"dry_run":true}'
# safe ordered rollback of the intent and everything built on it
curl -XPOST localhost:3000/intents/$ID/revert -d '{"cascade":true}'
```

## Layout

```
src/
  db/        schema.ts (Drizzle: intents, edits, deps, projects, files, snapshots, executions, events)
             migrate.ts (idempotent DDL) · via Db service
  domain/    errors.ts (typed failures) · graph.ts (pure DAG) · diff.ts (unified diff)
  services/  Db · Events (audit log + PubSub) · Projects (file storage + versions)
             Agent (NL prompt → real edits) · Sandbox (runs tests in a temp dir)
             Intents (propose/approve/execute/revert/deps/graph + snapshots)
  http/      server.ts (Bun.serve → Effect) · http.ts (error→status mapping)
  runtime.ts root Layer wiring (one shared PGlite, memoized) · main.ts · demo.ts
test/        graph.test.ts
```

## The full agent loop

`src/demo.ts` runs the whole thing end-to-end: create a project + files → the agent
proposes an intent from a natural-language prompt → approve → **execute** (edits are
applied to the stored files and the test suite is actually run in a sandbox) → a
dependent intent auto-links by file overlap → a plain revert of the base intent is
**blocked (409)** → a **cascade** revert rolls back the dependent and the base in
dependency-safe order and restores `src/user.ts` to its original bytes.

## Frontend

The `intent-frontend/` folder ships a single-file **Rollback Console** (`index.html`)
that connects to this backend over HTTP + SSE — a Semantic Intent Graph, dry-run
impact previews, and one-click cascade rollback. Just open the file in a browser;
no build step. See its README to connect or run the offline demo.

## What's intentionally a seam, not a fake

The pieces that need hosted infra are abstracted behind a single service so they
swap cleanly without touching domain logic:

- **PGlite → hosted Postgres**: change the driver in `services/Db.ts`; Drizzle
  schema/queries are unchanged. Run `drizzle-kit generate` for versioned migrations.
- **event log → ClickHouse**: `Events.emit` is the one write path; point it at a
  ClickHouse sink for the high-throughput analytics store.
- **SSE `PubSub` → Electric SQL**: `Events.stream` is the one read path for
  realtime; replace it with an Electric shape subscription.
- **sandboxes/LLM (e2b, Anthropic)**: intents currently carry agent-supplied
  `reasoning` + `edits`; the producer (agent harness executing tools in an e2b
  sandbox) attaches to `POST /intents` without backend changes.
