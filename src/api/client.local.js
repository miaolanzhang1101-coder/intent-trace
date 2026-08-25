// The workspace talks to exactly one thing: this client. It is a complete,
// in-memory reference implementation of the backend contract, so the app is
// fully functional with no server. Each method documents the HTTP endpoint it
// stands in for; point the app at a real service by reimplementing these
// against fetch() and keeping the same return shapes.
//
//   GET  /intents/graph            -> getIntentGraph()
//   POST /apply {approve}          -> apply(intent, {approve})   (approval-gated)
//   POST /revert {dry_run}         -> revert(id, {dryRun})       -> plan
//   POST /revert {cascade}         -> revert(id, {cascade})      (409 RevertBlocked otherwise)
//   GET  /stream (SSE)             -> subscribe(fn)
//   GET  /events                   -> getEvents()
//   GET  /stats                    -> getStats()
//   PUT  /files/:path              -> writeFile(path, content)
//   POST /run                      -> run()   (executes the suite for real)

import { freshFiles, FILE_ORDER, ENTRY_TEST } from '../domain/project'
import { planIntent } from '../domain/agent'
import {
  applyIntent,
  revertIntents,
  planRevert,
  layoutGraph,
  deriveStats,
  ConflictError,
} from '../domain/intents'
import { runWorkspace } from '../runtime/runner'

/* ---------- errors that mirror backend status codes ---------- */

export class ApprovalRequired extends Error {
  constructor(intent) {
    super('High-risk change requires explicit approval (approve=true).')
    this.name = 'ApprovalRequired'
    this.status = 403
    this.intent = intent
  }
}
export class RevertBlocked extends Error {
  constructor(plan) {
    super('Revert blocked: other applied intents require this one.')
    this.name = 'RevertBlocked'
    this.status = 409
    this.required_by = plan.requiredBy
    this.plan = plan
  }
}

/* ---------- in-memory store ---------- */

let evSeq = 0
const now = () => Date.now()

const store = {
  files: freshFiles(),
  order: FILE_ORDER.slice(),
  entry: ENTRY_TEST,
  intents: [], // proposed | applied | reverted
  events: [],
  runs: [],
  subs: new Set(),
}

function emit(ev) {
  const full = { id: ++evSeq, at: now(), ...ev }
  store.events.push(full)
  for (const fn of store.subs) fn(full)
}
function applied() {
  return store.intents.filter((i) => i.status === 'applied')
}

/* ---------- the API ---------- */

export const api = {
  // The app reads everything it renders from one snapshot.
  getState() {
    return {
      files: { ...store.files },
      order: store.order.slice(),
      entry: store.entry,
      intents: store.intents.map((i) => ({ ...i })),
      events: store.events.slice(),
      runs: store.runs.slice(),
      graph: layoutGraph(store.intents),
      stats: deriveStats(store.intents, store.runs),
    }
  },

  // GET /stream — realtime event feed.
  subscribe(fn) {
    store.subs.add(fn)
    return () => store.subs.delete(fn)
  },

  // GET /events — the audit log.
  getEvents() {
    return store.events.slice()
  },

  // GET /stats
  getStats() {
    return deriveStats(store.intents, store.runs)
  },

  // GET /intents/graph — the Semantic Intent Graph.
  getIntentGraph() {
    return { intents: store.intents.map((i) => ({ ...i })), ...layoutGraph(store.intents) }
  },

  // PUT /files/:path — a hand edit in the editor.
  writeFile(path, content, { silent } = {}) {
    store.files[path] = content
    if (!silent) emit({ type: 'edit', level: 'muted', title: `Edited ${path}`, detail: 'Manual change in the editor' })
    return { ok: true }
  },

  // Ask the agent to plan a change. Returns a *proposed* intent (a dry apply):
  // its diff and metadata, but nothing is written yet.
  planRequest(request) {
    const res = planIntent(request, { files: store.files, applied: applied() })
    if (!res.ok) return res
    store.intents.push(res.intent)
    emit({
      type: 'proposed',
      level: 'info',
      title: `Agent proposed "${res.intent.title}"`,
      detail: `${res.intent.kind} \u00b7 ${res.intent.risk}-risk`,
      intentId: res.intent.id,
    })
    return { ok: true, intent: { ...res.intent } }
  },

  // Discard a proposal without applying it.
  discardProposal(intentId) {
    const i = store.intents.find((x) => x.id === intentId)
    if (!i || i.status !== 'proposed') return { ok: false }
    store.intents = store.intents.filter((x) => x.id !== intentId)
    emit({ type: 'discarded', level: 'muted', title: `Dismissed "${i.title}"`, detail: 'Proposal discarded' })
    return { ok: true }
  },

  // POST /apply {approve} — write the change. High-risk needs approve=true.
  apply(intentId, { approve = false } = {}) {
    const intent = store.intents.find((i) => i.id === intentId)
    if (!intent) throw new Error('intent not found')
    if (intent.status === 'applied') return { ok: true, intent }
    if (intent.risk === 'high' && !approve) throw new ApprovalRequired(intent)

    store.files = applyIntent(store.files, intent) // may throw ConflictError
    intent.status = 'applied'
    intent.appliedAt = now()
    if (approve) intent.approvedAt = now()
    emit({
      type: approve ? 'approved' : 'applied',
      level: 'ok',
      title: `${approve ? 'Approved & applied' : 'Applied'} "${intent.title}"`,
      detail: `${intent.hunks.length} edit${intent.hunks.length === 1 ? '' : 's'} across ${new Set(intent.hunks.map((h) => h.path)).size} file(s)`,
      intentId: intent.id,
    })
    return { ok: true, intent: { ...intent } }
  },

  // POST /revert — dry run returns the plan; a real cascade unwinds dependents.
  revert(intentId, { dryRun = false, cascade = false } = {}) {
    const target = applied().find((i) => i.id === intentId)
    if (!target) throw new Error('applied intent not found')
    const plan = planRevert(target, applied())

    if (dryRun) return { ok: true, plan }

    if (plan.blocked && !cascade) throw new RevertBlocked(plan)

    const toRevert = cascade ? plan.wouldRevert : [target]
    store.files = revertIntents(store.files, toRevert) // dependents-first, may throw ConflictError
    for (const i of toRevert) {
      const live = store.intents.find((x) => x.id === i.id)
      live.status = 'reverted'
      live.revertedAt = now()
    }
    emit({
      type: cascade ? 'cascade' : 'reverted',
      level: 'amber',
      title: cascade
        ? `Cascade reverted ${toRevert.length} intents`
        : `Reverted "${target.title}"`,
      detail: cascade
        ? `Unwound in order: ${toRevert.map((i) => i.title.split(' ').slice(0, 2).join(' ')).join(' \u2192 ')}`
        : `Restored ${plan.affectedFiles.join(', ')}`,
      intentId: target.id,
    })
    return { ok: true, reverted: toRevert.map((i) => i.id) }
  },

  // POST /run — execute the suite for real in a Web Worker.
  async run() {
    const res = await runWorkspace(store.files, store.entry)
    const run = { id: ++evSeq, at: now(), ...res }
    store.runs.push(run)
    const passed = res.results.filter((r) => r.pass).length
    emit({
      type: 'run',
      level: res.ok && passed === res.results.length ? 'ok' : 'err',
      title: res.timedOut
        ? 'Run stopped (timeout)'
        : res.ok
          ? `Ran tests \u2014 ${passed}/${res.results.length} passing`
          : 'Run failed to execute',
      detail: res.error ? res.error : `${res.durationMs} ms`,
    })
    return run
  },

  // Reset everything back to the baseline workspace.
  reset() {
    store.files = freshFiles()
    store.intents = []
    store.runs = []
    emit({ type: 'reset', level: 'muted', title: 'Workspace reset', detail: 'Back to the baseline project' })
    return { ok: true }
  },
}

export { ConflictError }
