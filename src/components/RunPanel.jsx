import { Play, Check, X, Warn, Spinner, Beaker } from './icons'

export default function RunPanel({ run, running, onRun }) {
  const passed = run ? run.results.filter((r) => r.pass).length : 0
  const total = run ? run.results.length : 0
  const allPass = run && run.ok && passed === total && total > 0

  return (
    <div className="runpanel">
      <div className="runpanel__bar">
        <button className="btn btn--primary" onClick={onRun} disabled={running}>
          {running ? <Spinner size={15} className="run__spin" /> : <Play size={15} />}
          {running ? 'Running…' : 'Run tests'}
        </button>
        {run && (
          <div className={`runpanel__summary ${allPass ? 'ok' : 'fail'}`}>
            {allPass ? <Check size={15} /> : <Warn size={15} />}
            <span>{passed}/{total} passing</span>
            <span className="runpanel__dur">{run.durationMs} ms</span>
          </div>
        )}
      </div>

      {!run && !running && (
        <div className="runpanel__empty">
          <Beaker size={24} />
          <p>Run the suite to see real results.</p>
          <span>Your code executes in a sandboxed worker — output below is the genuine result, not a preview.</span>
        </div>
      )}

      {run && (
        <div className="runpanel__body">
          {run.error && (
            <div className="runpanel__toperr">
              <Warn size={15} /> <span>{run.error}</span>
            </div>
          )}

          {run.results.length > 0 && (
            <ul className="runlist">
              {run.results.map((r, i) => (
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
              <div className="console__label">Console</div>
              {run.logs.map((l, i) => (
                <div key={i} className={`console__line console__line--${l.level}`}>{l.text}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
