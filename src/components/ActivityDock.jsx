import { useState } from 'react'

const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const LEVEL_DOT = {
  ok: 'var(--ok)', info: 'var(--info)', amber: 'var(--amber)',
  err: 'var(--del)', muted: 'var(--fg-dim)',
}

function Stream({ events }) {
  const recent = events.slice(-40).reverse()
  if (!recent.length) return <Empty text="Live events from the agent, runs, and reverts show up here as they happen." />
  return (
    <div className="stream">
      {recent.map((e) => (
        <div key={e.id} className="stream__row">
          <span className="stream__dot" style={{ background: LEVEL_DOT[e.level] || 'var(--fg-dim)' }} />
          <span className="stream__title">{e.title}</span>
          <span className="stream__time">{fmtTime(e.at)}</span>
        </div>
      ))}
    </div>
  )
}

function Audit({ events }) {
  const rows = events.slice().reverse()
  if (!rows.length) return <Empty text="The audit log records every apply, approval, run, and revert with a timestamp." />
  return (
    <div className="audit">
      {rows.map((e) => (
        <div key={e.id} className="audit__row">
          <span className="audit__time">{fmtTime(e.at)}</span>
          <span className={`audit__type audit__type--${e.level}`}>{e.type}</span>
          <span className="audit__title">{e.title}{e.detail && <small>{e.detail}</small>}</span>
        </div>
      ))}
    </div>
  )
}

function Stats({ stats }) {
  const cards = [
    { k: 'Proposed', v: stats.proposed },
    { k: 'Applied', v: stats.applied },
    { k: 'Reverted', v: stats.reverted },
    { k: 'High-risk approved', v: stats.highRiskApproved },
    { k: 'Runs', v: stats.runs },
    { k: 'Tests passing', v: `${stats.testsPassing}/${stats.testsTotal}` },
  ]
  return (
    <div className="statsgrid">
      {cards.map((c) => (
        <div key={c.k} className="statcard">
          <div className="statcard__v">{c.v}</div>
          <div className="statcard__k">{c.k}</div>
        </div>
      ))}
    </div>
  )
}

function Empty({ text }) {
  return <div className="dock-empty">{text}</div>
}

export default function ActivityDock({ events, stats }) {
  const [tab, setTab] = useState('stream')
  return (
    <div className="dock">
      <div className="dock__tabs">
        {[['stream', 'Stream'], ['audit', 'Audit'], ['stats', 'Stats']].map(([id, label]) => (
          <button key={id} className={`dock__tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'stream' && events.length > 0 && <span className="dock__count">{events.length}</span>}
          </button>
        ))}
        <span className="dock__live"><span className="dock__livedot" /> live</span>
      </div>
      <div className="dock__body">
        {tab === 'stream' && <Stream events={events} />}
        {tab === 'audit' && <Audit events={events} />}
        {tab === 'stats' && <Stats stats={stats} />}
      </div>
    </div>
  )
}
