export default function TopBar({ stats, live }) {
  return (
    <header className="topbar">
      <span className="topbar__title">Intent Trace</span>
      <span className="topbar__crumb">/ safe agent changes with rollback</span>
      <span className={`pill pill--${live ? 'ok' : 'branch'}`} style={{ marginLeft: 4 }}>
        {live ? 'Live backend' : 'Local engine'}
      </span>
      <div className="topbar__spacer" />
      <div className="topstat"><b>{stats.applied}</b> applied</div>
      <div className="topstat"><b>{stats.reverted}</b> reverted</div>
      <div className="topstat">
        tests <b className={stats.testsTotal && stats.testsPassing === stats.testsTotal ? 'good' : ''}>
          {stats.testsPassing}/{stats.testsTotal}
        </b>
      </div>
    </header>
  )
}
