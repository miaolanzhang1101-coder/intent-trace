import { Sparkles, Graph as GraphIcon, Beaker, Rollback } from './icons'

export default function Landing({ onStart }) {
  return (
    <div className="landing">
      <div className="landing__inner">
        <div className="landing__logo"><span className="landing__logomark">JA</span> JavaAI</div>
        <h1 className="landing__title">Supervise AI code changes</h1>

        <div className="landing__steps">
          <div className="landing__step"><span className="landing__stepicon"><Sparkles size={16} /></span><b>Propose</b><span>Ask in plain English; get a reviewable intent.</span></div>
          <div className="landing__step"><span className="landing__stepicon"><GraphIcon size={16} /></span><b>Inspect</b><span>See the diff, impact, and the intent graph.</span></div>
          <div className="landing__step"><span className="landing__stepicon"><Beaker size={16} /></span><b>Run</b><span>Tests execute for real in a sandbox.</span></div>
          <div className="landing__step"><span className="landing__stepicon"><Rollback size={16} /></span><b>Revert</b><span>Undo any step — cascades when needed.</span></div>
        </div>

        <button className="btn btn--primary landing__cta" onClick={onStart}>
          <Sparkles size={16} /> Start the demo
        </button>
        <div className="landing__hint">Starts with a real example: guarding divide against divide-by-zero.</div>
      </div>
    </div>
  )
}
