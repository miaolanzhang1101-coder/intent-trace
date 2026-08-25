// The agent turns a natural-language request into a concrete, applicable
// *intent*: a semantic description of a change plus the real edits (hunks)
// that carry it out, computed against the live files. Nothing here is faked —
// applying an intent runs these exact edits, and reverting runs them backwards.
//
// In a wired-up deployment this planning step is what `POST /apply` (dry) and
// `GET /intents/graph` describe; here it runs locally so the workspace is fully
// functional with no server. The transforms are deterministic and idempotent.

const CAL = 'calculator.js'
const TEST = 'calculator.test.js'

/* ---------- small code locators (no AST dependency needed) ---------- */

// Return the full text of a top-level `function name(...) { ... }` block, or null.
function extractFn(content, name) {
  const head = content.indexOf(`function ${name}(`)
  if (head === -1) return null
  const close = content.indexOf('\n}', head)
  if (close === -1) return null
  return content.slice(head, close + 2)
}

function appendHunk(path, symbol, text) {
  return { path, symbol, op: 'append', before: '', after: text }
}
function replaceHunk(path, symbol, before, after) {
  return { path, symbol, op: 'replace', before, after }
}

function symbolsFromHunks(hunks) {
  const map = {}
  for (const h of hunks) (map[h.path] ||= []).push(h.symbol)
  return map
}

/* ---------- individual transforms ---------- */
// Each returns { hunks, affects } or { skip: reason } when it doesn't apply.

function tGuardDivide(files) {
  const block = extractFn(files[CAL], 'divide')
  if (!block) return { skip: 'divide() is no longer in calculator.js.' }
  if (block.includes('Cannot divide by zero')) return { skip: 'divide() is already guarded.' }
  const after = `function divide(a, b) {
  if (b === 0) {
    throw new Error('Cannot divide by zero');
  }
  return a / b;
}`
  const hunks = [
    replaceHunk(CAL, 'divide', block, after),
    appendHunk(TEST, 'test:divide-zero', `
test('divide throws when dividing by zero', () => {
  expect(() => calc.divide(1, 0)).toThrow('Cannot divide by zero');
});
`),
  ]
  return {
    hunks,
    affects: {
      modules: [CAL],
      apis: ['divide(a, b)'],
      tests: ['calculator.test.js — adds "divide by zero" case'],
      dependencies: ['Error'],
    },
  }
}

function tValidateNumbers(files) {
  const helper = `function assertNumbers(...values) {
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Error('All arguments must be numbers');
    }
  }
}`
  if (files[CAL].includes('function assertNumbers')) return { skip: 'Input validation is already present.' }
  const first = extractFn(files[CAL], 'add')
  if (!first) return { skip: 'add() is no longer in calculator.js.' }
  const hunks = []
  // Insert the helper just before add() by replacing add()'s block with helper + guarded add().
  const names = ['add', 'subtract', 'multiply', 'divide']
  for (const name of names) {
    const block = extractFn(files[CAL], name)
    if (!block) return { skip: `${name}() is no longer in calculator.js.` }
    const guarded = block.replace(/\{\n/, '{\n  assertNumbers(a, b);\n')
    const after = name === 'add' ? `${helper}\n\n${guarded}` : guarded
    hunks.push(replaceHunk(CAL, name, block, after))
  }
  hunks.push(appendHunk(TEST, 'test:validate', `
test('operations reject non-number input', () => {
  expect(() => calc.multiply('x', 2)).toThrow('must be numbers');
});
`))
  return {
    hunks,
    affects: {
      modules: [CAL],
      apis: ['add(a, b)', 'subtract(a, b)', 'multiply(a, b)', 'divide(a, b)'],
      tests: ['calculator.test.js — adds "non-number input" case'],
      dependencies: ['assertNumbers (new helper)'],
    },
  }
}

function tPower(files) {
  if (files[CAL].includes('function power')) return { skip: 'power() already exists.' }
  const hunks = [
    appendHunk(CAL, 'power', `
function power(base, exponent) {
  return Math.pow(base, exponent);
}
module.exports.power = power;
`),
    appendHunk(TEST, 'test:power', `
test('power raises base to an exponent', () => {
  expect(calc.power(2, 5)).toBe(32);
});
`),
  ]
  return {
    hunks,
    affects: {
      modules: [CAL],
      apis: ['power(base, exponent) — new'],
      tests: ['calculator.test.js — adds "power" case'],
      dependencies: ['Math.pow'],
    },
  }
}

function tPercent(files) {
  if (files[CAL].includes('function percent(')) return { skip: 'percent() already exists.' }
  const hunks = [
    appendHunk(CAL, 'percent', `
function percent(part, whole) {
  return divide(part, whole) * 100;
}
module.exports.percent = percent;
`),
    appendHunk(TEST, 'test:percent', `
test('percent expresses part as a share of whole', () => {
  expect(calc.percent(1, 4)).toBe(25);
});
`),
  ]
  return {
    hunks,
    affects: {
      modules: [CAL],
      apis: ['percent(part, whole) — new'],
      tests: ['calculator.test.js — adds "percent" case'],
      dependencies: ['divide() — relies on its divide-by-zero guard'],
    },
  }
}

function tPercentChange(files) {
  if (files[CAL].includes('function percentChange')) return { skip: 'percentChange() already exists.' }
  const hunks = [
    appendHunk(CAL, 'percentChange', `
function percentChange(from, to) {
  return percent(to - from, from);
}
module.exports.percentChange = percentChange;
`),
    appendHunk(TEST, 'test:percentchange', `
test('percentChange measures growth between two values', () => {
  expect(calc.percentChange(200, 250)).toBe(25);
});
`),
  ]
  return {
    hunks,
    affects: {
      modules: [CAL],
      apis: ['percentChange(from, to) — new'],
      tests: ['calculator.test.js — adds "percentChange" case'],
      dependencies: ['percent() — builds directly on it'],
    },
  }
}

/* ---------- request catalogue ---------- */
// `requires` names a capability that must already be applied; the planner
// resolves it to a concrete intent id and records the graph edge.

const REQUESTS = [
  {
    key: 'guard-divide',
    chip: 'Guard divide against zero',
    kind: 'bugfix',
    risk: 'medium',
    title: 'Guard divide against division by zero',
    summary: 'Make divide(a, b) throw a clear error instead of returning Infinity when b is 0.',
    rationale:
      'divide currently returns Infinity for a zero denominator, which propagates silently into callers and corrupts downstream math. Throwing at the boundary surfaces the mistake where it happens and is the precondition other numeric features build on.',
    provides: 'divide-guard',
    keywords: ['divide', 'zero', 'division by zero', 'guard', 'denominator', 'infinity'],
    transform: tGuardDivide,
  },
  {
    key: 'validate-numbers',
    chip: 'Validate numeric inputs',
    kind: 'validation',
    risk: 'medium',
    title: 'Validate that inputs are numbers',
    summary: 'Reject non-number arguments across all four operations with a shared assertNumbers helper.',
    rationale:
      'JavaScript coerces strings and NaN into arithmetic silently, so add("2", 3) returns "23". A single validation helper called from every operation turns those into explicit, testable errors.',
    provides: 'input-validation',
    keywords: ['validate', 'validation', 'input', 'type', 'number', 'nan', 'non-number', 'guard input'],
    transform: tValidateNumbers,
  },
  {
    key: 'add-power',
    chip: 'Add a power() function',
    kind: 'feature',
    risk: 'low',
    title: 'Add a power(base, exponent) function',
    summary: 'Introduce power() for exponentiation and export it.',
    rationale:
      'Exponentiation is a common request the module cannot express today. It is additive and independent of the existing operations, so it carries little risk.',
    provides: 'power',
    keywords: ['power', 'exponent', 'exponentiation', 'raise', 'pow'],
    transform: tPower,
  },
  {
    key: 'add-percent',
    chip: 'Add percent() (needs divide guard)',
    kind: 'api-change',
    risk: 'high',
    title: 'Add percent(part, whole) built on divide',
    summary: 'Add percent() to the public API. It calls divide() and depends on the divide-by-zero guard.',
    rationale:
      'percent() divides by whole, so it inherits divide\'s behavior for a zero denominator. It must build on the guarded divide — otherwise percent(1, 0) silently yields Infinity. Because it changes the public surface and depends on another change, it is treated as high-risk and needs explicit approval.',
    provides: 'percent',
    requires: 'divide-guard',
    keywords: ['percent', 'percentage', 'share', 'ratio', 'proportion'],
    transform: tPercent,
  },
  {
    key: 'add-percent-change',
    chip: 'Add percentChange() (needs percent)',
    kind: 'feature',
    risk: 'medium',
    title: 'Add percentChange(from, to) built on percent',
    summary: 'Add percentChange(), which reuses percent() to measure growth between two values.',
    rationale:
      'percentChange builds one level higher on percent(), extending the dependency chain. It is useful for showing how a multi-step revert has to unwind in order.',
    provides: 'percent-change',
    requires: 'percent',
    keywords: ['percent change', 'percentchange', 'growth', 'change', 'delta', 'increase'],
    transform: tPercentChange,
  },
]

export const AGENT_CHIPS = REQUESTS.map((r) => ({ key: r.key, label: r.chip }))

let seq = 0
const newId = () => `int-${Date.now().toString(36)}-${(seq++).toString(36)}`

function findByKey(key) {
  return REQUESTS.find((r) => r.key === key)
}

function matchRequest(text) {
  const t = text.toLowerCase()
  // Prefer the most specific match (longest matching keyword).
  let best = null
  let bestLen = 0
  for (const r of REQUESTS) {
    for (const kw of r.keywords) {
      if (t.includes(kw) && kw.length > bestLen) {
        best = r
        bestLen = kw.length
      }
    }
  }
  return best
}

/**
 * Plan an intent from a request.
 * @param {string|{key}} request natural-language text, or a chip {key}
 * @param {object} ctx { files, applied: Intent[] }
 * @returns {{ ok:true, intent } | { ok:false, reason, unmatched? }}
 */
export function planIntent(request, { files, applied }) {
  const def = typeof request === 'string' ? matchRequest(request) : findByKey(request.key)
  if (!def) {
    return {
      ok: false,
      unmatched: true,
      reason:
        "I can't plan that one in this offline workspace yet. Try one of the suggested requests — each maps to a real, reviewable edit.",
    }
  }

  // Resolve an explicit dependency to an applied intent, if the request needs one.
  let dependsOn = []
  if (def.requires) {
    const dep = applied.find((i) => i.provides === def.requires)
    if (!dep) {
      const provider = REQUESTS.find((r) => r.provides === def.requires)
      return {
        ok: false,
        reason: `This change depends on “${provider?.title || def.requires}”, which isn't applied yet. Apply that first, then ask again.`,
      }
    }
    dependsOn = [dep.id]
  }

  const result = def.transform(files)
  if (result.skip) return { ok: false, reason: result.skip }

  const intent = {
    id: newId(),
    key: def.key,
    provides: def.provides,
    title: def.title,
    summary: def.summary,
    rationale: def.rationale,
    kind: def.kind,
    risk: def.risk,
    status: 'proposed',
    dependsOn,
    hunks: result.hunks,
    symbols: symbolsFromHunks(result.hunks),
    affects: result.affects,
    createdAt: Date.now(),
  }
  return { ok: true, intent }
}
