const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

let projectId = null
let projectPromise = null
let unsubscribeStream = null

const request = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })

  const text = await res.text()
  let data = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    const error = new Error(
      data?.message ?? data?.error ?? `Request failed: ${res.status}`,
    )
    error.status = res.status
    Object.assign(error, data ?? {})
    throw error
  }

  return data
}

const ensureProject = async () => {
  if (projectId) return projectId

  if (projectPromise) return projectPromise

  projectPromise = (async () => {
    const projects = await request('/projects')

    if (projects?.length > 0) {
      projectId = projects[projects.length - 1].id
      return projectId
    }

    const project = await request('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'JavaAI Workspace',
        testCommand: 'bun test',
      }),
    })

    projectId = project.id
    return projectId
  })()

  try {
    return await projectPromise
  } finally {
    projectPromise = null
  }
}

const getFiles = async () => {
  const pid = await ensureProject()
  const rows = await request(`/projects/${pid}/files`)

  return Object.fromEntries(
    rows.map((file) => [file.path, file.content]),
  )
}

const getIntents = async () => {
  const pid = await ensureProject()
  return request(`/projects/${pid}/intents`)
}

const getGraph = async () => {
  const pid = await ensureProject()
  return request(`/projects/${pid}/graph`)
}

const getEvents = async () => {
  return request('/events')
}

const getStats = async () => {
  return request('/stats')
}

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

export const api = {
  async getState() {
    const [files, intents, events, graph, stats] = await Promise.all([
      getFiles(),
      getIntents(),
      getEvents(),
      getGraph(),
      getStats(),
    ])

    return {
      files,
      order: Object.keys(files),
      entry: null,
      intents,
      events,
      runs: [],
      graph,
      stats,
    }
  },

  async getEvents() {
    return getEvents()
  },

  async getStats() {
    return getStats()
  },

  async runTests() {
    const pid = await ensureProject()

    try {
      const response = await request(`/projects/${pid}/test`, {
        method: 'POST',
      })

      const execution = response?.execution ?? response

      const stdout = execution?.stdout || ''
      const stderr = execution?.stderr || ''
      const ok = execution?.ok === true || response?.ok === true

      // The backend currently returns raw bun output rather than
      // individual test records. Convert that output into the shape
      // RunPanel expects while preserving the genuine backend result.
      const output = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()

      const results = [
        {
          name: execution?.status === 'running' ? 'bun test' : 'bun test',
          pass: ok,
          ms:
            typeof execution?.durationMs === 'number'
              ? execution.durationMs
              : undefined,
          error: ok ? null : (stderr || stdout || 'Tests failed'),
        },
      ]

      const logs = output
        ? output.split('\n').map((text) => ({
            level: ok ? 'info' : 'error',
            text,
          }))
        : []

      return {
        id: execution?.id ?? Date.now(),
        ok,
        results,
        logs,
        durationMs: execution?.durationMs ?? 0,
        error: ok ? null : (stderr || stdout || 'Test suite failed'),
        execution,
        projectId: response?.projectId ?? pid,
      }
    } catch (error) {
      return {
        id: Date.now(),
        ok: false,
        results: [
          {
            name: 'bun test',
            pass: false,
            error: error.message || 'Failed to run tests',
          },
        ],
        logs: [],
        durationMs: 0,
        error: error.message || 'Failed to run tests',
      }
    }
  },

  async getIntentGraph() {
    const [intents, graph] = await Promise.all([
      getIntents(),
      getGraph(),
    ])

    return {
      intents,
      ...graph,
    }
  },

  async writeFile(path, content, { silent = false } = {}) {
    const pid = await ensureProject()

    await request(`/projects/${pid}/files`, {
      method: 'POST',
      body: JSON.stringify({
        files: [{ path, content }],
      }),
    })

    return { ok: true }
  },

  async planRequest(requestInput) {
    const pid = await ensureProject()

    const CHIP_PROMPTS = {
      'guard-divide':
        'Guard divide(a, b) against division by zero. Update calculator.js so divide throws an Error with the message "Cannot divide by zero" when b is 0, and add a test covering divide(1, 0).',
      'validate-numbers':
        'Validate numeric inputs across add, subtract, multiply, and divide. Add a shared assertNumbers helper that rejects non-number values and NaN, call it from every operation, and add a test.',
      'add-power':
        'Add a power(base, exponent) function to calculator.js using Math.pow. Export the function and add a test verifying power(2, 5) returns 32.',
    }

    const rawText =
      typeof requestInput === 'string'
        ? requestInput.trim()
        : String(
            requestInput?.text ??
            requestInput?.prompt ??
            requestInput?.description ??
            ''
          ).trim()

    const text =
      typeof requestInput === 'object' && requestInput?.key
        ? CHIP_PROMPTS[requestInput.key] ?? rawText
        : rawText


    if (!text) {
      return {
        ok: false,
        error: 'A prompt is required.',
      }
    }

    try {
      const key = (typeof requestInput === 'object' && requestInput?.key) || undefined
      const intent = await request(`/projects/${pid}/prompts`, {
        method: 'POST',
        body: JSON.stringify(key ? { key, text } : { text }),
      })


      return {
        ok: true,
        intent,
      }
    } catch (error) {

      return {
        ok: false,
        error: error.message,
      }
    }
  },

  async discardProposal(intentId) {
    // The backend currently has no discard endpoint.
    // Keep this as a frontend-compatible no-op.
    return {
      ok: true,
      intentId,
    }
  },

  async apply(intentId, { approve = false } = {}) {
    try {
      await request(`/intents/${intentId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      })
    } catch (error) {
      if (error.status === 403) {
        throw new ApprovalRequired(error.intent ?? { id: intentId })
      }
      throw error
    }
    const result = await request(`/intents/${intentId}/execute`, {
      method: "POST",
    })
    return { ok: true, ...result }
  },

  async execute(intentId) {
    return request(`/intents/${intentId}/execute`, {
      method: 'POST',
    })
  },

  async revert(intentId, { dryRun = false, cascade = false } = {}) {
    try {
      return await request(`/intents/${intentId}/revert`, {
        method: 'POST',
        body: JSON.stringify({
          dry_run: dryRun,
          cascade,
        }),
      })
    } catch (error) {
      if (error.status === 409) {
        throw new RevertBlocked(error.plan ?? error)
      }

      throw error
    }
  },

  async run() {
    return this.runTests()
  },

  async reset() {
    // Start over: create a brand-new project and point the client at it.
    projectId = null
    projectPromise = null
    const project = await request('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'JavaAI Workspace', testCommand: 'bun test' }),
    })
    projectId = project.id
    return { ok: true, projectId: project.id }
  },

  subscribe(fn) {
    let closed = false
    let eventSource = null

    const start = async () => {
      try {
        const pid = await ensureProject()

        if (closed) return

        eventSource = new EventSource(
          `${API_BASE}/projects/${pid}/stream`,
        )

        eventSource.onmessage = (event) => {
          try {
            fn(JSON.parse(event.data))
          } catch {
            fn(event.data)
          }
        }

        eventSource.onerror = () => {
          if (closed) { eventSource?.close(); eventSource = null }
        }

        unsubscribeStream = () => {
          eventSource?.close()
          eventSource = null
        }
      } catch (error) {
        console.error('Failed to connect to intent stream:', error)
      }
    }

    start()

    return () => {
      closed = true
      eventSource?.close()

      if (unsubscribeStream) {
        unsubscribeStream()
        unsubscribeStream = null
      }
    }
  },

  async setProject(id) {
    projectId = id
    return id
  },

  async getProject() {
    return ensureProject()
  },
}

export { ConflictError } from '../domain/intents'
