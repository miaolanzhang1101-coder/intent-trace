import { useState, useEffect } from 'react'
import { RiskPill, KindPill, StatusPill } from './Badge'
import { Cube, Api, Beaker, Dep, Shield, Rollback, Play, Spinner, X } from './icons'

function Field({ icon: Icon, label, items, tone }) {
  if (!items || !items.length) return null
  return (
    <div className="insp__field">
      <div className="insp__flabel"><Icon size={13} /> {label}</div>
      <div className="insp__fitems">
        {items.map((t, i) => <span key={i} className={`chiptag chiptag--${tone || 'muted'}`}>{t}</span>)}
      </div>
    </div>
  )
}

export default function IntentInspector({ intent, intents, busy, onApply, onDiscard, onRevert, onViewDiff }) {
  const [approve, setApprove] = useState(false)
  useEffect(() => setApprove(false), [intent?.id])

  if (!intent) {
    return (
      <div className="insp insp--empty">
        <p>Select an intent in the graph to see what the agent plans to do, why, and what it touches.</p>
      </div>
    )
  }

  const byId = new Map(intents.map((i) => [i.id, i]))
  const deps = (intent.dependsOn || []).map((d) => byId.get(d)?.title).filter(Boolean)
  const highRisk = intent.risk === 'high'
  const isProposed = intent.status === 'proposed'
  const isApplied = intent.status === 'applied'

  return (
    <div className="insp">
      <div className="insp__head">
        <div className="insp__title">{intent.title}</div>
        <div className="insp__pills">
          <StatusPill status={intent.status} />
          <KindPill kind={intent.kind} />
          <RiskPill risk={intent.risk} />
        </div>
      </div>

      <p className="insp__summary">{intent.summary}</p>

      <div className="insp__rationale">
        <div className="insp__flabel">Why</div>
        <p>{intent.rationale}</p>
      </div>

      <Field icon={Cube} label="Modules" items={intent.affects?.modules} tone="branch" />
      <Field icon={Api} label="APIs" items={intent.affects?.apis} tone="info" />
      <Field icon={Beaker} label="Tests" items={intent.affects?.tests} tone="ok" />
      <Field icon={Dep} label="Code dependencies" items={intent.affects?.dependencies} tone="muted" />
      <Field icon={Dep} label="Requires intent" items={deps} tone="amber" />

      <button className="insp__difflink" onClick={onViewDiff}>View the code diff →</button>

      {isProposed && (
        <div className="insp__actions">
          {highRisk && (
            <label className={`approve ${approve ? 'is-on' : ''}`}>
              <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
              <Shield size={15} />
              <span>I approve this high-risk change (<code>approve=true</code>)</span>
            </label>
          )}
          <div className="insp__btnrow">
            <button className="btn btn--ghost" onClick={onDiscard} disabled={busy}>
              <X size={14} /> Discard
            </button>
            <button
              className="btn btn--primary"
              disabled={busy || (highRisk && !approve)}
              onClick={() => onApply(intent, approve)}
            >
              {busy ? <Spinner size={15} className="run__spin" /> : <Play size={15} />}
              {highRisk ? 'Approve & Run' : 'Apply & Run'}
            </button>
          </div>
          {highRisk && !approve && (
            <div className="insp__hint">High-risk changes can't be applied until you approve them.</div>
          )}
        </div>
      )}

      {isApplied && (
        <div className="insp__actions">
          <button className="btn btn--amber insp__revert" onClick={() => onRevert(intent)} disabled={busy}>
            <Rollback size={15} /> Revert this intent
          </button>
          <div className="insp__hint">Runs a dry-run first, so you'll see the full impact — and any blockers — before anything changes.</div>
        </div>
      )}

      {intent.status === 'reverted' && (
        <div className="insp__reverted">This intent was reverted. Its edits are no longer in the working tree.</div>
      )}
    </div>
  )
}
