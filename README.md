# JavaAI — Intent Trace

A browser-based AI engineering workspace built around one complete, honest
workflow:

> **Natural-language request → inspect the Semantic Intent Graph → approve the change → run it → safely roll it back.**

Everything runs in the browser with no server. You can actually write code, the
tests actually execute in a sandboxed worker, and the agent's changes can be
applied and reverted for real — including the hard case where a revert is
*blocked* because other changes depend on it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/`. There are no runtime
dependencies beyond React.

## The workflow, end to end

1. **Ask.** Describe a change in the agent bar ("make divide throw on divide by
   zero") or pick a suggested request. The agent replies with a **proposed
   intent** — never a silent edit.
2. **Inspect.** The proposal appears as a node in the **Semantic Intent Graph**
   (columns are dependency depth, so independent work forms parallel branches).
   The inspector surfaces the decision-critical information: intent, rationale,
   affected modules / APIs / tests, code dependencies, required intents, risk,
   and the full diff.
3. **Approve & apply.** Low/medium-risk changes apply directly. **High-risk
   changes are gated**: the Apply button stays disabled until you approve
   (`approve=true`), mirroring `POST /apply`.
4. **Run.** The suite executes for real in a Web Worker — genuine pass/fail,
   console output, timing, and a watchdog that kills runaway loops. You can also
   hand-edit any file in the editor and run it yourself.
5. **Roll back.** Reverting an intent first does a **dry run** and shows the
   plan: what would be undone (in revert order), which files are touched, and
   whether it's **blocked**. If another applied intent depends on the target,
   the standalone revert is refused and the escalation is a **cascade** that
   unwinds the dependents first, in order.

The starter project (`calculator.js` + `calculator.test.js`) is deliberately
small so the whole loop is legible. The five sample requests form a real graph:
`guard-divide → percent → percentChange` is a dependency chain, `power` is an
independent branch, and `validate inputs` conflicts with the divide guard on the
same symbol — so reverting the guard is blocked by both a dependency and a
write-after-write, and a cascade cleanly unwinds them.

## The backend contract

The app talks to one module, `src/api/client.js`, a complete in-memory
reference implementation. Each method documents the HTTP endpoint it stands in
for — reimplement them against `fetch()` with the same return shapes to point at
a real service.

| Endpoint | Client method | Returns / behavior |
| --- | --- | --- |
| `GET /intents/graph` | `getIntentGraph()` | `{ intents, nodes, edges, columnCount, rowCount }` |
| `POST /apply {approve}` | `apply(id, {approve})` | applies edits; **high-risk requires `approve=true`** (else `ApprovalRequired`) |
| `POST /revert {dry_run}` | `revert(id, {dryRun:true})` | `{ wouldRevert, requiredBy, affectedFiles, blocked }` |
| `POST /revert {cascade}` | `revert(id, {cascade})` | executes; a blocked target without `cascade` throws **`409 RevertBlocked`** with `required_by` |
| `POST /run` | `run()` | executes the suite for real and records the result |
| `GET /stream` (SSE) | `subscribe(fn)` | realtime event feed |
| `GET /events` | `getEvents()` | the audit log |
| `GET /stats` | `getStats()` | aggregate counters |
| `PUT /files/:path` | `writeFile(path, content)` | a manual editor change |

`ApprovalRequired` and `RevertBlocked` carry `.status` (403 / 409) and the data
a UI needs (`.intent`, `.required_by`, `.plan`).

## How a change is actually carried out

Intents don't store whole-file snapshots; they store **hunks** — concrete
`before`/`after` text with the symbol they touch. Applying runs them forward;
reverting runs them backward, dependents-first. Because reverts are local and
ordered, unrelated hand-edits are preserved, and a revert refuses cleanly (with
a clear message) if the exact code it added was later changed by hand. The
blocking rule is: an applied intent can't be reverted alone if anything still
applied **depends on it** or edits the **same symbol after it**.

## Layout

```
src/
  api/client.js              the backend contract + in-memory reference engine
  domain/
    project.js               the starter workspace files (real, runnable)
    agent.js                 natural-language → reviewable intents (real edits)
    intents.js               apply/revert, the revert planner, graph layout, stats
  runtime/runner.js          real code execution in a sandboxed Web Worker
  components/
    AgentBar.jsx             the request input + suggestions
    IntentGraph.jsx          the Semantic Intent Graph (GET /intents/graph)
    IntentInspector.jsx      intent · rationale · impact · risk · approval gate
    RevertPlanDialog.jsx     dry-run plan → blocked → cascade
    CodeEditor.jsx           dependency-free editable, highlighted editor
    RunPanel.jsx             real test results + console
    ActivityDock.jsx         Stream / Audit / Stats
    DiffViewer.jsx           file diffs with single-pass highlighting
    Sidebar.jsx TopBar.jsx Toast.jsx Badge.jsx icons.jsx
  lib/diff.js                dependency-free line diff + context collapsing
  App.jsx                    the workflow
```

## Notes

- No CSS framework — one `src/index.css` holds the design tokens and every
  component style. The palette (indigo for apply, amber for rollback) and type
  are unchanged from the original console.
- The test runner implements a small Jest-style `test` / `expect` and a minimal
  CommonJS `require` between the project's own files — enough to run a real
  suite, killed by a 3s watchdog if code hangs.
- Keyboard: `Esc` closes the revert dialog; `Tab` inserts two spaces in the
  editor.
