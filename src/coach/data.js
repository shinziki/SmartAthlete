export const team = { name: "Men's Basketball", athletes: 12, season: 'Midyear 2026' }

export const weeklyLoad = [
  { day: 'Mon', au: 360 }, { day: 'Tue', au: 465 }, { day: 'Wed', au: 290 },
  { day: 'Thu', au: 540 }, { day: 'Fri', au: 210 }, { day: 'Sat', au: 430 },
]

export const readiness = [
  { label: 'Ready', count: 7, color: '#10a37f' },
  { label: 'Moderate', count: 3, color: '#f5a623' },
  { label: 'Watch — high load', count: 2, color: '#dc3545' },
]

export const athletes = [
  { name: 'Miguelito Bacho', short: 'M. Bacho', ini: 'MB', pos: 'Guard', no: 7, age: 20, consent: 'Signed', device: 'Watch #1', sessions: 5, load: 612, acute: 612, chronic: 431, acwr: 1.42, trend: 'rising', readiness: 'Watch', focus: 'Reduce volume' },
  { name: 'Sherwin Osma', short: 'S. Osma', ini: 'SO', pos: 'Forward', no: 11, age: 19, consent: 'Signed', device: 'Watch #2', sessions: 5, load: 548, acute: 548, chronic: 418, acwr: 1.31, trend: 'rising', readiness: 'Watch', focus: 'Reduce volume' },
  { name: 'Junmark Rosos', short: 'J. Rosos', ini: 'JR', pos: 'Center', no: 15, age: 21, consent: 'Signed', device: 'Watch #3', sessions: 4, load: 402, acute: 402, chronic: 383, acwr: 1.05, trend: 'steady', readiness: 'Moderate', focus: 'Normal progression' },
  { name: 'Aljon Lozada', short: 'A. Lozada', ini: 'AL', pos: 'Guard', no: 4, age: 17, consent: 'Signed + Parental', device: 'Rotation', sessions: 5, load: 388, acute: 388, chronic: 413, acwr: 0.94, trend: 'steady', readiness: 'Ready', focus: 'Normal progression' },
  { name: 'Rey Villamor', short: 'R. Villamor', ini: 'RV', pos: 'Forward', no: 9, age: 16, consent: 'Signed + Parental', device: 'Rotation', sessions: 4, load: 355, acute: 355, chronic: 403, acwr: 0.88, trend: 'steady', readiness: 'Ready', focus: 'Normal progression' },
  { name: 'Kenneth Dela Cruz', short: 'K. Dela Cruz', ini: 'KD', pos: 'Guard', no: 2, age: 17, consent: 'Signed + Parental', device: 'Rotation', sessions: 4, load: 341, acute: 341, chronic: 411, acwr: 0.83, trend: 'steady', readiness: 'Ready', focus: 'Normal progression' },
]

export const acwrTeam = [
  { k: 'MB', v: 1.42 }, { k: 'SO', v: 1.31 }, { k: 'JR', v: 1.05 }, { k: 'AL', v: 0.94 },
  { k: 'RV', v: 0.88 }, { k: 'KD', v: 0.83 }, { k: 'JT', v: 0.91 }, { k: 'NP', v: 0.79 },
]

export const sessions = [
  { date: 'Jul 24', name: 'Strength & Conditioning — Plyometrics', type: 'S&C', venue: 'EVSU Gymnasium', time: '4:00–6:00 PM', attendance: '—', status: 'Upcoming' },
  { date: 'Jul 22', name: 'Full-court transition drills', type: 'Training', venue: 'EVSU Gymnasium', time: '4:00–6:00 PM', attendance: '12/12', status: 'Completed' },
  { date: 'Jul 21', name: 'Half-court sets & shooting', type: 'Training', venue: 'EVSU Gymnasium', time: '4:00–6:00 PM', attendance: '11/12', status: 'Completed' },
  { date: 'Jul 19', name: 'Scrimmage vs. Alumni', type: 'Scrimmage', venue: 'EVSU Gymnasium', time: '3:00–5:00 PM', attendance: '12/12', status: 'Completed' },
  { date: 'Jul 18', name: 'Conditioning — intervals', type: 'S&C', venue: 'EVSU Gymnasium', time: '4:00–6:00 PM', attendance: '10/12', status: 'Completed' },
]

export const attendance = [
  { name: 'M. Bacho', ini: 'MB', time: '3:47 PM', method: 'Geofence', loc: 'Inside · ±5 m', status: 'Present', remark: '—' },
  { name: 'S. Osma', ini: 'SO', time: '3:51 PM', method: 'Geofence', loc: 'Inside · ±7 m', status: 'Present', remark: '—' },
  { name: 'J. Rosos', ini: 'JR', time: '4:18 PM', method: 'Geofence', loc: 'Inside · ±6 m', status: 'Late', remark: 'Class dismissal overlap' },
  { name: 'A. Lozada', ini: 'AL', time: '3:55 PM', method: 'Manual', loc: '—', status: 'Present', remark: 'Phone battery drained; coach verified on site' },
  { name: 'R. Villamor', ini: 'RV', time: '3:49 PM', method: 'Geofence', loc: 'Inside · ±4 m', status: 'Present', remark: '—' },
]

export const readinessBadge = { Watch: 'red', Moderate: 'amber', Ready: 'green' }
