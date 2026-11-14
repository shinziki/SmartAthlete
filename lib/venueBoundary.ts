/**
 * Venue boundary rules for a live session.
 *
 * - Near the edge (outer part of the area): one "about to leave" warning.
 * - Outside: a "you left" warning and a countdown; the session stops when it ends.
 * - Any position back inside cancels the countdown, so returning in time never stops it.
 *
 * The stop runs on its own timer, not on GPS updates: an athlete standing still outside
 * produces no new positions, and the first position while walking back in is often still
 * outside — deciding on GPS updates stopped sessions at the wrong moment.
 */

export interface VenueBoundaryOptions {
  radius: number;
  graceMs: number;
  /** Fraction of the radius where the "about to leave" warning starts */
  warnRatio: number;
  /** Fraction of the radius the athlete must be back within to re-arm the warnings */
  rearmRatio: number;
  onEdgeWarning: (metersToEdge: number) => void;
  onOutsideWarning: () => void;
  /** Seconds left before stopping, or null when back inside */
  onCountdown: (secondsLeft: number | null) => void;
  onStop: () => void;
  /** Called when the athlete's zone changes (for the coach's live view) */
  onStatus?: (status: 'inside' | 'near_edge' | 'outside', distance: number) => void;
}

export function createVenueBoundaryGuard(o: VenueBoundaryOptions) {
  let edgeWarned = false;
  let outsideWarned = false;
  let stopAt: number | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let zone: 'inside' | 'near_edge' | 'outside' | null = null;
  const setZone = (z: 'inside' | 'near_edge' | 'outside', distance: number) => {
    if (z !== zone) {
      zone = z;
      o.onStatus?.(z, distance);
    }
  };

  const clearCountdown = () => {
    if (stopTimer) clearTimeout(stopTimer);
    if (tick) clearInterval(tick);
    const wasCounting = stopAt != null;
    stopTimer = null;
    tick = null;
    stopAt = null;
    if (wasCounting) o.onCountdown(null);
  };

  const startCountdown = () => {
    if (stopTimer) return; // already counting down
    stopAt = Date.now() + o.graceMs;
    o.onCountdown(Math.ceil(o.graceMs / 1000));
    stopTimer = setTimeout(() => {
      clearCountdown();
      if (stopped) return;
      stopped = true;
      o.onStop();
    }, o.graceMs);
    tick = setInterval(() => {
      if (stopAt != null) o.onCountdown(Math.max(0, Math.ceil((stopAt - Date.now()) / 1000)));
    }, 1000);
  };

  return {
    /** Distance (m) of the latest trustworthy position from the venue center. */
    update(distance: number) {
      if (stopped) return;
      setZone(
        distance > o.radius ? 'outside' : distance > o.radius * o.warnRatio ? 'near_edge' : 'inside',
        distance
      );
      if (distance > o.radius) {
        if (!outsideWarned) {
          outsideWarned = true;
          o.onOutsideWarning();
        }
        startCountdown();
        return;
      }
      clearCountdown();
      if (distance > o.radius * o.warnRatio) {
        if (!edgeWarned && !outsideWarned) {
          edgeWarned = true;
          o.onEdgeWarning(Math.round(o.radius - distance));
        }
      } else if (distance < o.radius * o.rearmRatio) {
        edgeWarned = false;
        outsideWarned = false;
      }
    },
    dispose() {
      stopped = true;
      clearCountdown();
    },
  };
}
