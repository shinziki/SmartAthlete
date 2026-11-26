import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Live session data for the web portal, the same the coach sees in the mobile app:
 * each athlete's phone uploads a progress snapshot every ~10 s while training
 * (tbl_session_progress), and realtime pushes it here the moment it lands.
 */

/** No upload for this long = the athlete's phone lost its connection (as on mobile). */
export const STALE_MS = 2 * 60_000
/** Between uploads the time keeps running on screen, for at most this long. */
const MAX_INTERPOLATE_S = 30

/* ------------------------------ Data ------------------------------ */

export const keyOf = (r) => `${r.session_id}:${r.athlete_id}`

/**
 * Progress rows (and, with `withAttendees`, check-ins) for the given sessions, kept current
 * through realtime. A slow poll covers a dropped realtime connection.
 */
export function useLiveSessions(sessionIds, { withAttendees = false, pollMs = 30_000 } = {}) {
  const ids = [...new Set((sessionIds || []).map(Number).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
  const idsKey = ids.join(',')
  const [st, setSt] = useState({ loading: ids.length > 0, progress: [], attendees: [], failed: false })

  useEffect(() => {
    if (!idsKey) {
      setSt({ loading: false, progress: [], attendees: [], failed: false })
      return
    }
    const list = idsKey.split(',').map(Number)
    let cancelled = false

    const read = async () => {
      const [p, a] = await Promise.all([
        supabase.from('tbl_session_progress').select('*').in('session_id', list),
        withAttendees
          ? supabase.from('tbl_session_attendees').select('*').in('session_id', list)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (cancelled) return
      setSt({
        loading: false,
        // Older databases have no progress table: just no live info
        progress: p.error ? [] : p.data || [],
        attendees: a.error ? [] : a.data || [],
        failed: !!a.error,
      })
    }
    setSt((s) => ({ ...s, loading: true }))
    read().catch(() => { if (!cancelled) setSt({ loading: false, progress: [], attendees: [], failed: true }) })

    // Realtime: apply each upload straight away (no refetch needed for progress)
    const filter = `session_id=in.(${idsKey})`
    let refetch = null
    const channel = supabase
      .channel(`web-live-${idsKey}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tbl_session_progress', filter }, (payload) => {
        const row = payload.new
        if (!row || row.session_id == null) return
        setSt((s) => {
          const others = s.progress.filter((r) => keyOf(r) !== keyOf(row))
          return { ...s, progress: [...others, { ...(s.progress.find((r) => keyOf(r) === keyOf(row)) || {}), ...row }] }
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tbl_session_attendees', filter }, () => {
        if (!withAttendees || refetch) return
        refetch = setTimeout(() => { refetch = null; read().catch(() => {}) }, 400)
      })
      .subscribe()

    const poll = setInterval(() => { if (!document.hidden) read().catch(() => {}) }, pollMs)
    return () => {
      cancelled = true
      clearInterval(poll)
      if (refetch) clearTimeout(refetch)
      supabase.removeChannel(channel)
    }
  }, [idsKey, withAttendees, pollMs])

  return st
}

/** Current time, updated every `ms` while `active`. */
export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, active])
  return now
}

/* ------------------------------ Status ------------------------------ */

export const lastSeen = (p) => (p?.synced_at ? new Date(p.synced_at).getTime() : 0)
export const isStale = (p, now) => p?.status !== 'completed' && now - lastSeen(p) > STALE_MS

/** Session time right now: the last upload's time, kept running until the next one. */
export function liveSeconds(p, now) {
  const base = Number(p?.elapsed_seconds) || 0
  if (p?.status !== 'in_progress' || p.live_paused || isStale(p, now)) return base
  const at = p.recorded_at ? new Date(p.recorded_at).getTime() : lastSeen(p)
  const extra = Math.min(MAX_INTERPOLATE_S, Math.max(0, (now - at) / 1000))
  return Math.floor(base + extra)
}

const clockTime = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')

/**
 * One status per athlete, from their check-in and live progress (same rules as the coach's
 * live monitor in the mobile app). Returns [label, badge color, detail, isIssue].
 */
export function presenceOf(att, p, now) {
  if (att?.status === 'absent' || p?.verify_status === 'absent') return ['Marked absent', 'gray', null, false]
  if (!p) return att && att.status !== 'declined' ? ['Checked in · not started', 'gray', null, false] : null
  const drills = Number(p.total_drills) || 0
  const drill = drills > 0 ? `Drill ${Math.min((Number(p.drills_completed) || 0) + 1, drills)}/${drills}` : null
  if (p.status === 'completed') {
    return ['Finished', 'green', `${Math.round((Number(p.elapsed_seconds) || 0) / 60)} min · ${p.drills_completed ?? 0}/${drills} drills`, false]
  }
  if (p.boundary_status === 'stopped') return ['Left venue · stopped', 'red', null, true]
  if (isStale(p, now)) return ['No signal', 'amber', p.synced_at ? `last seen ${clockTime(p.synced_at)}` : null, true]
  if (p.supervision_status === 'pending') return ['Confirm wearer', 'amber', 'watch taken off again · not counting', true]
  if (p.verify_status === 'unverified') return ['Wearer not verified', 'red', drill, true]
  if (p.boundary_status === 'outside') {
    return ['Outside venue', 'red', p.boundary_meters != null ? `${p.boundary_meters} m from center` : null, true]
  }
  if (p.live_on_wrist === false) return ['Watch off wrist', 'red', 'not counting', true]
  if (p.live_watch_connected === false) return ['Watch out of range', 'amber', 'watch recording on its own', true]
  if (p.live_paused) return ['Resting / paused', 'blue', drill, false]
  return ['Training now', 'green', drill, false]
}

/* ------------------------------ Formatting ------------------------------ */

export const clockOf = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const ago = (t, now) => {
  if (!t) return '—'
  const s = Math.max(0, Math.round((now - new Date(t).getTime()) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)} min ago`
}
