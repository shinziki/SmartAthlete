import { recordSessionProgress } from './sessionService';
import { LiveTrackingState, trackingService } from './trackingService';

/**
 * Keeps the coach informed about a live session, with or without internet.
 *
 * Sends a progress snapshot when a session starts, whenever a drill finishes or changes,
 * and every minute while it runs. Tracking itself never depends on the network: when a
 * snapshot can't be uploaded it is stored on the phone (recordSessionProgress) and the
 * app's background sync uploads it once the connection returns. The final "completed"
 * snapshot is sent by trackingService.stopTracking().
 */

const HEARTBEAT_MS = 60_000;

function snapshotKey(s: LiveTrackingState): string {
  // A boundary change (e.g. athlete walked outside) is sent immediately for the coach
  return `${s.sessionId}|${s.startedAt}|${s.completedDrills.length}|${s.currentDrillIndex}|${s.boundaryStatus}`;
}

function canSync(s: LiveTrackingState): s is LiveTrackingState & { athleteId: number } {
  // Placeholder runs ("live_session") have no server session to attach progress to yet
  return s.isActive && !!s.athleteId && /^\d+$/.test(String(s.sessionId));
}

function send(s: LiveTrackingState & { athleteId: number }) {
  const current = s.drills[s.currentDrillIndex];
  recordSessionProgress({
    sessionId: Number(s.sessionId),
    athleteId: s.athleteId,
    status: 'in_progress',
    drillsCompleted: s.completedDrills.length,
    totalDrills: s.drills.length,
    currentDrill: current?.name ?? null,
    elapsedSeconds: s.elapsedSeconds,
    playerLoadAU: s.playerLoadAU,
    // The drill-by-drill backup: everything finished so far
    drillBreakdown: s.completedDrills,
    recordedAt: new Date().toISOString(),
    boundaryStatus: s.boundaryStatus,
    boundaryMeters: s.boundaryMeters,
  }).catch(() => undefined);
}

/** Starts watching the tracking service. Returns a function that stops it. */
export function startProgressSync(): () => void {
  let lastKey = '';
  let lastSentAt = 0;

  const unsubscribe = trackingService.subscribe((s) => {
    if (!canSync(s)) {
      lastKey = '';
      return;
    }
    const key = snapshotKey(s);
    if (key !== lastKey) {
      lastKey = key;
      lastSentAt = Date.now();
      send(s);
    }
  });

  // Heartbeat: lets the coach tell "live" apart from "phone went offline"
  const timer = setInterval(() => {
    const s = trackingService.getState();
    if (canSync(s) && Date.now() - lastSentAt >= HEARTBEAT_MS - 1000) {
      lastSentAt = Date.now();
      send(s);
    }
  }, HEARTBEAT_MS);

  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
