import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { api, ApprovalRequired, RevertBlocked, ConflictError } from './api/client'
import { intentDiff } from './domain/intents'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import AgentBar from './components/AgentBar'
import CodeEditor from './components/CodeEditor'
import DiffViewer from './components/DiffViewer'
import IntentGraph from './components/IntentGraph'
import IntentInspector from './components/IntentInspector'
import RevertPlanDialog from './components/RevertPlanDialog'
import RunPanel from './components/RunPanel'
import Landing from './components/Landing'
import ActivityDock from './components/ActivityDock'
import ToastStack from './components/Toast'
import { Graph as GraphIcon, File as FileIcon, Beaker, Play, Spinner } from './components/icons'

let toastSeq = 0

function FlowBar({ selectedIntent, lastRun, running }) {
  let cls = 'flowbar__step', text
  if (running) text = 'Running tests\u2026'
  else if (!selectedIntent) text = '1 \u00b7 Ask the agent for a change'
  else if (selectedIntent.status === 'proposed') text = '2 \u00b7 Review the diff, then Apply & Run'
  else if (lastRun && (lastRun.results || []).length && (lastRun.results || []).every((r) => r.pass)) { cls += ' flowbar__step--ok'; text = '\u2713 Tests passing \u2014 the change is safe (or Revert it)' }
  else if (lastRun && (lastRun.results || []).some((r) => !r.pass)) { cls += ' flowbar__step--fail'; text = '\u2717 Tests failing \u2014 a recommended fix has been proposed' }
  else text = 'Applied \u2014 press Run to verify'
  return (
    <div className="flowbar"><span className={cls}>{text}</span></div>
  )
}

export default function App() {
  const [snap, setSnap] = useState({
    files: {},
    order: [],
    entry: null,
    intents: [],
    events: [],
    runs: [],
    graph: { nodes: [], edges: [] },
    stats: {},
  })
  const [activeFile, setActiveFile] = useState('calculator.js')
  const [selectedId, setSelectedId] = useState(null)
  const [proposalCache, setProposalCache] = useState({})
  const [view, setView] = useState('editor') // editor | diff | run
  const [agentNote, setAgentNote] = useState(null)
  const [revertPlan, setRevertPlan] = useState(null)

  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [runPhase, setRunPhase] = useState(null)
  const [runLog, setRunLog] = useState(null)
  const [showLanding, setShowLanding] = useState(true)

  const [toasts, setToasts] = useState([])
  const pushToast = useCallback((t) => setToasts((ts) => [...ts, { id: ++toastSeq, ...t }]), [])
  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState()
      setSnap(next)
    } catch (err) {
      console.error('Failed to load backend state:', err)
    }
  }, [])

  // Subscribe to the realtime stream; every event refreshes the snapshot so the
  // graph, inspector, dock and stats stay in lockstep with the store.
  useEffect(() => {
    refresh()
    return api.subscribe(() => {
      refresh()
    })
  }, [])

  const selectedIntent = useMemo(
    () =>
      proposalCache[selectedId] ||
      snap.intents.find((i) => i.id === selectedId) ||
      null,
    [proposalCache, snap.intents, selectedId],
  )

  const diffFiles = useMemo(
    () => (selectedIntent ? intentDiff(snap.files, selectedIntent) : []),
    [snap.files, selectedIntent],
  )
  const lastRun = snap.runs[snap.runs.length - 1] || null

  /* ---------- editing ---------- */
  const onEdit = async (val) => {
    await api.writeFile(activeFile, val, { silent: true })
    await refresh()
  }

  /* ---------- agent request ---------- */
  const onRequest = async (payload) => {
    console.log('[JavaAI] App onRequest payload:', payload)
    setPlanning(true)
    setAgentNote(null)

    try {
      // Keep a short delay so the planning state is visible.
      await new Promise((resolve) => setTimeout(resolve, 260))

      const res = await api.planRequest(payload)

      if (!res.ok) {
        setAgentNote({
          tone: res.unmatched ? 'muted' : 'warn',
          text: res.reason ?? res.error ?? 'Could not create proposal.',
        })
      } else {
        // Preserve the complete proposal returned by POST /prompts.
        // The backend's GET /intents response currently omits `edits`.
        setProposalCache((prev) => ({
          ...prev,
          [res.intent.id]: res.intent,
        }))
        setSelectedId(res.intent.id)
        setView('diff')
        setAgentNote({
          tone: 'ok',
          text: `Proposed “${res.intent.title}”. Review the diff and intent, then ${res.intent.risk === 'high' ? 'approve & apply' : 'apply'}.`,
        })
        await refresh()
      }
    } catch (err) {
      setAgentNote({
        tone: 'warn',
        text: String(err?.message ?? err),
      })
    } finally {
      setPlanning(false)
    }
  }

  /* ---------- recommend a fix when a run fails ---------- */
  const proposeFix = async (failedIntent) => {
    setAgentNote({ tone: 'warn', text: 'Tests are failing — asking the agent for a recommended fix…' })
    const prompt = `The change "${failedIntent.title}" caused a test to fail. Propose a minimal follow-up edit that makes the test suite pass again.`
    try {
      const res = await api.planRequest(prompt)
      if (!res.ok) {
        setAgentNote({ tone: res.unmatched ? 'muted' : 'warn', text: res.reason ?? res.error ?? 'Could not propose a fix.' })
        return
      }
      setProposalCache((prev) => ({ ...prev, [res.intent.id]: res.intent }))
      setSelectedId(res.intent.id)
      setView('diff')
      setAgentNote({ tone: 'ok', text: `Recommended fix: “${res.intent.title}”. Review the diff, then apply.` })
      await refresh()
    } catch (err) {
      setAgentNote({ tone: 'warn', text: String(err?.message ?? err) })
    }
  }

  /* ---------- apply ---------- */
  const onApply = async (intent, approve) => {
    setApplying(true)
    try {
      const result = await api.apply(intent.id, { approve })
      await refresh()
      const failed = !!(result && (result.ok === false || (result.execution && result.execution.ok === false)))
      pushToast(
        failed
          ? { tone: 'err', msg: `Applied “${intent.title}” — tests failing`, sub: 'Fetching a recommended fix…' }
          : { tone: 'ok', msg: `Applied “${intent.title}”`, sub: 'Change written to the working tree' },
      )
      setView('run')
      await doRun({ fromApply: true, files: [...new Set((intent.hunks || []).map((h) => h.path))] })
      if (failed) await proposeFix(intent)
    } catch (err) {
      if (err instanceof ApprovalRequired) {
        pushToast({ tone: 'err', msg: 'Approval required', sub: 'High-risk changes need explicit approval.' })
      } else if (err instanceof ConflictError) {
        pushToast({ tone: 'err', msg: "Couldn't apply cleanly", sub: err.message })
      } else {
        pushToast({ tone: 'err', msg: 'Apply failed', sub: String(err.message || err) })
      }
    } finally {
      setApplying(false)
    }
  }

  const onDiscard = async (intent) => {
    await api.discardProposal(intent.id)
    await refresh()
    if (selectedId === intent.id) setSelectedId(null)
    setView('editor')
  }

  /* ---------- revert (dry run -> dialog -> execute) ---------- */
  const onRevert = async (intent) => {
    try {
      const plan = await api.revert(intent.id, { dryRun: true })
      setRevertPlan(plan)
    } catch (err) {
      pushToast({ tone: 'err', msg: 'Could not plan revert', sub: String(err.message || err) })
    }
  }

  const onConfirmRevert = async (cascade) => {
    if (!revertPlan) return
    setReverting(true)
    try {
      await api.revert(revertPlan.target.id, { cascade })
      await refresh()
      pushToast({
        tone: 'ok',
        msg: cascade ? `Cascade reverted ${revertPlan.wouldRevert.length} intents` : `Reverted “${revertPlan.target.title}”`,
        sub: `Restored ${revertPlan.affectedFiles.join(', ')}`,
      })
      setRevertPlan(null)
      setView('run')
      await doRun({ fromApply: true })
    } catch (err) {
      if (err instanceof RevertBlocked) {
        // Refresh the plan so the dialog can escalate to cascade.
        setRevertPlan(err.plan)
      } else if (err instanceof ConflictError) {
        pushToast({ tone: 'err', msg: "Couldn't revert cleanly", sub: err.message })
      } else {
        pushToast({ tone: 'err', msg: 'Revert failed', sub: String(err.message || err) })
      }
    } finally {
      setReverting(false)
    }
  }

  /* ---------- run ---------- */
  const doRun = async ({ fromApply = false, files = [] } = {}) => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setView('run')
    const __t0 = Date.now()
    const __steps = []
    const __sync = () => setRunPhase({ steps: __steps.map((x) => ({ ...x })) })
    const __push = (label) => { __steps.push({ label, status: 'active' }); __sync() }
    const __settle = (status = 'done') => { if (__steps.length) __steps[__steps.length - 1].status = status; __sync() }
    const __wait = (ms) => new Promise((r) => setTimeout(r, ms))
    setRunPhase({ steps: [] })
    if (fromApply) {
      __push('Applying change'); await __wait(200); __settle()
      for (const __f of files) { __push(`Writing ${__f}`); await __wait(150); __settle() }
    }
    __push('Reading test files'); await __wait(240); __settle()
    __push('Running bun test\u2026')
    try {
      const response = await api.runTests()
      const execution = response?.execution

      const stdout = execution?.stdout || ''
      const stderr = execution?.stderr || ''
      const ok = Boolean(response?.ok ?? execution?.ok)

      const run = {
        ok,
        durationMs: execution?.durationMs ?? 0,
        results: [
          {
            name: 'bun test',
            pass: ok,
            ms: execution?.durationMs ?? 0,
            error: ok ? null : (stderr || stdout || 'Tests failed'),
          },
        ],
        logs: [
          ...stdout.split('\\n').filter(Boolean).map((text) => ({
            level: 'log',
            text,
          })),
          ...stderr.split('\\n').filter(Boolean).map((text) => ({
            level: 'error',
            text,
          })),
        ],
        error: ok ? null : 'Test suite failed',
      }

      const __elapsed = Date.now() - __t0
      if (__elapsed < 1100) await __wait(1100 - __elapsed)
      if (__steps.length) { __steps[__steps.length - 1].status = ok ? 'done' : 'fail'; __sync() }
      await __wait(140)
      setRunLog({ steps: __steps.map((x) => ({ ...x })), ok })
      setSnap((current) => ({
        ...current,
        runs: [...current.runs, run],
      }))

      setView('run')

      if (ok) {
        pushToast({
          tone: 'ok',
          msg: 'Tests passed',
          sub: `${execution?.durationMs ?? 0} ms`,
        })
      } else {
        pushToast({
          tone: 'err',
          msg: 'Tests failed',
          sub: stderr || stdout || 'bun test failed',
        })
      }

      await refresh()
    } catch (error) {
      console.error('[JavaAI] test execution failed:', error)
      if (__steps.length) { __steps[__steps.length - 1].status = 'fail'; __sync() }
      setRunLog({ steps: __steps.map((x) => ({ ...x })), ok: false })

      setSnap((current) => ({
        ...current,
        runs: [
          ...current.runs,
          {
            ok: false,
            durationMs: 0,
            results: [
              {
                name: 'bun test',
                pass: false,
                error: error.message || 'Failed to run tests',
              },
            ],
            logs: [],
            error: error.message || 'Failed to run tests',
          },
        ],
      }))

      setView('run')
      pushToast({
        tone: 'err',
        msg: 'Test execution failed',
        sub: error.message || 'Unknown error',
      })
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  const onReset = async () => {
    await api.reset()
    await refresh()
    setSelectedId(null)
    setActiveFile('calculator.js')
    setView('editor')
    setAgentNote(null)
  }

  const onSelectIntent = (id) => {
    setSelectedId(id)
    setView('diff')
  }

  const diffTitle = selectedIntent
    ? `${selectedIntent.status === 'applied' ? 'Applied' : selectedIntent.status === 'reverted' ? 'Reverted' : 'Proposed'} · ${selectedIntent.title}`
    : 'No intent selected'

  return (
    <div className="app app--workspace">
      {showLanding && <Landing onStart={() => setShowLanding(false)} />}
      <Sidebar
        order={snap.order}
        activeFile={activeFile}
        onOpenFile={(p) => { setActiveFile(p); setView('editor') }}
        intents={snap.intents}
        selectedIntentId={selectedId}
        onSelectIntent={onSelectIntent}
        onReset={onReset}
      />

      <div className="main">
        <TopBar stats={snap.stats} live={false} />
        <AgentBar onRequest={onRequest} busy={planning} note={agentNote} />

        <div className="work">
          {/* Center: editor / diff / run + activity dock */}
          <div className="work__center">
            <FlowBar selectedIntent={selectedIntent} lastRun={lastRun} running={running} />
            <div className="tabs">
              <button className={`tab ${view === 'editor' ? 'is-active' : ''}`} onClick={() => setView('editor')}>
                <FileIcon size={14} /> Editor
              </button>
              <button className={`tab ${view === 'diff' ? 'is-active' : ''}`} onClick={() => setView('diff')}>
                <GraphIcon size={14} /> Diff
                {selectedIntent && <span className="tab__dot" />}
              </button>
              <button className={`tab ${view === 'run' ? 'is-active' : ''}`} onClick={() => setView('run')}>
                <Beaker size={14} /> Results
                {lastRun && (
                  <span className={`tab__badge ${lastRun.ok && lastRun.results.every((r) => r.pass) ? 'ok' : 'fail'}`}>
                    {lastRun.results.filter((r) => r.pass).length}/{lastRun.results.length}
                  </span>
                )}
              </button>
              <div className="tabs__spacer" />
              <button className="btn btn--primary tabs__run" onClick={() => doRun()} aria-busy={running} aria-label="Run test suite">
                {running ? <Spinner size={14} className="run__spin" /> : <Beaker size={14} />}
                {running ? 'Testing…' : 'Test'}
              </button>
            </div>

            <div className="tabbody">
              {view === 'editor' && (
                <div className="editorwrap">
                  <div className="editorwrap__bar">
                    {activeFile.includes('.test.') ? <Beaker size={14} /> : <FileIcon size={14} />}
                    <span>{activeFile}</span>
                    <span className="editorwrap__hint">edits run for real — press Run to execute</span>
                  </div>
                  <CodeEditor path={activeFile} value={snap.files[activeFile]} onChange={onEdit} />
                </div>
              )}

              {view === 'diff' && (
                selectedIntent ? (
                  <div className="diffscroll">
                    <DiffViewer
                      files={diffFiles}
                      title={diffTitle}
                      subtitle={diffFiles.length ? `${diffFiles.length} file${diffFiles.length === 1 ? '' : 's'}` : ''}
                      empty="This intent makes no visible file changes."
                    />
                  </div>
                ) : (
                  <div className="placeholder">
                    <GraphIcon size={26} />
                    <p>Select an intent to see its diff.</p>
                    <span>Ask the agent for a change, then pick its node in the graph on the right.</span>
                  </div>
                )
              )}

              {view === 'run' && <RunPanel run={lastRun} running={running} phase={runPhase} log={runLog} impacted={selectedIntent ? [...new Set((selectedIntent.hunks || []).map((h) => h.path))] : []} preview={selectedIntent ? (selectedIntent.hunks || []).flatMap((h) => (h.after || '').split('\n')).filter((l) => l.length).slice(0, 24) : []} onRevert={selectedIntent && selectedIntent.status === 'applied' ? () => onRevert(selectedIntent) : null} onRun={doRun} />}
            </div>

            <ActivityDock events={snap.events} stats={snap.stats} />
          </div>

          {/* Right: intent graph + inspector */}
          <div className="work__right">
            <div className="rail__head">
              <GraphIcon size={16} style={{ color: 'var(--accent-hi)' }} />
              <span className="rail__title">Semantic Intent Graph</span>
            </div>
            <div className="graphpane">
              <IntentGraph
                graph={snap.graph}
                intents={snap.intents}
                selectedId={selectedId}
                onSelect={onSelectIntent}
                highlight={revertPlan ? new Set(revertPlan.wouldRevert.map((i) => i.id)) : null}
              />
            </div>
            <div className="insppane">
              <IntentInspector
                intent={selectedIntent}
                intents={snap.intents}
                busy={applying || reverting}
                onApply={onApply}
                onDiscard={onDiscard}
                onRevert={onRevert}
                onViewDiff={() => setView('diff')}
              />
            </div>
          </div>
        </div>
      </div>

      {revertPlan && (
        <RevertPlanDialog
          plan={revertPlan}
          busy={reverting}
          onCancel={() => setRevertPlan(null)}
          onConfirm={onConfirmRevert}
        />
      )}

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  )
}
