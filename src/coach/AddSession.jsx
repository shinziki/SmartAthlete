import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../supabaseClient'
import { maskName } from '../privacy'
import { PageHeader } from './ui'
import {
  CATEGORY_CONFIG, DRILL_CATEGORIES, SENSORS, TRACKS, WORKOUT_SUGGESTIONS,
  drillCountUnit, drillHasSetsReps, drillTargetTotal, searchWorkouts,
} from './drillPlan'

/**
 * Add session: the web version of the mobile app's coach "Add session" screen
 * (Mobile/app/coach/add-session.tsx). It writes the same tbl_sessions row, so the
 * athletes' phones and watches treat it exactly like a session made on the phone
 * (the database sends the "new session" push: supabase_push_notifications.sql).
 */

// Ormoc City, Leyte: where the map starts when the browser can't give a location
const DEFAULT_COORDS = { latitude: 11.0044, longitude: 124.6075 }
const DEFAULT_TARGET = { sets: 3, reps: 10, restSeconds: 60 }
const NOMINATIM = 'https://nominatim.openstreetmap.org'

// ─── Helpers ──────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** "16:05" (time input) → minutes after midnight, or null. */
const toMinutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
/** Minutes after midnight → "4:05 PM", the format the apps store (plain space). */
const toDbTime = (mins) => {
  if (mins == null) return 'TBD'
  const h = Math.floor(mins / 60) % 24
  return `${h % 12 || 12}:${pad(mins % 60)} ${h < 12 ? 'AM' : 'PM'}`
}
const maskFullName = (v) => (v ?? '').trim().split(/\s+/).filter(Boolean).map(maskName).join(' ')
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function geocodePlace(query) {
  const q = query.trim()
  if (q.length < 3) return null
  try {
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } })
    const hit = res.ok ? (await res.json())[0] : null
    const latitude = parseFloat(hit?.lat), longitude = parseFloat(hit?.lon)
    return Number.isNaN(latitude) || Number.isNaN(longitude) ? null : { latitude, longitude }
  } catch { return null }
}

async function reverseGeocode({ latitude, longitude }) {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${latitude}&lon=${longitude}`, { headers: { 'Accept-Language': 'en' } })
    const data = res.ok ? await res.json() : null
    if (!data || data.error) return null
    const a = data.address ?? {}
    const name = data.name || a.amenity || a.leisure || a.building || a.road || a.neighbourhood || a.suburb || a.village || a.city
    if (name) {
      const area = a.city || a.town || a.municipality || a.village
      return area && area !== name ? `${name}, ${area}` : name
    }
    return data.display_name ? data.display_name.split(',').slice(0, 2).join(',').trim() : null
  } catch { return null }
}

/** The signed-in coach's tbl_coaches id (looked up by the login's email hash, then username). */
async function findCoachId(user) {
  if (user?.emailHash) {
    const { data } = await supabase.from('tbl_coaches').select('id').eq('email_hash', user.emailHash).maybeSingle()
    if (data?.id != null) return Number(data.id)
  }
  if (user?.username) {
    const { data } = await supabase.from('tbl_coaches').select('id').ilike('username', user.username).maybeSingle()
    if (data?.id != null) return Number(data.id)
  }
  return null
}

// ─── Venue map ────────────────────────────────────────────────

const pinIcon = L.divIcon({
  className: 'sa-map-pin',
  html: '<i class="bi bi-geo-alt-fill"></i>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
})

/** Click the map or drag the pin to place the venue; the circle is the check-in geofence. */
function VenueMap({ coords, radius, onPick }) {
  const el = useRef(null)
  const map = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    const start = coords || DEFAULT_COORDS
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([start.latitude, start.longitude], 16)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    const marker = L.marker([start.latitude, start.longitude], { draggable: true, icon: pinIcon }).addTo(m)
    const circle = L.circle([start.latitude, start.longitude], { color: '#0284c7', fillColor: '#38bdf8', fillOpacity: 0.25, weight: 2, radius }).addTo(m)
    const pick = (ll) => { marker.setLatLng(ll); circle.setLatLng(ll); onPickRef.current({ latitude: ll.lat, longitude: ll.lng }) }
    m.on('click', (e) => pick(e.latlng))
    marker.on('drag', () => circle.setLatLng(marker.getLatLng()))
    marker.on('dragend', () => pick(marker.getLatLng()))
    map.current = { m, marker, circle }
    return () => { m.remove(); map.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pin moved from outside (venue name lookup, "my location")
  useEffect(() => {
    const cur = map.current
    if (!cur || !coords) return
    const p = cur.marker.getLatLng()
    if (p.lat === coords.latitude && p.lng === coords.longitude) return
    const ll = [coords.latitude, coords.longitude]
    cur.marker.setLatLng(ll); cur.circle.setLatLng(ll); cur.m.panTo(ll)
  }, [coords])

  useEffect(() => { map.current?.circle.setRadius(radius) }, [radius])

  return <div ref={el} className="sa-venue-map" role="application" aria-label="Venue map: click to place the venue pin" />
}

// ─── Drills editor ────────────────────────────────────────────

function Stepper({ label, value, min, max, step, suffix, onChange }) {
  const clamp = (v) => Math.max(min, Math.min(max, v))
  return (
    <div className="d-flex align-items-center gap-2">
      <span className="small fw-semibold text-muted flex-grow-1">{label}</span>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>−</button>
      <div className="input-group input-group-sm" style={{ width: 92 }}>
        <input className="form-control text-center" inputMode="numeric" value={value} aria-label={label}
          onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); onChange(Number.isNaN(n) ? min : clamp(n)) }} />
        {suffix && <span className="input-group-text">{suffix}</span>}
      </div>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  )
}

function SetsReps({ drill, color, onChange }) {
  const unit = drillCountUnit(drill.category)
  const total = drillTargetTotal(drill)
  if (total == null) {
    return (
      <button type="button" className="btn btn-sm btn-outline-secondary align-self-start" style={{ color, borderColor: color }} onClick={() => onChange(DEFAULT_TARGET)}>
        <i className="bi bi-123 me-1" />Add sets &amp; {unit} (optional)
      </button>
    )
  }
  return (
    <div className="sa-drill-target d-grid gap-2" style={{ borderColor: `${color}55` }}>
      <div className="d-flex align-items-center gap-2">
        <i className="bi bi-123" style={{ color }} />
        <span className="fw-bold small flex-grow-1">Target: {total} {unit}</span>
        <button type="button" className="btn btn-link btn-sm text-danger p-0 fw-semibold text-decoration-none" onClick={() => onChange({ sets: undefined, reps: undefined, restSeconds: undefined })}>Remove</button>
      </div>
      <Stepper label="Sets" value={drill.sets ?? 0} min={1} max={10} step={1} onChange={(v) => onChange({ sets: v })} />
      <Stepper label={unit === 'jumps' ? 'Jumps per set' : 'Reps per set'} value={drill.reps ?? 0} min={1} max={100} step={1} onChange={(v) => onChange({ reps: v })} />
      <Stepper label="Rest between sets" value={drill.restSeconds ?? 0} min={0} max={300} step={15} suffix="s" onChange={(v) => onChange({ restSeconds: v })} />
      <div className="small text-muted">The watch counts the {unit} and compares them with this target. Workload (ACWR) still uses the drill time.</div>
    </div>
  )
}

/** Most search results shown at once */
const MAX_SEARCH_RESULTS = 8

/**
 * Search box for one drill: finds workouts of every drill type by a similar name
 * (searchWorkouts in drillPlan.js) and shows which type each is in.
 */
function DrillSearch({ drill, index, query, onQuery, onPick }) {
  const matches = query.trim() ? searchWorkouts(query, drill.category) : []
  const shown = matches.slice(0, MAX_SEARCH_RESULTS)
  return (
    <div className="d-grid gap-1">
      <div className="sa-workout-search">
        <i className="bi bi-search text-muted" aria-hidden="true" />
        <input type="search" className="form-control form-control-sm"
          placeholder="Search drills (e.g. tuck jumps)"
          aria-label={`Search all drills for drill ${index + 1}`}
          value={query} onChange={(e) => onQuery(e.target.value)} />
      </div>
      {query.trim() !== '' && shown.length === 0 && (
        <div className="small text-muted text-center py-2">No drill like “{query.trim()}” in any drill type.</div>
      )}
      {shown.map(({ category, workout }) => {
        const cc = CATEGORY_CONFIG[category]
        const sameType = category === drill.category
        const on = sameType && (drill.workouts ?? []).includes(workout.name)
        return (
          <button key={`${category}/${workout.name}`} type="button" aria-pressed={on}
            className="sa-search-row d-flex align-items-center gap-2 text-start"
            style={on ? { borderColor: cc.color, background: cc.bg, color: '#111827' } : undefined}
            onClick={() => onPick(category, workout.name)}>
            <span className="flex-grow-1">
              <span className="d-block fw-bold small">{workout.name}</span>
              {workout.group && <span className="d-block sa-workout-group">{workout.group}</span>}
            </span>
            <span className="sa-drill-pill" style={{ background: cc.bg, color: cc.color }}><i className={`bi ${cc.icon}`} />{category}</span>
            <i className={`bi ${on ? 'bi-check-circle-fill' : sameType ? 'bi-plus-circle' : 'bi-arrow-left-right'}`}
              style={{ color: on || sameType ? cc.color : undefined }}
              title={sameType ? undefined : `Switches this drill to ${category}`} />
          </button>
        )
      })}
      {matches.length > shown.length && (
        <div className="small text-muted text-center">{matches.length - shown.length} more: type more of the name to narrow it down</div>
      )}
      {shown.some((m) => m.category !== drill.category) && (
        <div className="small text-muted">Picking a drill of another type switches this drill to that type.</div>
      )}
    </div>
  )
}

function DrillsEditor({ drills, onChange }) {
  const [collapsed, setCollapsed] = useState([])
  // Search text of each drill's search box, by drill id
  const [queries, setQueries] = useState({})
  const total = drills.reduce((s, d) => s + (Number(d.durationMinutes) || 0), 0)
  const update = (id, changes) => onChange(drills.map((d) => (d.id === id ? { ...d, ...changes } : d)))

  // A workout picked from the search. One of this drill's type is toggled like a card; one of
  // another type switches the drill to that type with just that workout picked (a drill has one
  // type, so the old type's picks go, as when the type is changed by hand).
  const pickFromSearch = (drill, category, name) => {
    const picked = drill.workouts ?? []
    if (category === drill.category) {
      update(drill.id, { workouts: picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name] })
    } else {
      update(drill.id, {
        category, workouts: [name],
        ...(drillHasSetsReps(category) ? {} : { sets: undefined, reps: undefined, restSeconds: undefined }),
      })
    }
    // Back to the drill's list, open, with the pick showing
    setQueries((p) => ({ ...p, [drill.id]: '' }))
    setCollapsed((p) => p.filter((x) => x !== drill.id))
  }

  return (
    <div className="d-grid gap-3">
      <div className="sa-drill-summary d-flex justify-content-between align-items-center">
        <span className="fw-bold"><i className="bi bi-clipboard-check me-2 text-sa" />{drills.length} {drills.length === 1 ? 'drill' : 'drills'} planned</span>
        <span className="sa-badge green"><i className="bi bi-clock me-1" />{total} min total</span>
      </div>

      {drills.map((drill, i) => {
        const cfg = CATEGORY_CONFIG[drill.category]
        const open = !collapsed.includes(drill.id)
        const picked = drill.workouts ?? []
        return (
          <div key={drill.id} className="sa-drill-card d-grid gap-2">
            <div className="d-flex align-items-center gap-2">
              <span className="sa-drill-num">#{i + 1}</span>
              <span className="sa-drill-pill" style={{ background: cfg.bg, color: cfg.color }}><i className={`bi ${cfg.icon}`} />{drill.category}</span>
              <span className="flex-grow-1" />
              <button type="button" className="sa-icon-btn text-danger" onClick={() => onChange(drills.filter((d) => d.id !== drill.id))} aria-label={`Remove drill ${i + 1}`} title="Remove drill">
                <i className="bi bi-trash3" />
              </button>
            </div>

            {/* Search every drill type by name: shows which type a drill is in */}
            <DrillSearch drill={drill} index={i} query={queries[drill.id] ?? ''}
              onQuery={(text) => setQueries((p) => ({ ...p, [drill.id]: text }))}
              onPick={(category, name) => pickFromSearch(drill, category, name)} />

            <div className="d-flex flex-wrap gap-1" role="radiogroup" aria-label={`Drill ${i + 1} type`}>
              {DRILL_CATEGORIES.map((c) => {
                const cc = CATEGORY_CONFIG[c]
                const on = c === drill.category
                return (
                  <button key={c} type="button" role="radio" aria-checked={on}
                    className="sa-drill-type"
                    style={on ? { background: cc.bg, color: cc.color, borderColor: cc.color } : undefined}
                    onClick={() => {
                      if (on) return
                      // A new type means a new workout list: start its search empty
                      setQueries((p) => ({ ...p, [drill.id]: '' }))
                      update(drill.id, {
                        category: c, workouts: [],
                        ...(drillHasSetsReps(c) ? {} : { sets: undefined, reps: undefined, restSeconds: undefined }),
                      })
                    }}>
                    <i className={`bi ${cc.icon}`} style={{ color: cc.color }} />{c}
                  </button>
                )
              })}
            </div>

            <div className="sa-drill-sensors d-flex align-items-center gap-2">
              <i className="bi bi-smartwatch" style={{ color: cfg.color }} />
              <div className="small">
                <div className="fw-bold">Tracks: {TRACKS[drill.category]}</div>
                <div className="text-muted">Watch sensors: {SENSORS[drill.category]}</div>
              </div>
            </div>

            <button type="button" className="sa-drill-suggest-head" aria-expanded={open}
              onClick={() => setCollapsed((p) => (p.includes(drill.id) ? p.filter((x) => x !== drill.id) : [...p, drill.id]))}>
              <i className="bi bi-lightbulb" style={{ color: cfg.color }} />
              <span className="flex-grow-1 text-start fw-bold small">{drill.category} drills</span>
              {picked.length > 0 && <span className="small fw-bold" style={{ color: cfg.color }}>{picked.length} selected</span>}
              <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'} text-muted`} />
            </button>
            {open && (
              <div className="sa-workouts">
                {(WORKOUT_SUGGESTIONS[drill.category] || []).map((w) => {
                  const on = picked.includes(w.name)
                  return (
                    <button key={w.name} type="button" aria-pressed={on}
                      className={`sa-workout${on ? ' on' : ''}`}
                      style={on ? { borderColor: cfg.color, background: cfg.bg, color: '#111827' } : undefined}
                      onClick={() => update(drill.id, { workouts: on ? picked.filter((x) => x !== w.name) : [...picked, w.name] })}>
                      <span className="d-flex justify-content-between gap-2">
                        <span className="fw-bold small">{w.name}</span>
                        <i className={`bi ${on ? 'bi-check-circle-fill' : 'bi-circle'}`} style={{ color: on ? cfg.color : undefined }} />
                      </span>
                      {w.group && <span className="sa-workout-group">{w.group}</span>}
                      <span className="sa-workout-desc">{w.description}</span>
                      <span className="sa-workout-min">~{w.minutes} min</span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className="small fw-semibold text-muted me-1">Duration</span>
              <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="5 minutes less"
                onClick={() => update(drill.id, { durationMinutes: Math.max(1, (Number(drill.durationMinutes) || 0) - 5) })}>−</button>
              <div className="input-group input-group-sm" style={{ width: 104 }}>
                <input className="form-control text-center" inputMode="numeric" aria-label={`Drill ${i + 1} duration in minutes`}
                  value={drill.durationMinutes || ''}
                  onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); update(drill.id, { durationMinutes: Number.isNaN(n) ? 0 : n }) }} />
                <span className="input-group-text">min</span>
              </div>
              <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="5 minutes more"
                onClick={() => update(drill.id, { durationMinutes: Math.min(120, (Number(drill.durationMinutes) || 0) + 5) })}>+</button>
              <span className="d-flex flex-wrap gap-1 ms-md-2">
                {[5, 10, 15, 20, 30, 45].map((p) => (
                  <button key={p} type="button" className={`sa-preset${drill.durationMinutes === p ? ' on' : ''}`} onClick={() => update(drill.id, { durationMinutes: p })}>{p}m</button>
                ))}
              </span>
            </div>

            {drillHasSetsReps(drill.category) && (
              <SetsReps drill={drill} color={cfg.color} onChange={(c) => update(drill.id, c)} />
            )}
          </div>
        )
      })}

      {drills.length === 0 && (
        <div className="sa-drill-empty text-center">
          <i className="bi bi-clipboard fs-3 text-sa" />
          <div className="fw-bold mt-1">No drills added yet</div>
          <div className="small text-muted">Add a block for each part of the session. Pick a drill type, the drills to do, and how long it lasts.</div>
        </div>
      )}

      <button type="button" className="btn btn-outline-secondary fw-bold"
        onClick={() => onChange([...drills, { id: newId(), name: '', durationMinutes: 15, category: 'Warm-up' }])}>
        <i className="bi bi-plus-lg me-1" />Add drill
      </button>    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────

export function AddSession({ user, onCancel, onCreated }) {
  const [title, setTitle] = useState('')
  const [sessionType, setSessionType] = useState('training')
  const [date, setDate] = useState(todayInput)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [locationType, setLocationType] = useState('venue')
  const [venueName, setVenueName] = useState('')
  const [venueCoords, setVenueCoords] = useState(null)
  const [geofenceRadius, setGeofenceRadius] = useState('40')
  const [drills, setDrills] = useState([])
  const [saving, setSaving] = useState(false)
  const [searchingVenue, setSearchingVenue] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)
  // Venue name filled in from the pin (reverse lookup): don't look it up again
  const autoFilledName = useRef(null)
  const nameRequest = useRef(0)

  // Looked up while the form is filled in, so Save only has to send the session
  const coachIdRef = useRef(null)
  useEffect(() => { coachIdRef.current = findCoachId(user).catch(() => null) }, [user])

  // Where the map starts: the browser's location if the coach allows it
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setVenueCoords((c) => c ?? { latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    )
  }, [])

  // Typing a venue name moves the pin to that place
  useEffect(() => {
    const name = venueName.trim()
    if (locationType !== 'venue' || name.length < 3 || name === autoFilledName.current) return
    let cancelled = false
    const t = setTimeout(async () => {
      setSearchingVenue(true)
      const point = await geocodePlace(name)
      if (!cancelled) { setSearchingVenue(false); if (point) setVenueCoords(point) }
    }, 800)
    return () => { cancelled = true; clearTimeout(t); setSearchingVenue(false) }
  }, [venueName, locationType])

  // Pin placed on the map: fill the venue name with that place (Nominatim allows ~1 request/s)
  const pickOnMap = async (point) => {
    setVenueCoords(point)
    const id = ++nameRequest.current
    await new Promise((r) => setTimeout(r, 500))
    if (id !== nameRequest.current) return
    const name = await reverseGeocode(point)
    if (id !== nameRequest.current || !name) return
    autoFilledName.current = name
    setVenueName(name)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser cannot share its location.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); pickOnMap({ latitude: p.coords.latitude, longitude: p.coords.longitude }) },
      () => { setLocating(false); setError('Could not get your location. Allow location access in the browser, or click the map.') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // The session ends when its drills do: start + the total drill time (set by hand only with no drills)
  const totalDurationMinutes = useMemo(() => drills.reduce((s, d) => s + (Number(d.durationMinutes) || 0), 0), [drills])
  const endIsAuto = totalDurationMinutes > 0
  const startMins = toMinutes(startTime)
  const endMins = endIsAuto ? (startMins == null ? null : startMins + totalDurationMinutes) : toMinutes(endTime)
  const shownEnd = endMins == null ? '' : `${pad(Math.floor(endMins / 60) % 24)}:${pad(endMins % 60)}`
  const radius = Math.max(10, Number(geofenceRadius) || 40)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!title.trim()) return setError('Please enter a title for the session.')
    if (!date) return setError('Please pick a date for the session.')
    if (locationType === 'venue' && !venueName.trim()) return setError('Please enter a venue name for this session.')
    // Times are stored without a date, so the session has to end on the day it starts
    if (startMins != null && endMins != null && endMins >= 24 * 60) {
      return setError(`Starting at ${toDbTime(startMins)}, ${totalDurationMinutes} min of drills would run past midnight. Choose an earlier start time or shorten the drills.`)
    }

    setSaving(true)
    try {
      const venue = locationType === 'venue'
      const coachId = (await coachIdRef.current) ?? (await findCoachId(user).catch(() => null))
      const row = {
        title: title.trim(),
        session_type: sessionType,
        date,
        start_time: toDbTime(startMins),
        end_time: toDbTime(endMins),
        location_type: locationType,
        venue_name: venue ? venueName.trim() : null,
        latitude: venue ? venueCoords?.latitude ?? null : null,
        longitude: venue ? venueCoords?.longitude ?? null : null,
        geofence_radius: venue ? Number(geofenceRadius) || 40 : null,
        // Same drill objects the phone saves; the name is what the athlete sees
        drills: drills.map((d, i) => ({
          ...d,
          name: d.workouts?.length ? d.workouts.join(', ') : `Drill ${i + 1}: ${d.category}`,
        })),
        total_duration_minutes: totalDurationMinutes,
        coach_id: coachId,
        coach_name: maskFullName(`${user?.firstName || ''} ${user?.lastName || ''}`) || null,
      }
      const { data, error: err } = await supabase.from('tbl_sessions').insert(row).select('id').single()
      if (err) throw new Error(err.message || 'Could not save the session.')
      onCreated?.(data?.id, row.title)
    } catch (err) {
      setError(err.message || 'Failed to save session. Please try again.')
      setSaving(false)
    }
  }

  return (
    <>
      <button className="sa-back" onClick={onCancel}><i className="bi bi-arrow-left" />All sessions</button>
      <PageHeader crumb="Sessions" title="Add session" />

      <form onSubmit={submit} noValidate className="sa-add-session">
        <div className="row g-3">
          <div className="col-xl-6 d-grid gap-3 align-content-start">
            <section className="sa-card p-3">
              <h2 className="sa-card-title mb-3">Session details</h2>
              <label className="form-label small fw-semibold" htmlFor="as-title">Session title</label>
              <input id="as-title" className="form-control mb-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tuesday conditioning" maxLength={80} />
              <div className="form-label small fw-semibold" id="as-type-label">Session type</div>
              <div className="btn-group w-100" role="group" aria-labelledby="as-type-label">
                {[['training', 'Training'], ['sc', 'S&C']].map(([v, l]) => (
                  <button key={v} type="button" className={`btn ${sessionType === v ? 'btn-sa' : 'btn-outline-secondary'}`} aria-pressed={sessionType === v} onClick={() => setSessionType(v)}>{l}</button>
                ))}
              </div>
            </section>

            <section className="sa-card p-3">
              <h2 className="sa-card-title mb-3">Schedule</h2>
              <label className="form-label small fw-semibold" htmlFor="as-date">Date</label>
              <input id="as-date" type="date" className="form-control mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
              <div className="row g-2">
                <div className="col-6">
                  <label className="form-label small fw-semibold" htmlFor="as-start">Start time</label>
                  <input id="as-start" type="time" className="form-control" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-semibold" htmlFor="as-end">End time</label>
                  <input id="as-end" type="time" className="form-control" value={endIsAuto ? shownEnd : endTime} readOnly={endIsAuto} disabled={endIsAuto}
                    onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              {endIsAuto && (
                <div className="small text-muted mt-2">
                  <i className="bi bi-hourglass-split me-1" />
                  {startMins != null
                    ? `Ends ${totalDurationMinutes} min after the start: the total of the drills.`
                    : `Set a start time: the end time is the start plus the ${totalDurationMinutes} min of drills.`}
                </div>
              )}
            </section>

            <section className="sa-card p-3">
              <h2 className="sa-card-title mb-3">Location</h2>
              <div className="btn-group w-100 mb-3" role="group" aria-label="Location type">
                {[['venue', 'Venue', 'bi-geo-alt'], ['at_home', 'At home', 'bi-house']].map(([v, l, ic]) => (
                  <button key={v} type="button" className={`btn ${locationType === v ? 'btn-sa' : 'btn-outline-secondary'}`} aria-pressed={locationType === v} onClick={() => setLocationType(v)}>
                    <i className={`bi ${ic} me-1`} />{l}
                  </button>
                ))}
              </div>

              {locationType === 'venue' ? (
                <>
                  <label className="form-label small fw-semibold" htmlFor="as-venue">Venue name</label>
                  <div className="input-group mb-2">
                    <span className="input-group-text"><i className="bi bi-geo-alt" /></span>
                    <input id="as-venue" className="form-control" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="e.g. EVSU Ormoc Gymnasium" />
                    {searchingVenue && <span className="input-group-text"><span className="spinner-border spinner-border-sm" aria-label="Finding place" /></span>}
                    <button type="button" className="btn btn-outline-secondary" onClick={useMyLocation} disabled={locating} title="Use my location">
                      {locating ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-crosshair" />}
                    </button>
                  </div>
                  <VenueMap coords={venueCoords} radius={radius} onPick={pickOnMap} />
                  <div className="small text-muted text-center fst-italic my-2">Click the map to place the venue pin, or drag it to adjust</div>
                  <label className="form-label small fw-semibold" htmlFor="as-radius">Geofence radius</label>
                  <div className="input-group mb-2" style={{ maxWidth: 220 }}>
                    <span className="input-group-text"><i className="bi bi-bullseye" /></span>
                    <input id="as-radius" className="form-control" inputMode="numeric" value={geofenceRadius} onChange={(e) => setGeofenceRadius(e.target.value.replace(/[^0-9]/g, ''))} />
                    <span className="input-group-text">m</span>
                  </div>
                  <div className="sa-info small"><i className="bi bi-smartwatch text-sa me-2" />Wear OS will auto-check-in when the athlete enters the {geofenceRadius || 40} m geofence</div>
                </>
              ) : (
                <div className="sa-info d-flex align-items-center gap-3">
                  <i className="bi bi-house fs-5 text-sa" />
                  <div><div className="fw-semibold">At-home session</div><div className="small text-muted">No location tracking — the athlete trains at home</div></div>
                </div>
              )}
            </section>
          </div>

          <div className="col-xl-6">
            <section className="sa-card p-3">
              <h2 className="sa-card-title mb-3">Drills</h2>
              <DrillsEditor drills={drills} onChange={setDrills} />
            </section>
          </div>
        </div>

        {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}

        <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
          <button type="submit" className="btn btn-sa px-4 fw-semibold" disabled={saving}>
            {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving session…</> : 'Create session'}
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <span className="small text-muted ms-md-2">Athletes' devices will receive a push notification · Check-in window ±15 min</span>
        </div>
      </form>
    </>
  )
}
