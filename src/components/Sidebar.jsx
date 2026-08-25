import { File as FileIcon, Reset, Beaker } from './icons'

const STATUS_COLOR = {
  proposed: 'var(--info)',
  applied: 'var(--ok)',
  reverted: 'var(--fg-dim)',
}

function FileRow({ path, active, onOpen }) {
  const isTest = path.includes('.test.')
  return (
    <button className={`filerow ${active ? 'active' : ''}`} onClick={() => onOpen(path)}>
      {isTest ? <Beaker size={14} /> : <FileIcon size={14} />}
      <span className="filerow__name">{path}</span>
    </button>
  )
}

export default function Sidebar({
  order, activeFile, onOpenFile,
  intents, selectedIntentId, onSelectIntent, onReset,
}) {
  const history = intents.slice().reverse()
  return (
    <aside className="side">
      <div className="side__brand">
        <span className="side__logo">JA</span>
        <span className="side__name">JavaAI</span>
        <span className="side__tag">workspace</span>
      </div>

      <div className="side__scroll">
        <div className="side__group-label">Files</div>
        {order.map((p) => (
          <FileRow key={p} path={p} active={p === activeFile} onOpen={onOpenFile} />
        ))}

        <div className="side__group-label">Intents</div>
        {history.length === 0 ? (
          <div className="side__hint">Changes the agent proposes will collect here.</div>
        ) : (
          history.map((i) => (
            <button
              key={i.id}
              className={`intentrow ${i.id === selectedIntentId ? 'active' : ''} intentrow--${i.status}`}
              onClick={() => onSelectIntent(i.id)}
            >
              <span className="intentrow__dot" style={{ background: STATUS_COLOR[i.status] }} />
              <span className="intentrow__title">{i.title}</span>
            </button>
          ))
        )}
      </div>

      <button className="side__reset" onClick={onReset}>
        <Reset size={15} /> Reset workspace
      </button>
    </aside>
  )
}
