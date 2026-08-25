// Minimal LCS-based line diff — turns two file versions into a list of hunks
// the DiffViewer can render. Kept dependency-free on purpose.

function lcsMatrix(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

// Returns [{ type: 'ctx'|'add'|'del', text, oldNo, newNo }]
export function diffLines(oldText, newText) {
  const a = (oldText ?? '').split('\n')
  const b = (newText ?? '').split('\n')
  const dp = lcsMatrix(a, b)
  const out = []
  let i = 0, j = 0, oldNo = 1, newNo = 1
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i], oldNo: oldNo++, newNo: newNo++ })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldNo: oldNo++, newNo: null })
      i++
    } else {
      out.push({ type: 'add', text: b[j], oldNo: null, newNo: newNo++ })
      j++
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++], oldNo: oldNo++, newNo: null })
  while (j < b.length) out.push({ type: 'add', text: b[j++], oldNo: null, newNo: newNo++ })
  return out
}

// Collapse long runs of unchanged lines, keeping `pad` lines of context.
export function collapseContext(rows, pad = 3) {
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, idx) => {
    if (r.type !== 'ctx') {
      for (let k = Math.max(0, idx - pad); k <= Math.min(rows.length - 1, idx + pad); k++) keep[k] = true
    }
  })
  const anyChange = rows.some((r) => r.type !== 'ctx')
  if (!anyChange) return rows.map((r) => ({ ...r, visible: true }))
  const result = []
  let hidden = 0
  rows.forEach((r, idx) => {
    if (keep[idx]) {
      if (hidden > 0) { result.push({ type: 'collapse', count: hidden }); hidden = 0 }
      result.push(r)
    } else {
      hidden++
    }
  })
  if (hidden > 0) result.push({ type: 'collapse', count: hidden })
  return result
}

export function countChanges(rows) {
  let add = 0, del = 0
  for (const r of rows) { if (r.type === 'add') add++; else if (r.type === 'del') del++ }
  return { add, del }
}

// Build a per-file diff for two snapshots (maps of path -> content).
export function diffSnapshots(fromSnap = {}, toSnap = {}) {
  const paths = Array.from(new Set([...Object.keys(fromSnap), ...Object.keys(toSnap)])).sort()
  return paths
    .map((path) => {
      const rows = diffLines(fromSnap[path] ?? '', toSnap[path] ?? '')
      const stat = countChanges(rows)
      return { path, rows: collapseContext(rows), stat, changed: stat.add + stat.del > 0 }
    })
    .filter((f) => f.changed)
}
