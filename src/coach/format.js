/** Small display helpers shared by the Sessions list and the session detail view. */

export const niceDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const longDate = (s) =>
  new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
/** Session start/end times are stored as text; some have a mangled narrow space ("3:00?PM"). */
export const cleanTime = (t) => (t || '—').replace(/\?/g, ' ')

export const typeBadge = { training: 'blue', conditioning: 'blue', strength: 'blue', scrimmage: 'teal' }
export const statusBadge = { Upcoming: 'amber', Completed: 'green' }
const TYPE_LABELS = { sc: 'S&C', at_home: 'At home' }
export const typeLabel = (t) => (t ? TYPE_LABELS[t] || t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '—')
