import { Folder } from './icons'

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const wrap = (cls, t) => `<span class="${cls}">${esc(t)}</span>`

const KW = /^(const|require|function|return|import|export|new|await|async|public|private|protected|class|package|void|static|final|extends|implements)\b/

// Single-pass tokenizer: escapes each token as it is emitted and never
// re-scans inserted markup, so keywords like `class` can't corrupt the
// class="…" attributes we output.
function highlight(text) {
  const trimmed = text.trimStart()
  if (/^(\/\/|\/\*|\*|#)/.test(trimmed)) return wrap('tok-com', text)

  let i = 0, out = ''
  while (i < text.length) {
    const rest = text.slice(i)
    const atWordStart = i === 0 || /\W/.test(text[i - 1])
    let m

    if ((m = rest.match(/^("[^"]*"|'[^']*')/))) { out += wrap('tok-str', m[0]); i += m[0].length; continue }
    if ((m = rest.match(/^(<\/?)([A-Za-z][\w.-]*)/))) { out += esc(m[1]) + wrap('tok-tag', m[2]); i += m[0].length; continue }
    if (atWordStart && (m = rest.match(KW))) { out += wrap('tok-kw', m[1]); i += m[1].length; continue }
    if (atWordStart && (m = rest.match(/^\d[\d.]*/))) { out += wrap('tok-num', m[0]); i += m[0].length; continue }

    out += esc(text[i]); i++
  }
  return out
}

function Row({ r }) {
  if (r.type === 'collapse') {
    return <div className="row row--collapse">⋯ {r.count} unchanged {r.count === 1 ? 'line' : 'lines'}</div>
  }
  const cls = r.type === 'add' ? 'row row--add' : r.type === 'del' ? 'row row--del' : 'row'
  const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '
  return (
    <div className={cls}>
      <div className="row__gutter">{r.oldNo ?? ''}</div>
      <div className="row__gutter">{r.newNo ?? ''}</div>
      <div className="row__code">
        <span className="sign">{sign}</span>
        <span dangerouslySetInnerHTML={{ __html: highlight(r.text || '') }} />
      </div>
    </div>
  )
}

function FileDiff({ file }) {
  const parts = file.path.split('/')
  const name = parts.pop()
  const dir = parts.join('/')
  return (
    <div className="diff">
      <div className="diff__filebar">
        <Folder className="diff__folder" size={15} />
        {dir && <span style={{ color: 'var(--fg-dim)' }}>{dir}/</span>}
        <span style={{ color: 'var(--fg)' }}>{name}</span>
        <span className="diffhead__stat" style={{ marginLeft: 'auto' }}>
          <span className="add">+{file.stat.add}</span>{' '}
          <span className="del">−{file.stat.del}</span>
        </span>
      </div>
      {file.rows.map((r, i) => <Row key={i} r={r} />)}
    </div>
  )
}

export default function DiffViewer({ files, title, subtitle, empty }) {
  return (
    <div className="diffwrap">
      <div className="diffhead">
        <span className="diffhead__file">{title}</span>
        {subtitle && <span className="diffhead__stat">{subtitle}</span>}
      </div>
      {files.length === 0 ? (
        <div style={{ color: 'var(--fg-dim)', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>
          {empty || 'No changes between these two checkpoints.'}
        </div>
      ) : (
        files.map((f) => <FileDiff key={f.path} file={f} />)
      )}
    </div>
  )
}
