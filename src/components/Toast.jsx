import { useEffect } from 'react'
import { Check, Info, Warn, X } from './icons'

const ICON = { ok: Check, info: Info, err: Warn }

function Toast({ t, onClose }) {
  useEffect(() => {
    const id = setTimeout(() => onClose(t.id), t.ttl ?? 4200)
    return () => clearTimeout(id)
  }, [t, onClose])
  const Icon = ICON[t.tone] || Info
  return (
    <div className={`toast toast--${t.tone}`}>
      <span className="toast__icon"><Icon size={18} /></span>
      <span className="toast__msg">{t.msg}{t.sub && <small>{t.sub}</small>}</span>
      <button className="toast__x" onClick={() => onClose(t.id)}><X size={15} /></button>
    </div>
  )
}

export default function ToastStack({ toasts, onClose }) {
  return (
    <div className="toasts">
      {toasts.map((t) => <Toast key={t.id} t={t} onClose={onClose} />)}
    </div>
  )
}
