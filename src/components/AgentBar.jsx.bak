import { useState } from 'react'
import { Sparkles, Send, Spinner } from './icons'
import { AGENT_CHIPS } from '../domain/agent'

const CHIP_PROMPTS = {
  'guard-divide':
    'Guard divide(a, b) against division by zero. Update calculator.js so divide throws an Error with the message "Cannot divide by zero" when b is 0, and add a test covering divide(1, 0).',

  'validate-numbers':
    'Validate numeric inputs across add, subtract, multiply, and divide. Add a shared assertNumbers helper that rejects non-number values and NaN, call it from every operation, and add a test.',

  'add-power':
    'Add a power(base, exponent) function to calculator.js using Math.pow. Export the function and add a test verifying power(2, 5) returns 32.',

  'add-percent':
    'Add a percent(part, whole) function to calculator.js that returns divide(part, whole) multiplied by 100. Export the function and add a test verifying percent(1, 4) returns 25.',

  'add-percent-change':
    'Add a percentChange(from, to) function to calculator.js that calculates percentage change using percent(to - from, from). Export it and add a test verifying percentChange(200, 250) returns 25.',
}

// Where a change starts: the developer describes what they want in plain words,
// or picks a suggested request. Either way the agent replies with a reviewable
// intent — never a silent edit.

export default function AgentBar({ onRequest, busy, note }) {
  const [text, setText] = useState('')

  const submit = (payload) => {
    if (busy) return
    const request =
      typeof payload === 'string'
        ? { text: payload.trim() }
        : payload

    console.log('[JavaAI] AgentBar submit:', request)

    onRequest(request)

    if (typeof payload === 'string') setText('')
  }

  return (
    <div className="agentbar">
      <div className="agentbar__row">
        <span className="agentbar__spark"><Sparkles size={16} /></span>
        <input
          className="agentbar__input"
          placeholder="Ask the agent for a change — e.g. “make divide throw on divide by zero”"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) submit(text.trim()) }}
        />
        <button className="btn btn--primary agentbar__send" disabled={busy || !text.trim()}
                onClick={() => text.trim() && submit(text.trim())}>
          {busy ? <Spinner size={15} className="run__spin" /> : <Send size={15} />}
          Plan it
        </button>
      </div>
      <div className="agentbar__chips">
        <span className="agentbar__chiplabel">Try:</span>
        {AGENT_CHIPS.map((c) => (
          <button key={c.key} className="reqchip" disabled={busy} onClick={() => setText(CHIP_PROMPTS[c.key] || c.label)}>
            {c.label}
          </button>
        ))}
      </div>
      {note && <div className={`agentbar__note agentbar__note--${note.tone}`}>{note.text}</div>}
    </div>
  )
}
