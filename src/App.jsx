import { useEffect, useMemo, useState, useCallback } from 'react'
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
import ActivityDock from './components/ActivityDock'
import ToastStack from './components/Toast'
import { Graph as GraphIcon, File as FileIcon, Beaker, Play, Spinner } from './components/icons'

let toastSeq = 0

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
  }, [refresh])

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

  /* ---------- apply ---------- */
  const onApply = async (intent, approve) => {
    setApplying(true)
    try {
      await api.apply(intent.id, { approve })
      await refresh()
      pushToast({ tone: 'ok', msg: `Applied “${intent.title}”`, sub: 'Change written to the working tree' })
      setView('run')
      await doRun()
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
      await doRun()
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
  const doRun = async () => {
    setRunning(true)
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
            <div className="tabs">
              <button className={`tab ${view === 'editor' ? 'is-active' : ''}`} onClick={() => setView('editor')}>
                <FileIcon size={14} /> Editor
              </button>
              <button className={`tab ${view === 'diff' ? 'is-active' : ''}`} onClick={() => setView('diff')}>
                <GraphIcon size={14} /> Diff
                {selectedIntent && <span className="tab__dot" />}
              </button>
              <button className={`tab ${view === 'run' ? 'is-active' : ''}`} onClick={() => setView('run')}>
                <Beaker size={14} /> Run
                {lastRun && (
                  <span className={`tab__badge ${lastRun.ok && lastRun.results.every((r) => r.pass) ? 'ok' : 'fail'}`}>
                    {lastRun.results.filter((r) => r.pass).length}/{lastRun.results.length}
                  </span>
                )}
              </button>
              <div className="tabs__spacer" />
              <button className="btn btn--primary tabs__run" onClick={doRun} disabled={running}>
                {running ? <Spinner size={14} className="run__spin" /> : <Play size={14} />}
                Run
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

              {view === 'run' && <RunPanel run={lastRun} running={running} onRun={doRun} />}
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
