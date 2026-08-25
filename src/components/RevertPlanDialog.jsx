import { useEffect } from 'react'
import { Rollback, Cascade, Warn, X, Spinner, File as FileIcon } from './icons'
import { RiskPill } from './Badge'

// Renders the result of `POST /revert {dry_run:true}`. When the target is
// blocked, the primary action becomes a cascade that reverts the dependents
// first, in the exact order the plan lists.

export default function RevertPlanDialog({ plan, busy, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  const { target, wouldRevert, requiredBy, affectedFiles, blocked } = plan
  const multi = wouldRevert.length > 1

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal__head">
          <span className={`modal__icon ${blocked ? 'modal__icon--danger' : ''}`}>
            {blocked ? <Cascade size={20} /> : <Rollback size={20} />}
          </span>
          <span className="modal__title">Revert “{target.title}”</span>
        </div>

        <div className="modal__body">
          {blocked ? (
            <div className="revert-blocked">
              <div className="revert-blocked__banner">
                <Warn size={16} style={{ flex: 'none', marginTop: 1 }} />
                <span>
                  <b>Blocked.</b> {requiredBy.length} applied intent{requiredBy.length === 1 ? '' : 's'} still
                  require this one, so it can't be reverted on its own. Cascading will revert
                  {requiredBy.length === 1 ? ' it' : ' them'} first.
                </span>
              </div>
              <div className="revert-blocked__req">
                <span className="micro-label">Required by</span>
                <div className="insp__fitems">
                  {requiredBy.map((i) => <span key={i.id} className="chiptag chiptag--risk">{i.title}</span>)}
                </div>
              </div>
            </div>
          ) : (
            <p className="modal__lead">
              This restores the code {target.title.toLowerCase().startsWith('add') ? 'this intent added' : 'this intent changed'}.
              Nothing else is affected — no other applied intent depends on it.
            </p>
          )}

          <div className="revert-plan">
            <span className="micro-label">
              {multi ? `Will revert ${wouldRevert.length} intents, in this order` : 'Will revert'}
            </span>
            <ol className="revert-order">
              {wouldRevert.map((i, idx) => (
                <li key={i.id} className={i.id === target.id ? 'is-target' : ''}>
                  <span className="revert-order__n">{idx + 1}</span>
                  <span className="revert-order__title">{i.title}</span>
                  {i.id === target.id && <span className="revert-order__tag">target</span>}
                  <span style={{ marginLeft: 'auto' }}><RiskPill risk={i.risk} /></span>
                </li>
              ))}
            </ol>
          </div>

          <div className="revert-files">
            <span className="micro-label">Affected files</span>
            <div className="revert-files__list">
              {affectedFiles.map((f) => (
                <span key={f} className="revert-files__f"><FileIcon size={13} /> {f}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            <X size={15} /> Cancel
          </button>
          {blocked ? (
            <button className="btn btn--danger" onClick={() => onConfirm(true)} disabled={busy}>
              {busy ? <Spinner size={15} className="run__spin" /> : <Cascade size={15} />}
              Cascade revert {wouldRevert.length}
            </button>
          ) : (
            <button className="btn btn--amber" onClick={() => onConfirm(false)} disabled={busy}>
              {busy ? <Spinner size={15} className="run__spin" /> : <Rollback size={15} />}
              Revert
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
