import { Graph as GraphIcon } from './icons'

// The Semantic Intent Graph — what `GET /intents/graph` returns, drawn as a
// left-to-right DAG. The UI is intentionally defensive because the backend
// can legitimately return an empty or partially populated graph.

const NODE_W = 176
const NODE_H = 64
const COL_GAP = 210
const ROW_GAP = 82
const PAD = 18

const RISK_VAR = {
  low: 'var(--ok)',
  medium: 'var(--amber)',
  high: 'var(--risk)',
}

export default function IntentGraph({
  graph,
  intents,
  selectedId,
  onSelect,
}) {
  const safeIntents = Array.isArray(intents) ? intents : []

  const safeGraph = {
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
    columnCount:
      Number.isFinite(graph?.columnCount) && graph.columnCount > 0
        ? graph.columnCount
        : 1,
    rowCount:
      Number.isFinite(graph?.rowCount) && graph.rowCount > 0
        ? graph.rowCount
        : 1,
  }

  // The backend may briefly return intents without graph nodes, or graph
  // nodes without their corresponding intent. Filter those out instead of
  // allowing one malformed item to crash the entire application.
  const validNodes = safeGraph.nodes.filter(
    (node) => node && node.intent && node.intent.id
  )

  if (!safeIntents.length || !validNodes.length) {
    return (
      <div className="graph-empty">
        <GraphIcon size={26} />
        <p>No intents yet.</p>
        <span>
          Ask the agent for a change and it appears here as a node you can
          inspect, approve, and revert.
        </span>
      </div>
    )
  }

  const pos = new Map()

  for (const node of validNodes) {
    const col = Number.isFinite(node.col) ? node.col : 0
    const row = Number.isFinite(node.row) ? node.row : 0

    pos.set(node.intent.id, {
      x: PAD + col * COL_GAP,
      y: PAD + row * ROW_GAP,
      intent: node.intent,
    })
  }

  const width =
    PAD * 2 +
    Math.max(0, safeGraph.columnCount - 1) * COL_GAP +
    NODE_W

  const height =
    PAD * 2 +
    Math.max(0, safeGraph.rowCount - 1) * ROW_GAP +
    NODE_H

  return (
    <div className="graph-scroll">
      <svg
        className="graph-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="var(--line)" />
          </marker>
        </defs>

        {safeGraph.edges.map((edge, i) => {
          if (!edge) return null

          const a = pos.get(edge.from)
          const b = pos.get(edge.to)

          // Ignore edges whose endpoints aren't currently represented.
          if (!a || !b || !a.intent || !b.intent) return null

          const x1 = a.x + NODE_W
          const y1 = a.y + NODE_H / 2
          const x2 = b.x
          const y2 = b.y + NODE_H / 2
          const mx = (x1 + x2) / 2

          const dim =
            a.intent.status === 'reverted' ||
            b.intent.status === 'reverted'

          return (
            <path
              key={`${edge.from}-${edge.to}-${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={dim ? 'var(--line-soft)' : 'var(--line)'}
              strokeWidth="1.6"
              markerEnd="url(#arrow)"
            />
          )
        })}

        {[...pos.values()].map(({ x, y, intent }) => {
          if (!intent || !intent.id) return null

          const sel = intent.id === selectedId
          const riskColor =
            RISK_VAR[intent.risk] || RISK_VAR.low

          return (
            <foreignObject
              key={intent.id}
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
            >
              <button
                className={`gnode gnode--${intent.status || 'proposed'} ${
                  sel ? 'is-sel' : ''
                }`}
                style={{ '--risk-color': riskColor }}
                onClick={() => onSelect?.(intent.id)}
                title={intent.title || 'Untitled intent'}
              >
                <span className="gnode__bar" />

                <span className="gnode__body">
                  <span className="gnode__top">
                    <span className="gnode__kind">
                      {intent.kind || 'change'}
                    </span>

                    <span className="gnode__status">
                      {intent.status || 'unknown'}
                    </span>
                  </span>

                  <span className="gnode__title">
                    {intent.title || 'Untitled intent'}
                  </span>
                </span>
              </button>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}
