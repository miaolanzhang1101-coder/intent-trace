import { planIntent } from '../src/domain/agent.js'
import {
  applyIntent,
  revertIntents,
  planRevert,
  layoutGraph,
  ConflictError,
} from '../src/domain/intents.js'
import { BASELINE_FILES, ENTRY_TEST } from '../src/domain/project.js'


// ---------------------------------------------------------------------------
// Persistent local state
// ---------------------------------------------------------------------------
// The demo must survive Bun restarts. Previously projects/intents/executions
// lived only in process memory, which caused valid IDs to become "not found"
// every time the backend was restarted.
//
// This keeps the demo self-contained while giving it a durable local store.
// The JSON file is intentionally local and gitignored.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"

const STATE_FILE = join(process.cwd(), "server", ".javaai-state.json")

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {
      projects: [],
      intents: [],
      events: [],
      executions: [],
    }
  }

  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch (error) {
    console.error("[JavaAI] Failed to load state:", error)
    return {
      projects: [],
      intents: [],
      events: [],
      executions: [],
    }
  }
}

let persistentState = loadState()

function saveState() {
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(persistentState, null, 2))
  renameSync(tmp, STATE_FILE)
}

function persistProject(project) {
  const index = persistentState.projects.findIndex((p) => p.id === project.id)
  if (index === -1) persistentState.projects.push(project)
  else persistentState.projects[index] = project
  saveState()
}

function persistIntent(intent) {
  const index = persistentState.intents.findIndex((i) => i.id === intent.id)
  if (index === -1) persistentState.intents.push(intent)
  else persistentState.intents[index] = intent
  saveState()
}

function persistExecution(execution) {
  const index = persistentState.executions.findIndex((e) => e.id === execution.id)
  if (index === -1) persistentState.executions.push(execution)
  else persistentState.executions[index] = execution
  saveState()
}

function persistEvent(event) {
  persistentState.events.push(event)
  saveState()
}

const PORT = Number(process.env.PORT || 3000)

const projects = new Map()
const intents = new Map()
const events = []
const subscribers = new Map()
for (const p of persistentState.projects || []) projects.set(p.id, p);
for (const i of persistentState.intents || []) intents.set(i.id, i);

let projectSequence = 0
let executionSequence = 0

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${(++projectSequence).toString(36)}`
}

function executionId() {
  return `exec-${Date.now().toString(36)}-${(++executionSequence).toString(36)}`
}

function now() {
  return Date.now()
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  })
}

function notFound(message = 'Not found') {
  return json({ error: message }, 404)
}

function badRequest(message) {
  return json({ error: message }, 400)
}

function getProject(id) {
  return projects.get(id)
}

function getIntent(id) {
  return intents.get(id)
}

function emit(projectId, type, payload = {}) {
  const event = {
    id: `evt-${Date.now().toString(36)}-${events.length.toString(36)}`,
    projectId,
    type,
    createdAt: now(),
    ...payload,
  }

  events.push(event)

  const listeners = subscribers.get(projectId) || []

  for (const controller of listeners) {
    controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
  }

  return event
}

function projectIntents(projectId) {
  return [...intents.values()]
    .filter((intent) => intent.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

function appliedIntents(projectId) {
  return projectIntents(projectId)
    .filter((intent) => intent.status === 'applied')
    .sort((a, b) => a.appliedAt - b.appliedAt)
}

function serializeIntent(intent) {
  if (!intent) return null

  return {
    ...intent,
    executions: intent.executions || [],
  }
}

function createProject(body = {}) {
  const project = {
    id: `prj-${Date.now().toString(36)}-${(++projectSequence).toString(36)}`,
    name: body.name || 'JavaAI Workspace',
    testCommand: body.testCommand || 'bun test',
    files: { ...BASELINE_FILES },
    createdAt: now(),
  }

  projects.set(project.id, project)
  persistProject(project);

  emit(project.id, 'project.created', {
    project: {
      id: project.id,
      name: project.name,
      testCommand: project.testCommand,
    },
  })

  return project
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function executeProjectTests(project) {
  const started = now()

  let proc

  try {
    /*
     * The workspace is materialized into a temporary directory.
     * The project's configured command is then executed from that directory.
     */
    const dir = await fsTempDir(project.id)

    for (const [path, content] of Object.entries(project.files)) {
      const target = `${dir}/${path}`
      const parent = target.slice(0, target.lastIndexOf('/'))

      await Bun.write(target, content)
    }

    const parts = project.testCommand.trim().split(/\s+/)

    if (!parts.length) {
      throw new Error('Project has no test command.')
    }

    const command = parts[0]
    const args = parts.slice(1)

    proc = Bun.spawn([command, ...args], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const timeout = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
    }, 10000)

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    clearTimeout(timeout)

    return {
      ok: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      durationMs: now() - started,
    }
  } catch (error) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: error?.message || String(error),
      durationMs: now() - started,
    }
  }
}

async function fsTempDir(projectId) {
  const dir = `/tmp/javaai-${projectId}-${Date.now()}`
  await Bun.write(`${dir}/.keep`, '')
  return dir
}

async function handleCreateIntent(project, body) {
  const text =
    typeof body?.text === 'string'
      ? body.text.trim()
      : typeof body?.prompt === 'string'
        ? body.prompt.trim()
        : ''

  if (!text) {
    return badRequest('A prompt is required.')
  }

  const applied = appliedIntents(project.id)

  const planInput = typeof body?.key === 'string' && body.key ? { key: body.key, text } : text

  const result = await planIntent(planInput, {
    files: project.files,
    applied,
  })

  if (!result.ok) {
    return json(
      {
        error: result.reason,
        unmatched: result.unmatched || false,
      },
      422,
    )
  }

  const intent = {
    ...result.intent,
    projectId: project.id,
    status: 'proposed',
    createdAt: now(),
    approvedAt: null,
    appliedAt: null,
    revertedAt: null,
    executions: [],
  }

  intents.set(intent.id, intent)
  persistIntent(intent);

  emit(project.id, 'intent.created', {
    intent: serializeIntent(intent),
  })

  return json(serializeIntent(intent), 201)
}

async function handleApprove(intent, body) {
  const approve = body?.approve === true

  if (intent.risk === 'high' && !approve) {
    return json(
      {
        error: 'High-risk change requires explicit approval.',
        intent: serializeIntent(intent),
      },
      403,
    )
  }

  intent.status = 'approved'
  intent.approvedAt = now()

  persistIntent(intent)
  emit(intent.projectId, 'intent.approved', {
    intentId: intent.id,
  })

  return json(serializeIntent(intent))
}

async function handleExecute(intent) {
  const project = getProject(intent.projectId)

  if (!project) {
    return notFound('Project not found.')
  }

  if (intent.status === 'proposed' && intent.risk === 'high') {
    return json(
      {
        error: 'High-risk change requires explicit approval.',
        intent: serializeIntent(intent),
      },
      403,
    )
  }

  if (intent.status === 'reverted') {
    return json({ error: 'A reverted intent cannot be executed again.' }, 409)
  }

  const dependencyIds = intent.dependsOn || []

  for (const dependencyId of dependencyIds) {
    const dependency = getIntent(dependencyId)

    if (!dependency || dependency.status !== 'applied') {
      return json(
        {
          error: 'Intent dependency has not been applied.',
          dependencyId,
        },
        409,
      )
    }
  }

  const execution = {
    id: executionId(),
    intentId: intent.id,
    projectId: project.id,
    status: 'running',
    startedAt: now(),
    finishedAt: null,
    ok: null,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: null,
  }

  intent.executions ||= []

  project.executions ||= []
  project.executions.unshift(execution)

  emit(project.id, 'execution.started', {
    intentId: intent.id,
    executionId: execution.id,
  })

  try {
    execution.filesBefore = { ...project.files }
    project.files = applyIntent(project.files, intent)
    execution.filesAfter = { ...project.files }
    intent.status = 'applied'
    intent.appliedAt = now()

    persistIntent(intent)
    persistProject(project)
    const result = await executeProjectTests(project)

    execution.status = result.ok ? 'passed' : 'failed'
    execution.ok = result.ok
    execution.exitCode = result.exitCode
    execution.stdout = result.stdout
    execution.stderr = result.stderr
    execution.durationMs = result.durationMs
    execution.finishedAt = now()

    persistExecution(execution)
    persistProject(project)
    if (!result.ok) {
      /*
       * If the change causes the test suite to fail, keep the edit applied
       * but expose the failed execution. This makes the failure observable
       * rather than silently rolling back user work.
       */
      emit(project.id, 'execution.finished', {
        intentId: intent.id,
        executionId: execution.id,
        ok: false,
        status: 'failed',
      })

      return json({
        ok: false,
        intent: serializeIntent(intent),
        execution,
      })
    }

    emit(project.id, 'intent.executed', {
      intentId: intent.id,
      executionId: execution.id,
    })

    emit(project.id, 'execution.finished', {
      intentId: intent.id,
      executionId: execution.id,
      ok: true,
      status: 'passed',
    })

    return json({
      ok: true,
      intent: serializeIntent(intent),
      execution,
    })
  } catch (error) {
    execution.status = 'failed'
    execution.ok = false
    execution.finishedAt = now()

    persistExecution(execution)
    persistProject(project)
    execution.stderr = error?.message || String(error)
    execution.durationMs = execution.finishedAt - execution.startedAt

    emit(project.id, 'execution.finished', {
      intentId: intent.id,
      executionId: execution.id,
      ok: false,
      status: 'failed',
      error: execution.stderr,
    })

    return json({
      ok: false,
      intent: serializeIntent(intent),
      execution,
      error: execution.stderr,
    }, 500)
  }
}

async function handleRevert(intent, body) {
  const project = getProject(intent.projectId)

  if (!project) {
    return notFound('Project not found.')
  }

  const applied = appliedIntents(project.id)
  const plan = planRevert(intent, applied)

  if (body?.dry_run) {
    return json({
      target: plan.target,
      wouldRevert: plan.wouldRevert,
      requiredBy: plan.requiredBy,
      affectedFiles: plan.affectedFiles,
      blocked: plan.blocked,
    })
  }

  if (plan.blocked && !body?.cascade) {
    return json(
      {
        error: 'Revert blocked: other applied intents require this one.',
        required_by: plan.requiredBy,
        plan,
      },
      409,
    )
  }

  try {
    // Restore from each step's pre-image snapshot, newest applied first, so a
    // hand-edit made in the diff panel after execute can't break the revert.
    const ordered = [...plan.wouldRevert].sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0))
    for (const item of ordered) {
      const snap = (item.executions || [])
        .filter((e) => e.filesBefore)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]
      if (snap) {
        for (const [path, content] of Object.entries(snap.filesBefore)) {
          project.files[path] = content
        }
      } else {
        project.files = revertIntents(project.files, [item])
      }
      item.status = 'reverted'
      item.revertedAt = now()
      persistIntent(item)
      emit(project.id, 'intent.reverted', {
        intentId: item.id,
      })
    }

    return json({
      ok: true,
      target: intent.id,
      reverted: plan.wouldRevert.map((i) => i.id),
      files: project.files,
    })
  } catch (error) {
    if (error instanceof ConflictError) {
      return json(
        {
          error: error.message,
          name: error.name,
        },
        409,
      )
    }

    return json(
      {
        error: error?.message || String(error),
      },
      500,
    )
  }
}

async function handleRequest(request) {
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
    })
  }

  if (method === 'GET' && pathname === '/health') {
    return json({
      ok: true,
      service: 'javaai-backend',
      time: now(),
    })
  }

  if (method === 'GET' && pathname === '/projects') {
    return json(
      [...projects.values()].map((project) => ({
        id: project.id,
        name: project.name,
        testCommand: project.testCommand,
        createdAt: project.createdAt,
      })),
    )
  }

  if (method === 'POST' && pathname === '/projects') {
    const body = await readJson(request)
    return json(createProject(body), 201)
  }

  const projectTestMatch = pathname.match(/^\/projects\/([^/]+)\/test$/)

  if (projectTestMatch && method === 'POST') {
    const project = getProject(projectTestMatch[1])

    if (!project) {
      return notFound('Project not found.')
    }

    const execution = {
      id: executionId(),
      intentId: null,
      projectId: project.id,
      status: 'running',
      startedAt: now(),
      finishedAt: null,
      ok: null,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: null,
    }

    project.executions ||= []
    project.executions.unshift(execution)

    emit(project.id, 'execution.started', {
      intentId: null,
      executionId: execution.id,
      type: 'project.test',
    })

    const result = await executeProjectTests(project)

    execution.status = result.ok ? 'passed' : 'failed'
    execution.ok = result.ok
    execution.exitCode = result.exitCode
    execution.stdout = result.stdout
    execution.stderr = result.stderr
    execution.durationMs = result.durationMs
    execution.finishedAt = now()

    persistExecution(execution)
    persistProject(project)
    emit(project.id, 'execution.finished', {
      intentId: null,
      executionId: execution.id,
      ok: result.ok,
      status: execution.status,
      type: 'project.test',
    })

    return json({
      ok: result.ok,
      execution,
      projectId: project.id,
    }, result.ok ? 200 : 422)
  }

  const projectFilesMatch = pathname.match(/^\/projects\/([^/]+)\/files$/)

  if (projectFilesMatch) {
    const project = getProject(projectFilesMatch[1])

    if (!project) return notFound('Project not found.')

    if (method === 'GET') {
      return json(
        Object.entries(project.files).map(([path, content]) => ({
          path,
          content,
        })),
      )
    }

    if (method === 'POST') {
      const body = await readJson(request)

      for (const file of body.files || []) {
        if (!file?.path) continue
        project.files[file.path] = String(file.content ?? '')
      }

  persistProject(project);
      emit(project.id, 'workspace.updated', {
        files: Object.keys(project.files),
      })

      return json({ ok: true })
    }
  }

  const projectIntentsMatch = pathname.match(/^\/projects\/([^/]+)\/intents$/)

  if (projectIntentsMatch && method === 'GET') {
    const project = getProject(projectIntentsMatch[1])
    if (!project) return notFound('Project not found.')

    return json(projectIntents(project.id).map(serializeIntent))
  }

  const promptMatch = pathname.match(/^\/projects\/([^/]+)\/prompts$/)

  if (promptMatch && method === 'POST') {
    const project = getProject(promptMatch[1])
    if (!project) return notFound('Project not found.')

    return handleCreateIntent(project, await readJson(request))
  }

  const graphMatch = pathname.match(/^\/projects\/([^/]+)\/graph$/)

  if (graphMatch && method === 'GET') {
    const project = getProject(graphMatch[1])
    if (!project) return notFound('Project not found.')

    return json(layoutGraph(projectIntents(project.id)))
  }

  const streamMatch = pathname.match(/^\/projects\/([^/]+)\/stream$/)

  if (streamMatch && method === 'GET') {
    const projectId = streamMatch[1]

    if (!projects.has(projectId)) {
      return notFound('Project not found.')
    }

    let controller

    const stream = new ReadableStream({
      start(c) {
        controller = c

        if (!subscribers.has(projectId)) {
          subscribers.set(projectId, [])
        }

        subscribers.get(projectId).push(controller)
        controller.enqueue(": ping" + String.fromCharCode(10,10));
        controller.__ping = setInterval(() => {
          try { controller.enqueue(': ping' + String.fromCharCode(10, 10)) } catch { clearInterval(controller.__ping) }
        }, 3000)

        controller.enqueue(
          `data: ${JSON.stringify({
            type: 'stream.connected',
            projectId,
            createdAt: now(),
          })}\n\n`,
        )
      },

      cancel() {
        if (controller && controller.__ping) clearInterval(controller.__ping)
        const listeners = subscribers.get(projectId) || []
        const next = listeners.filter((item) => item !== controller)

        if (next.length) {
          subscribers.set(projectId, next)
        } else {
          subscribers.delete(projectId)
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  const intentMatch = pathname.match(/^\/intents\/([^/]+)$/)

  if (intentMatch && method === 'GET') {
    const intent = getIntent(intentMatch[1])
    if (!intent) return notFound('Intent not found.')

    return json(serializeIntent(intent))
  }

  const approveMatch = pathname.match(/^\/intents\/([^/]+)\/approve$/)

  if (approveMatch && method === 'POST') {
    const intent = getIntent(approveMatch[1])
    if (!intent) return notFound('Intent not found.')

    return handleApprove(intent, await readJson(request))
  }

  const executeMatch = pathname.match(/^\/intents\/([^/]+)\/execute$/)

  if (executeMatch && method === 'POST') {
    const intent = getIntent(executeMatch[1])
    if (!intent) return notFound('Intent not found.')

    return handleExecute(intent)
  }

  const revertMatch = pathname.match(/^\/intents\/([^/]+)\/revert$/)

  if (revertMatch && method === 'POST') {
    const intent = getIntent(revertMatch[1])
    if (!intent) return notFound('Intent not found.')

    return handleRevert(intent, await readJson(request))
  }

  if (method === 'GET' && pathname === '/intents/graph') {
    const all = [...intents.values()]
    return json(layoutGraph(all))
  }

  if (method === 'GET' && pathname === '/events') {
    return json(events)
  }

  if (method === 'GET' && pathname === '/stats') {
    const allIntents = [...intents.values()]
    const executions = allIntents.flatMap((intent) => intent.executions || [])

    return json({
      projects: [...projects.values()].map((project) => ({
        id: project.id,
        name: project.name,
        testCommand: project.testCommand,
        createdAt: project.createdAt,
      })),
      intents: {
        total: allIntents.length,
        proposed: allIntents.filter((i) => i.status === 'proposed').length,
        approved: allIntents.filter((i) => i.status === 'approved').length,
        applied: allIntents.filter((i) => i.status === 'applied').length,
        reverted: allIntents.filter((i) => i.status === 'reverted').length,
      },
      executions: {
        total: executions.length,
        passed: executions.filter((e) => e.ok === true).length,
        failed: executions.filter((e) => e.ok === false).length,
      },
      events: events.length,
    })
  }

  return notFound()
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handleRequest,
})

console.log(`JavaAI backend running at http://localhost:${server.port}`)

if (projects.size === 0) {
  createProject({
    name: 'JavaAI Workspace',
    testCommand: 'bun test',
  })
}
