// The intent engine: applying and reverting intents, and — the important part —
// planning a revert. A revert is only safe if nothing still-applied depends on
// the target, either explicitly (it was built on top) or implicitly (it edits
// the same symbol later). When something does, a standalone revert is *blocked*;
// the escalation is a *cascade* that reverts the dependents first, in order.
//
// This mirrors a backend where `POST /revert {dry_run:true}` returns
// { wouldRevert, requiredBy, affectedFiles, blocked } and a live revert of a
// blocked target answers 409 RevertBlocked with a required_by set.

import { diffSnapshots } from '../lib/diff'

/* ---------- forward / inverse edit application ---------- */

function applyHunkForward(content, hunk) {
  if (hunk.op === 'append') {
    return content.endsWith('\n') ? content + hunk.after : content + '\n' + hunk.after
  }
  // replace
  if (!content.includes(hunk.before)) {
    throw new ConflictError(
      `Can't apply cleanly to ${hunk.path}: the target code changed since this was planned.`,
    )
  }
  return content.replace(hunk.before, hunk.after)
}

function applyHunkInverse(content, hunk) {
  if (hunk.op === 'append') {
    if (!content.includes(hunk.after)) {
      throw new ConflictError(
        `Can't revert ${hunk.path}: the code this intent added was changed by hand.`,
      )
    }
    return content.replace(hunk.after, '')
  }
  // inverse of replace
  if (!content.includes(hunk.after)) {
    throw new ConflictError(
      `Can't revert ${hunk.path}: the code this intent changed was edited afterwards.`,
    )
  }
  return content.replace(hunk.after, hunk.before)
}

export class ConflictError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'ConflictError'
  }
}

export function applyIntent(files, intent) {
  const next = { ...files }
  for (const h of intent.hunks) next[h.path] = applyHunkForward(next[h.path] ?? '', h)
  return next
}

// Revert a set of intents. `ordered` must be dependents-first (see planRevert).
export function revertIntents(files, ordered) {
  let next = { ...files }
  for (const intent of ordered) {
    for (const h of intent.hunks) next[h.path] = applyHunkInverse(next[h.path] ?? '', h)
  }
  return next
}

/* ---------- dependency / conflict analysis ---------- */

function sharesSymbol(a, b) {
  for (const path of Object.keys(a.symbols || {})) {
    const bs = b.symbols?.[path]
    if (!bs) continue
    if (a.symbols[path].some((s) => bs.includes(s))) return true
  }
  return false
}

// The applied intents that make reverting `target` alone unsafe:
//  - anything that explicitly depends on it, or
//  - anything applied *after* it that touches one of the same symbols.
export function directBlockers(target, applied) {
  const order = new Map(applied.map((i, idx) => [i.id, idx]))
  const ti = order.get(target.id)
  return applied.filter((i) => {
    if (i.id === target.id) return false
    const dependsOnTarget = (i.dependsOn || []).includes(target.id)
    const laterConflict = order.get(i.id) > ti && sharesSymbol(i, target)
    return dependsOnTarget || laterConflict
  })
}

/**
 * Dry-run a revert. Returns the plan the confirm dialog renders.
 * @returns {{ target, wouldRevert, requiredBy, affectedFiles, blocked }}
 *   wouldRevert — every intent that would be undone, in the exact order they'd
 *                 be undone (dependents first, target last).
 *   requiredBy  — the direct blockers (the 409 `required_by` set).
 *   affectedFiles — union of files any of those intents touched.
 *   blocked     — true when a standalone revert is refused and a cascade is needed.
 */
export function planRevert(target, applied) {
  const byId = new Map(applied.map((i) => [i.id, i]))
  const order = new Map(applied.map((i, idx) => [i.id, idx]))

  // Transitively collect the target and everything that must come down with it.
  const set = new Map([[target.id, target]])
  const queue = [target]
  while (queue.length) {
    const cur = queue.shift()
    for (const b of directBlockers(cur, applied)) {
      if (!set.has(b.id)) {
        set.set(b.id, b)
        queue.push(b)
      }
    }
  }

  // Dependents-first == latest-applied first.
  const wouldRevert = [...set.values()].sort((a, b) => order.get(b.id) - order.get(a.id))
  const requiredBy = directBlockers(target, applied)
  const affectedFiles = [
    ...new Set(wouldRevert.flatMap((i) => i.hunks.map((h) => h.path))),
  ].sort()

  return {
    target,
    wouldRevert,
    requiredBy,
    affectedFiles,
    blocked: requiredBy.length > 0,
    byId,
  }
}

/* ---------- graph layout for the Semantic Intent Graph ---------- */

// Assigns each intent a column by dependency depth and a row within it, so the
// renderer can draw a left-to-right DAG with parallel branches.
export function layoutGraph(intents) {
  const byId = new Map(intents.map((i) => [i.id, i]))
  const depthCache = new Map()
  const depth = (i) => {
    if (depthCache.has(i.id)) return depthCache.get(i.id)
    const deps = (i.dependsOn || []).map((d) => byId.get(d)).filter(Boolean)
    const d = deps.length ? 1 + Math.max(...deps.map(depth)) : 0
    depthCache.set(i.id, d)
    return d
  }
  const columns = []
  for (const i of intents) {
    const d = depth(i)
    ;(columns[d] ||= []).push(i)
  }
  const nodes = []
  columns.forEach((col, c) => {
    col.forEach((intent, r) => {
      nodes.push({ intent, col: c, row: r })
    })
  })
  const edges = []
  for (const i of intents) {
    for (const d of i.dependsOn || []) {
      if (byId.has(d)) edges.push({ from: d, to: i.id })
    }
  }
  return { nodes, edges, columnCount: columns.length, rowCount: Math.max(1, ...columns.map((c) => c.length)) }
}

/* ---------- stats ---------- */

// Build the DiffViewer file list for one intent, against the live files.
// Proposed intents diff current -> would-be; applied intents diff the state
// just before this change -> current.
export function intentDiff(files, intent) {
  if (!intent) return []

  const safeFiles = files && typeof files === 'object' ? files : {}

  // Backend intents use `edits`; the older local intent model used `hunks`.
  // Normalize backend edits into before/after snapshots for the DiffViewer.
  const edits = Array.isArray(intent.edits)
    ? intent.edits
    : Array.isArray(intent.hunks)
      ? intent.hunks.map((h) => ({
          path: h.path,
          op: h.op,
          before: h.before ?? '',
          newContent: h.after ?? '',
        }))
      : []

  if (!edits.length) return []

  const paths = [
    ...new Set(
      edits
        .filter((e) => e && typeof e.path === 'string')
        .map((e) => e.path)
    ),
  ]

  if (!paths.length) return []

  const before = {}
  const after = {}

  for (const path of paths) {
    before[path] = safeFiles[path] ?? ''
    after[path] = safeFiles[path] ?? ''
  }

  for (const edit of edits) {
    const path = edit.path
    if (!path) continue

    if (edit.op === 'modify' || edit.op === 'replace') {
      // Backend provides the complete resulting file in `newContent`.
      // This is the most reliable source for displaying the proposed diff.
      if (typeof edit.newContent === 'string') {
        after[path] = edit.newContent
      } else if (typeof edit.after === 'string') {
        after[path] = after[path].replace(edit.before ?? '', edit.after)
      }
    } else if (edit.op === 'append') {
      const addition = edit.newContent ?? edit.after ?? ''
      after[path] = after[path].endsWith('\n')
        ? after[path] + addition
        : after[path] + '\n' + addition
    }
  }

  return diffSnapshots(before, after)
}

export function deriveStats(intents, runs) {
  const applied = intents.filter((i) => i.status === 'applied')
  const reverted = intents.filter((i) => i.status === 'reverted')
  const proposed = intents.filter((i) => i.status === 'proposed')
  const lastRun = runs[runs.length - 1]
  return {
    proposed: proposed.length,
    applied: applied.length,
    reverted: reverted.length,
    highRiskApproved: intents.filter((i) => i.risk === 'high' && i.approvedAt).length,
    runs: runs.length,
    testsPassing: lastRun ? lastRun.results.filter((r) => r.pass).length : 0,
    testsTotal: lastRun ? lastRun.results.length : 0,
  }
}
