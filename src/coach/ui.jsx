export function PageHeader({ crumb, title, children }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
      <div>
        <div className="sa-crumb">Coaching / {crumb}</div>
        <h1 className="sa-title">{title}</h1>
      </div>
      <div className="d-flex gap-2 align-items-center">{children}</div>
    </div>
  )
}

export function Stat({ label, value, note, noteClass = '', icon }) {
  return (
    <div className="sa-card sa-stat">
      <div className="sa-stat-label">{label}</div>
      <div className="sa-stat-value">{value}</div>
      <div className={`sa-stat-note ${noteClass}`}>
        {icon && <i className={`bi ${icon} me-1`} />}
        {note}
      </div>
    </div>
  )
}

export function StatRow({ items }) {
  return (
    <div className="row g-3 mb-3">
      {items.map((s) => (
        <div className="col-6 col-xl-3" key={s.label}>
          <Stat {...s} />
        </div>
      ))}
    </div>
  )
}

export function Badge({ color = 'green', dot, children }) {
  return (
    <span className={`sa-badge ${color}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

export function Avatar({ ini, small }) {
  return <span className={`sa-avatar${small ? ' sm' : ''}`}>{ini}</span>
}
