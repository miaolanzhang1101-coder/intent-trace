import { useRef, useMemo } from 'react'

// A real, editable code editor with no dependencies: a transparent <textarea>
// sits over a syntax-highlighted <pre>, sharing the same metrics so the caret
// lines up. Tab inserts two spaces. This is the surface for "write code".

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const wrap = (cls, t) => `<span class="${cls}">${esc(t)}</span>`

const KW = /^(const|let|var|require|function|return|import|export|from|new|await|async|if|else|for|of|in|while|throw|typeof|class|module|true|false|null|undefined)\b/

function highlightLine(text) {
  const trimmed = text.trimStart()
  if (/^(\/\/|\/\*|\*|#)/.test(trimmed)) return wrap('tok-com', text)
  let i = 0, out = ''
  while (i < text.length) {
    const rest = text.slice(i)
    const atWordStart = i === 0 || /\W/.test(text[i - 1])
    let m
    if ((m = rest.match(/^("[^"]*"|'[^']*'|`[^`]*`)/))) { out += wrap('tok-str', m[0]); i += m[0].length; continue }
    if (atWordStart && (m = rest.match(KW))) { out += wrap('tok-kw', m[1]); i += m[1].length; continue }
    if (atWordStart && (m = rest.match(/^\d[\d.]*/))) { out += wrap('tok-num', m[0]); i += m[0].length; continue }
    if ((m = rest.match(/^[A-Za-z_$][\w$]*(?=\s*\()/))) { out += wrap('tok-fn', m[0]); i += m[0].length; continue }
    out += esc(text[i]); i++
  }
  return out
}

export default function CodeEditor({ path, value, onChange, readOnly }) {
  const taRef = useRef(null)
  const preRef = useRef(null)
  const gutterRef = useRef(null)

  const safeValue = value ?? ''
  const lines = useMemo(() => safeValue.split('\n'), [safeValue])
  const html = useMemo(
    () => lines.map((l) => highlightLine(l) || '&nbsp;').join('\n'),
    [lines],
  )

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.target
      const s = el.selectionStart, en = el.selectionEnd
      const next = safeValue.slice(0, s) + '  ' + safeValue.slice(en)
      onChange(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
    }
  }

  return (
    <div className="editor">
      <div className="editor__gutter" ref={gutterRef} aria-hidden>
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="editor__surface">
        <pre className="editor__pre" ref={preRef} aria-hidden
             dangerouslySetInnerHTML={{ __html: html }} />
        <textarea
          ref={taRef}
          className="editor__ta"
          value={safeValue}
          spellCheck={false}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          wrap="off"
        />
      </div>
    </div>
  )
}
