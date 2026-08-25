const KIND_TO_TONE = {
  bugfix: 'risk',
  'api-change': 'info',
  validation: 'branch',
  feature: 'ok',
  refactor: 'amber',
}

const RISK_TO_TONE = { low: 'ok', medium: 'amber', high: 'risk' }

const STATUS_TO_TONE = { proposed: 'info', applied: 'ok', reverted: 'muted' }

export function Pill({ tone = 'muted', children, title }) {
  return <span className={`pill pill--${tone}`} title={title}>{children}</span>
}

export function RiskPill({ risk }) {
  return <Pill tone={RISK_TO_TONE[risk] || 'muted'} title={`${risk}-risk change`}>{risk} risk</Pill>
}

export function KindPill({ kind }) {
  return <Pill tone={KIND_TO_TONE[kind] || 'muted'}>{kind}</Pill>
}

export function StatusPill({ status }) {
  const label = status === 'proposed' ? 'proposed' : status === 'applied' ? 'applied' : 'reverted'
  return <Pill tone={STATUS_TO_TONE[status] || 'muted'}>{label}</Pill>
}

export function CountPill({ children, tone = 'ok' }) {
  return <Pill tone={tone}>{children}</Pill>
}
