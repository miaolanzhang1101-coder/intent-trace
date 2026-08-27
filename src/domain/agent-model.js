// Real-model planner. Turns an arbitrary natural-language request into the SAME
// intent shape the local chip transforms produce, so everything downstream
// (apply / run / dependency-aware revert / cascade) works unchanged.
//
// The key robustness piece is interpretModelJSON(): a model's #1 failure mode
// is returning a `before` block that doesn't byte-match the live file, which
// would make applyIntent throw. We validate every hunk against the real files
// and reject with a helpful reason instead of corrupting the workspace.

const MODEL = 'claude-sonnet-4-5'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

const SYSTEM = `You are a code-editing agent for a small JavaScript project.
Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "title": string,
  "summary": string,
  "rationale": string,
  "kind": "bugfix"|"feature"|"refactor"|"validation"|"api-change",
  "risk": "low"|"medium"|"high",
  "provides": string,
  "dependsOn": string[],
  "hunks": [
    { "path": string, "op": "replace"|"append", "symbol": string,
      "before": string, "after": string }
  ]
}
RULES:
- For op "replace", "before" MUST be copied EXACTLY from the provided file
  contents (whitespace and newlines included). Never paraphrase it.
- For op "append", "before" must be "" and "after" is text added at end of file.
- Only edit files that exist in the provided workspace.
- If this change introduces something later code can build on, set "provides"
  to a short capability id. If it relies on an earlier change, put that
  capability id in "dependsOn". Otherwise use [].
- Keep the change minimal, runnable, and include a test edit when sensible.`

let seq = 0
const newId = () => `int-${Date.now().toString(36)}-${(seq++).toString(36)}`

// Pure: validate + normalize the model's JSON into a canonical intent.
export function interpretModelJSON(raw, { files, applied }) {
  let spec
  try {
    spec = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return { ok: false, reason: 'The model did not return valid JSON. Try rephrasing the request.' }
  }

  if (!Array.isArray(spec.hunks) || spec.hunks.length === 0) {
    return { ok: false, reason: 'The model returned no edits.' }
  }

  const hunks = []
  for (const h of spec.hunks) {
    if (!h || typeof h.path !== 'string' || !(h.path in files)) {
      return { ok: false, reason: `The model targeted a file that isn't in the workspace: ${h?.path}.` }
    }
    if (h.op === 'replace') {
      if (typeof h.before !== 'string' || !files[h.path].includes(h.before)) {
        return { ok: false, reason: `The model's "before" text for ${h.path} didn't match the file. Try rephrasing.` }
      }
    } else if (h.op !== 'append') {
      return { ok: false, reason: `Unsupported edit op from the model: ${h.op}.` }
    }
    hunks.push({
      path: h.path,
      op: h.op,
      symbol: typeof h.symbol === 'string' && h.symbol ? h.symbol : h.path,
      before: h.op === 'append' ? '' : h.before,
      after: typeof h.after === 'string' ? h.after : '',
    })
  }

  const symbols = {}
  for (const h of hunks) (symbols[h.path] ||= []).push(h.symbol)

  const dependsOn = (Array.isArray(spec.dependsOn) ? spec.dependsOn : [])
    .map((cap) => applied.find((i) => i.provides === cap)?.id)
    .filter(Boolean)

  const paths = [...new Set(hunks.map((h) => h.path))]
  const affects = {
    modules: paths.filter((p) => !p.includes('.test.')),
    apis: [],
    tests: paths.filter((p) => p.includes('.test.')),
    dependencies: [],
  }

  return {
    ok: true,
    intent: {
      id: newId(),
      title: spec.title || 'AI change',
      summary: spec.summary || '',
      rationale: spec.rationale || '',
      kind: ['bugfix', 'feature', 'refactor', 'validation', 'api-change'].includes(spec.kind) ? spec.kind : 'feature',
      risk: ['low', 'medium', 'high'].includes(spec.risk) ? spec.risk : 'medium',
      provides: typeof spec.provides === 'string' && spec.provides ? spec.provides : undefined,
      dependsOn,
      hunks,
      symbols,
      affects,
    },
  }
}

// Network: call Claude, then hand the raw text to interpretModelJSON.
export async function planWithModel(text, { files, applied }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return { ok: false, reason: 'No ANTHROPIC_API_KEY set on the server. Use a suggested chip, or add a key and retry.' }
  }

  const workspace = Object.entries(files)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n')
  const capabilities = applied.map((i) => i.provides).filter(Boolean)

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content:
            `Current workspace files:\n\n${workspace}\n\n` +
            `Capabilities already applied that you may depend on: ${JSON.stringify(capabilities)}\n\n` +
            `Request: ${text}`,
        }],
      }),
    })
  } catch (err) {
    return { ok: false, reason: `Could not reach the model: ${err.message}` }
  }

  if (!res.ok) {
    return { ok: false, reason: `Model call failed (${res.status}). Check the API key and try again.` }
  }

  const data = await res.json()
  const raw = data?.content?.[0]?.text ?? ''
  return interpretModelJSON(raw, { files, applied })
}
