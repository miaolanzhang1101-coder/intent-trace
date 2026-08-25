import { useState, useEffect } from 'react'
import { Check, X, Warn, Spinner, Beaker, Rollback } from './icons'

function PhaseList({ steps, running }) {
  if (!steps || !steps.length) {
    if (!running) return null
    return (
      <div className="phases">
        <div className="phase is-active">
          <span className="phase__mark"><Spinner size={13} className="run__spin" /></span>
          <span className="phase__text">Starting…</span>
        </div>
      </div>
    )
  }
  return (
    <div className={`phases ${running ? '' : 'phases--done'}`}>
      {steps.map((st, i) => (
        <div key={i} className={`phase is-${st.status}`}>
          <span className="phase__mark">
            {st.status === 'done' ? <Check size={13} /> : st.status === 'fail' ? <X size={13} /> : <Spinner size={13} className="run__spin" />}
          </span>
          <span className="phase__text">{st.label}</span>
        </div>
      ))}
    </div>
  )
}

function Typewriter({ lines, active }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active || !lines.length) { setN(0); return }
    setN(0)
    let i = 0
    const id = setInterval(() => { i += 1; setN(i); if (i >= lines.length) clearInterval(id) }, 85)
    return () => clearInterval(id)
  }, [active, lines])
  if (!lines.length || !active) return null
  const shown = lines.slice(0, n)
  return (
    <div className="typewrap">
      <div className="typewrap__label">Writing code…</div>
      <pre className="typewriter">
        {shown.map((l, idx) => <div key={idx} className="typewriter__line">{l || '\u00A0'}</div>)}
        {n < lines.length && <span className="typewriter__cursor">▍</span>}
      </pre>
    </div>
  )
}

function explainFailure(run) {
  const text = (run && (run.error || '')) + '\n' + (((run && run.results) || []).map((r) => r.error).filter(Boolean).join('\n'))
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const failLine = lines.find((l) => /\(fail\)|expect|error|throw|not a function|undefined/i.test(l))
  return failLine || (lines[0] || 'A test failed. See the output below.')
}

export default function RunPanel({ run, running, phase, log, onRevert, preview }) {
  const results = (run && run.results) || []
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = run && run.ok && passed === total && total > 0

  // While running: show the live phases. After: show the PERSISTED log (survives a second run).
  const liveSteps = (phase && phase.steps) || []
  const doneSteps = (log && log.steps) || []
  const shownSteps = running ? liveSteps : (doneSteps.length ? doneSteps : liveSteps)
  const hasSteps = shownSteps.length > 0

  if (!running && !run && !hasSteps) {
    return (
      <div className="runpanel">
        <div className="runpanel__empty">
          <Beaker size={22} />
          <p>Press <b>Test</b> to run the suite.</p>
          <span>Runs for real in a sandboxed worker — the output is the genuine result.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="runpanel">
      <div className="runpanel__body">
        {(hasSteps || running) && <PhaseList steps={shownSteps} running={running} />}
        <Typewriter lines={preview || []} active={running} />

        {!running && run && (
          <>
            <div className={`runpanel__summary ${allPass ? 'ok' : 'fail'}`}>
              {allPass ? <Check size={15} /> : <Warn size={15} />}
              <span>{allPass ? 'All tests passing' : 'Tests failing'}</span>
              <span className="runpanel__dur">{run.durationMs} ms</span>
              {onRevert && (
                <button className="btn btn--amber runpanel__revert" onClick={onRevert}>
                  <Rollback size={14} /> Revert this change
                </button>
              )}
            </div>

            {!allPass && (
              <div className="failbox">
                <div className="failbox__head"><Warn size={14} /> What went wrong</div>
                <div className="failbox__why">{explainFailure(run)}</div>
                <div className="failbox__hint">A recommended fix has been proposed — check the diff on the right, then Apply &amp; Run.</div>
              </div>
            )}

            {results.length > 0 && (
              <ul className="runlist">
                {results.map((r, i) => (
                  <li key={i} className={`runrow runrow--${r.pass ? 'pass' : 'fail'}`}>
                    <span className="runrow__icon">{r.pass ? <Check size={14} /> : <X size={14} />}</span>
                    <span className="runrow__name">{r.name}</span>
                    {typeof r.ms === 'number' && <span className="runrow__ms">{r.ms} ms</span>}
                    {!r.pass && r.error && <div className="runrow__err">{r.error}</div>}
                  </li>
                ))}
              </ul>
            )}

            {run.logs && run.logs.length > 0 && (
              <div className="console">
                <div className="console__label">Console output</div>
                {run.logs.map((l, i) => (
                  <div key={i} className={`console__line console__line--${l.level}`}>{l.text}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
