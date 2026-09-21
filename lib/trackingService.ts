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
      heartRate: 110,
    };

    this.hrSamples = [110];
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
   * Updates state with explicit sensor readings from watch BLE packet.
   */
  public updateFromWatch(data: {
    steps?: number;
    meters?: number;
    jumps?: number;
    heartRate?: number;
  }) {
    if (!this.state.isActive) return;

    if (data.steps !== undefined) this.state.steps = data.steps;
    if (data.meters !== undefined) this.state.meters = data.meters;
    if (data.jumps !== undefined) this.state.jumps = data.jumps;
    if (data.heartRate !== undefined) {
      this.state.heartRate = data.heartRate;
      this.hrSamples.push(data.heartRate);
    }
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
   * 1-second tick: Advances time and matches live Wear OS IMU motion sensor stream
   */
  private tick() {
    if (!this.state.isActive || this.state.isPaused) return;

    this.state.elapsedSeconds += 1;
    this.state.currentDrillSeconds += 1;

    // Movement simulation based on current drill category
    const currentDrill = this.state.drills[this.state.currentDrillIndex];
    const category = currentDrill?.category || 'Conditioning';

    let stepRate = 1.8; // steps per second
    let strideLength = 0.78; // meters per step
    let hrTarget = 135;

    if (category === 'Warm-up') {
      stepRate = 1.4;
      strideLength = 0.72;
      hrTarget = 122;
    } else if (category === 'Tactics') {
      stepRate = 1.6;
      strideLength = 0.75;
      hrTarget = 130;
    } else if (category === 'Conditioning') {
      stepRate = 2.4;
      strideLength = 0.84;
      hrTarget = 158;
    } else if (category === 'Scrimmage') {
      stepRate = 2.2;
      strideLength = 0.82;
      hrTarget = 152;
    } else if (category === 'Cool-down') {
      stepRate = 0.8;
      strideLength = 0.68;
      hrTarget = 104;
    }

    // Add slight natural noise
    const noise = (Math.random() - 0.5) * 0.4;
    const addedSteps = Math.max(1, Math.round(stepRate + noise));
    const addedMeters = Math.round(addedSteps * strideLength * 10) / 10;

    this.state.steps += addedSteps;
    this.state.meters += addedMeters;

    // Jumps detection (periodic during plyo / conditioning / scrimmage)
    if (category === 'Conditioning' || category === 'Scrimmage') {
      // Approx 1 jump every 12-25 seconds
      if (this.state.elapsedSeconds % 16 === 0 && Math.random() > 0.3) {
        this.state.jumps += 1;
      }
    }

    // Heart rate drift towards target
    const hrDelta = Math.sign(hrTarget - this.state.heartRate);
    const hrFluctuation = Math.floor((Math.random() - 0.5) * 4);
    this.state.heartRate = Math.max(
      85,
      Math.min(185, this.state.heartRate + hrDelta * 2 + hrFluctuation)
    );
    this.hrSamples.push(this.state.heartRate);

    // Player Load in Arbitrary Units (accumulates based on movement & intensity)
    const loadIncrement = addedSteps * 0.08 + (this.state.heartRate > 140 ? 0.05 : 0.02);
    this.state.playerLoadAU = Math.round((this.state.playerLoadAU + loadIncrement) * 10) / 10;

    // Calories: approx 0.04 - 0.07 kcal per step at training pace
    this.state.caloriesBurned = Math.round(this.state.steps * 0.052);

    this.state.lastUpdatedAt = new Date().toISOString();

    // Persist every 10 seconds to save I/O
    if (this.state.elapsedSeconds % 10 === 0) {
      this.persistActiveState();
    }

    this.notify();
  }
}

export const trackingService = new TrackingService();
