import AsyncStorage from '@react-native-async-storage/async-storage';
import { DbSession, SessionDrill } from './sessionService';

// ─── Types ────────────────────────────────────────────────────

export interface LiveTrackingState {
  isActive: boolean;
  isPaused: boolean;
  sessionId: string | number;
  sessionTitle: string;
  athleteId?: number;
  athleteName?: string;
  watchName: string;
  isWatchConnected: boolean;
  isMoving: boolean;

  // Telemetry matching watch
  elapsedSeconds: number;
  steps: number;
  meters: number;
  jumps: number;
  heartRate: number;
  playerLoadAU: number;
  caloriesBurned: number;

  // Drill tracking
  drills: SessionDrill[];
  currentDrillIndex: number;
  currentDrillSeconds: number;

  startedAt: string;
  lastUpdatedAt: string;
}

export interface CompletedSessionMetrics {
  sessionId: string | number;
  sessionTitle: string;
  date: string;
  durationFormatted: string;
  totalSeconds: number;
  steps: number;
  meters: number;
  jumps: number;
  avgHeartRate: number;
  maxHeartRate: number;
  playerLoadAU: number;
  caloriesBurned: number;
  watchName: string;
  completedAt: string;
}

const STORAGE_ACTIVE_TRACKING = '@smartathlete_active_tracking_v1';
const STORAGE_COMPLETED_SESSIONS = '@smartathlete_completed_sessions_v1';

// ─── Initial State ────────────────────────────────────────────

const DEFAULT_STATE: LiveTrackingState = {
  isActive: false,
  isPaused: false,
  sessionId: '',
  sessionTitle: 'Training Session',
  athleteId: undefined,
  athleteName: undefined,
  watchName: 'Wear OS Smartwatch',
  isWatchConnected: true,
  isMoving: false,

  elapsedSeconds: 0,
  steps: 0,
  meters: 0,
  jumps: 0,
  heartRate: 78,
  playerLoadAU: 0,
  caloriesBurned: 0,

  drills: [],
  currentDrillIndex: 0,
  currentDrillSeconds: 0,

  startedAt: '',
  lastUpdatedAt: '',
};

// ─── Service Class ────────────────────────────────────────────

class TrackingService {
  private state: LiveTrackingState = { ...DEFAULT_STATE };
  private timer: any = null;
  private listeners: Array<(state: LiveTrackingState) => void> = [];
  private hrSamples: number[] = [];
  private lastWatchUpdateTimestamp: number = 0;

  constructor() {
    this.restoreFromStorage();
  }

  private async restoreFromStorage() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_TRACKING);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.isActive) {
          this.state = parsed;
          if (!this.state.isPaused) {
            this.startInterval();
          }
          this.notify();
        }
      }
    } catch (err) {
      console.warn('[trackingService] Error restoring tracking state:', err);
    }
  }

  private async persistActiveState() {
    try {
      if (this.state.isActive) {
        await AsyncStorage.setItem(STORAGE_ACTIVE_TRACKING, JSON.stringify(this.state));
      } else {
        await AsyncStorage.removeItem(STORAGE_ACTIVE_TRACKING);
      }
    } catch (err) {
      console.warn('[trackingService] Error persisting active state:', err);
    }
  }

  public getState(): LiveTrackingState {
    return { ...this.state };
  }

  public subscribe(listener: (state: LiveTrackingState) => void): () => void {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (e) {
        console.warn('[trackingService] Listener error:', e);
      }
    });
  }

  /**
   * Starts tracking a training session.
   */
  public startTracking(
    session: DbSession | null,
    athleteId?: number,
    athleteName?: string,
    watchName?: string
  ) {
    if (this.state.isActive) {
      // If already tracking this session, resume if paused
      if (this.state.isPaused) {
        this.resumeTracking();
      }
      return;
    }

    const now = new Date().toISOString();
    const drills = session?.drills || [];

    this.state = {
      ...DEFAULT_STATE,
      isActive: true,
      isPaused: false,
      sessionId: session?.id || 'live_session',
      sessionTitle: session?.title || 'Training Session',
      athleteId,
      athleteName,
      watchName: watchName || 'Wear OS Smartwatch',
      isWatchConnected: true,
      drills,
      currentDrillIndex: 0,
      currentDrillSeconds: 0,
      startedAt: now,
      lastUpdatedAt: now,
      heartRate: 78,
      steps: 0,
      meters: 0,
      jumps: 0,
      isMoving: false,
    };

    this.hrSamples = [78];
    this.lastWatchUpdateTimestamp = Date.now();
    this.startInterval();
    this.persistActiveState();
    this.notify();
  }

  public pauseTracking() {
    if (!this.state.isActive || this.state.isPaused) return;
    this.state.isPaused = true;
    this.stopInterval();
    this.persistActiveState();
    this.notify();
  }

  public resumeTracking() {
    if (!this.state.isActive || !this.state.isPaused) return;
    this.state.isPaused = false;
    this.startInterval();
    this.persistActiveState();
    this.notify();
  }

  public nextDrill() {
    if (!this.state.isActive) return;
    if (this.state.currentDrillIndex < this.state.drills.length - 1) {
      this.state.currentDrillIndex += 1;
      this.state.currentDrillSeconds = 0;
      this.persistActiveState();
      this.notify();
    }
  }

  public prevDrill() {
    if (!this.state.isActive) return;
    if (this.state.currentDrillIndex > 0) {
      this.state.currentDrillIndex -= 1;
      this.state.currentDrillSeconds = 0;
      this.persistActiveState();
      this.notify();
    }
  }

  /**
   * Updates state with physical sensor readings and clock sync from watch BLE telemetry packet.
   */
  public updateFromWatch(data: {
    secs?: number;
    steps?: number;
    meters?: number;
    jumps?: number;
    heartRate?: number;
    moving?: boolean;
    paused?: boolean;
    drill?: number;
  }) {
    // If not active yet, auto-activate immediately so watch data is NEVER discarded!
    if (!this.state.isActive) {
      this.state.isActive = true;
      this.startInterval();
    }

    this.lastWatchUpdateTimestamp = Date.now();

    // Snap elapsed seconds directly to watch timer IF data.secs is a valid number
    if (typeof data.secs === 'number' && !isNaN(data.secs)) {
      if (data.secs > 0 || this.state.elapsedSeconds <= 2) {
        this.state.elapsedSeconds = data.secs;
      }
    }
    if (typeof data.steps === 'number' && !isNaN(data.steps)) {
      this.state.steps = data.steps;
    }
    if (typeof data.meters === 'number' && !isNaN(data.meters)) {
      this.state.meters = data.meters;
    }
    if (typeof data.jumps === 'number' && !isNaN(data.jumps)) {
      this.state.jumps = data.jumps;
    }
    if (typeof data.heartRate === 'number' && data.heartRate > 30) {
      this.state.heartRate = data.heartRate;
      this.hrSamples.push(data.heartRate);
    }
    if (data.moving !== undefined) {
      this.state.isMoving = data.moving;
    }
    if (data.paused !== undefined) {
      this.state.isPaused = data.paused;
    }
    if (data.drill !== undefined && data.drill !== this.state.currentDrillIndex) {
      if (data.drill < this.state.drills.length) {
        this.state.currentDrillIndex = data.drill;
        this.state.currentDrillSeconds = 0;
      }
    }

    // Player load based strictly on real steps and jumps recorded by sensors
    const load = this.state.steps * 0.08 + this.state.jumps * 0.4 + (this.state.heartRate > 140 ? 0.2 : 0.02);
    this.state.playerLoadAU = Math.round(load * 10) / 10;
    this.state.caloriesBurned = Math.round(this.state.steps * 0.052);

    this.state.isWatchConnected = true;
    this.state.lastUpdatedAt = new Date().toISOString();
    this.persistActiveState();
    this.notify();
  }

  /**
   * Stops tracking and saves completed session summary.
   */
  public async stopTracking(): Promise<CompletedSessionMetrics> {
    this.stopInterval();

    const avgHeartRate =
      this.hrSamples.length > 0
        ? Math.round(
            this.hrSamples.reduce((a, b) => a + b, 0) / this.hrSamples.length
          )
        : this.state.heartRate;

    const maxHeartRate =
      this.hrSamples.length > 0 ? Math.max(...this.hrSamples) : this.state.heartRate;

    const minutes = Math.floor(this.state.elapsedSeconds / 60);
    const seconds = this.state.elapsedSeconds % 60;
    const durationFormatted =
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m ${seconds}s`;

    const summary: CompletedSessionMetrics = {
      sessionId: this.state.sessionId,
      sessionTitle: this.state.sessionTitle,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      durationFormatted,
      totalSeconds: this.state.elapsedSeconds,
      steps: this.state.steps,
      meters: this.state.meters,
      jumps: this.state.jumps,
      avgHeartRate,
      maxHeartRate,
      playerLoadAU: this.state.playerLoadAU,
      caloriesBurned: this.state.caloriesBurned,
      watchName: this.state.watchName,
      completedAt: new Date().toISOString(),
    };

    // Save to completed sessions history
    try {
      const raw = await AsyncStorage.getItem(STORAGE_COMPLETED_SESSIONS);
      const existing: CompletedSessionMetrics[] = raw ? JSON.parse(raw) : [];
      existing.unshift(summary);
      await AsyncStorage.setItem(
        STORAGE_COMPLETED_SESSIONS,
        JSON.stringify(existing.slice(0, 30))
      );
    } catch (err) {
      console.warn('[trackingService] Failed to save completed session:', err);
    }

    // Reset state
    this.state = { ...DEFAULT_STATE };
    this.hrSamples = [];
    await AsyncStorage.removeItem(STORAGE_ACTIVE_TRACKING);
    this.notify();

    return summary;
  }

  private startInterval() {
    this.stopInterval();
    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private stopInterval() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 1-second watchdog tick:
   * Smoothly advances the timer every second so the phone display never freezes.
   * Snaps to the watch's timer whenever live watch telemetry packets arrive.
   * NEVER generates simulated steps or distance—steps and meters strictly come from watch motion sensors!
   */
  private tick() {
    if (!this.state.isActive || this.state.isPaused) return;

    this.state.elapsedSeconds += 1;
    this.state.currentDrillSeconds += 1;
    this.notify();
  }
}

export const trackingService = new TrackingService();
