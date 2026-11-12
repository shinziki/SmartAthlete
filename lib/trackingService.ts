import AsyncStorage from '@react-native-async-storage/async-storage';
import { DbSession, SessionDrill, saveCompletedSessionMetrics } from './sessionService';
import {
  DrillCategory,
  MetricType,
  getDrillTargetMetrics,
} from '@/constants/regimes';
import { SensorProfile } from '@/constants/sensorProfiles';
import { computeSessionLoadAU } from './workload';

// ─── Types ────────────────────────────────────────────────────

export interface DrillLiveMetrics {
  drillIndex: number;
  drillId: string;
  drillName: string;
  category: SessionDrill['category'];
  targetMetrics: MetricType[];
  seconds: number;
  steps: number;
  meters: number;
  jumps: number;
  heartRate: number;
  startHeartRate: number;
  peakHeartRate: number;
  avgHeartRate: number;
  playerLoadAU: number;
  hrRecoveryDrop: number;
}

export interface CompletedDrillMetrics {
  drillIndex: number;
  drillId: string;
  drillName: string;
  category: SessionDrill['category'];
  targetMetrics: MetricType[];
  durationFormatted: string;
  totalSeconds: number;
  steps: number;
  meters: number;
  jumps: number;
  avgHeartRate: number;
  maxHeartRate: number;
  playerLoadAU: number;
  hrRecoveryDrop: number;
}

export interface LiveTrackingState {
  isActive: boolean;
  isPaused: boolean;
  sessionId: string | number;
  sessionTitle: string;
  athleteId?: number;
  athleteName?: string;
  watchName: string;
  isWatchConnected: boolean;
  isWatchOnWrist: boolean;
  isMoving: boolean;

  // Session-wide cumulative telemetry
  elapsedSeconds: number;
  steps: number;
  meters: number;
  jumps: number;
  heartRate: number;
  playerLoadAU: number;
  caloriesBurned: number;
  /** Live speed (km/h) and cadence (spm) reported by the watch; null until it reports them */
  speedKmh: number | null;
  cadenceSpm: number | null;
  /** Sensor profile the watch confirmed it is running for the current workout */
  watchSensorProfile: SensorProfile | null;
  /** Token sent to the watch with START_SESSION; telemetry from any other run is ignored */
  watchSessionId: string | null;

  // Regime-specific segmented drill tracking
  drills: SessionDrill[];
  currentDrillIndex: number;
  currentDrillSeconds: number;
  activeDrillMetrics: DrillLiveMetrics;
  completedDrills: CompletedDrillMetrics[];

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
  /** Session Load (AU) = sessionRpe × duration (min) when RPE is given, else sensor-derived load */
  playerLoadAU: number;
  /** Session RPE on the CR-10 scale, null if not provided */
  sessionRpe?: number | null;
  /** Sensor-derived load kept for reference */
  sensorLoadAU?: number;
  caloriesBurned: number;
  watchName: string;
  completedAt: string;
  drillBreakdown: CompletedDrillMetrics[];
}

const STORAGE_ACTIVE_TRACKING = '@smartathlete_active_tracking_v1';
const STORAGE_COMPLETED_SESSIONS = '@smartathlete_completed_sessions_v1';

// ─── Initial State ────────────────────────────────────────────

const DEFAULT_DRILL_METRICS: DrillLiveMetrics = {
  drillIndex: 0,
  drillId: 'drill-0',
  drillName: 'Open Regime',
  category: 'Tactics',
  targetMetrics: ['heartRate', 'steps', 'distance', 'playerLoad'],
  seconds: 0,
  steps: 0,
  meters: 0,
  jumps: 0,
  heartRate: 0,
  startHeartRate: 0,
  peakHeartRate: 0,
  avgHeartRate: 0,
  playerLoadAU: 0,
  hrRecoveryDrop: 0,
};

const DEFAULT_STATE: LiveTrackingState = {
  isActive: false,
  isPaused: false,
  sessionId: '',
  sessionTitle: 'Training Session',
  athleteId: undefined,
  athleteName: undefined,
  watchName: 'Wear OS Smartwatch',
  isWatchConnected: true,
  isWatchOnWrist: true,
  isMoving: false,

  elapsedSeconds: 0,
  steps: 0,
  meters: 0,
  jumps: 0,
  heartRate: 0,
  playerLoadAU: 0,
  caloriesBurned: 0,
  speedKmh: null,
  cadenceSpm: null,
  watchSensorProfile: null,
  watchSessionId: null,

  drills: [],
  currentDrillIndex: 0,
  currentDrillSeconds: 0,
  activeDrillMetrics: { ...DEFAULT_DRILL_METRICS },
  completedDrills: [],

  startedAt: '',
  lastUpdatedAt: '',
};

// ─── Heart-rate running stats ─────────────────────────────────

/** Average and peak of valid (> 30 bpm) readings, in O(1) per reading. */
class HrStats {
  private count = 0;
  private sum = 0;
  peak = 0;

  constructor(first?: number) {
    if (first !== undefined) this.add(first);
  }

  add(bpm: number) {
    if (bpm <= 30) return;
    this.count += 1;
    this.sum += bpm;
    if (bpm > this.peak) this.peak = bpm;
  }

  get hasReadings(): boolean {
    return this.count > 0;
  }

  get average(): number {
    return this.count > 0 ? Math.round(this.sum / this.count) : 0;
  }
}

// ─── Service Class ────────────────────────────────────────────

class TrackingService {
  private state: LiveTrackingState = { ...DEFAULT_STATE };
  private timer: any = null;
  private listeners: Array<(state: LiveTrackingState) => void> = [];
  private hrStats = new HrStats();
  private lastWatchUpdateTimestamp: number = 0;
  private persistTimeout: any = null;

  // Regime delta tracking baselines
  private drillBaselineSteps: number = 0;
  private drillBaselineMeters: number = 0;
  private drillBaselineJumps: number = 0;
  private drillBaselineLoad: number = 0;
  private drillBaselineSecs: number = 0;
  private drillStartHr: number = 0;
  private drillHrStats = new HrStats();

  // When true, jumps come from the phone accelerometer instead of the watch
  private phoneJumpDetection: boolean = false;

  // True once the watch streams its own accelerometer PlayerLoad
  private hasWatchLoad: boolean = false;

  // When the phone last changed drill; telemetry already in flight still carries the
  // old drill index and must not drag the phone (and the watch's sensors) back.
  private localDrillChangeAt: number = 0;

  /** Rough load estimate for watches that don't stream accelerometer load. */
  private estimateLoad(): number {
    const load =
      this.state.steps * 0.08 +
      this.state.jumps * 0.4 +
      (this.state.heartRate > 140 ? 0.2 : 0.02);
    return Math.round(load * 10) / 10;
  }

  constructor() {
    this.restoreFromStorage();
  }

  private async restoreFromStorage() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_TRACKING);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.isActive) {
          this.state = {
            ...DEFAULT_STATE,
            ...parsed,
            activeDrillMetrics: parsed.activeDrillMetrics || { ...DEFAULT_DRILL_METRICS },
            completedDrills: parsed.completedDrills || [],
          };
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

  private schedulePersist() {
    if (this.persistTimeout) return;
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      this.persistActiveState();
    }, 2500);
  }

  private async persistActiveState() {
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
      this.persistTimeout = null;
    }
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
   * Recalculates metrics isolated to the currently active drill/regime.
   */
  private recalculateActiveDrillMetrics() {
    const currentDrill =
      this.state.drills.length > 0 && this.state.drills[this.state.currentDrillIndex]
        ? this.state.drills[this.state.currentDrillIndex]
        : null;

    const drillSteps = Math.max(0, this.state.steps - this.drillBaselineSteps);
    const drillMeters = Math.max(
      0,
      Math.round((this.state.meters - this.drillBaselineMeters) * 10) / 10
    );
    const drillJumps = Math.max(0, this.state.jumps - this.drillBaselineJumps);
    const drillLoad = Math.max(
      0,
      Math.round((this.state.playerLoadAU - this.drillBaselineLoad) * 10) / 10
    );

    const currentHr = this.state.heartRate > 30 ? this.state.heartRate : 0;
    const avgHr = this.drillHrStats.hasReadings ? this.drillHrStats.average : currentHr;
    const peakHr = this.drillHrStats.hasReadings ? this.drillHrStats.peak : currentHr;

    const recoveryDrop = Math.max(0, peakHr - (this.state.heartRate > 30 ? this.state.heartRate : 0));
    const targetMetrics = getDrillTargetMetrics(currentDrill);

    this.state.activeDrillMetrics = {
      drillIndex: this.state.currentDrillIndex,
      drillId: currentDrill?.id || `drill-${this.state.currentDrillIndex}`,
      drillName: currentDrill?.name || this.state.sessionTitle,
      category: currentDrill?.category || 'Tactics',
      targetMetrics,
      seconds: this.state.currentDrillSeconds,
      steps: drillSteps,
      meters: drillMeters,
      jumps: drillJumps,
      heartRate: this.state.heartRate,
      startHeartRate: this.drillStartHr,
      peakHeartRate: peakHr,
      avgHeartRate: avgHr,
      playerLoadAU: drillLoad,
      hrRecoveryDrop: recoveryDrop,
    };
  }

  /**
   * Captures a finalized summary for a drill that just finished.
   */
  private snapshotDrill(drillIndex: number): CompletedDrillMetrics {
    const drill =
      this.state.drills.length > drillIndex ? this.state.drills[drillIndex] : null;

    const totalSecs = this.state.currentDrillSeconds;
    const minutes = Math.floor(totalSecs / 60);
    const seconds = totalSecs % 60;
    const durationFormatted = `${minutes}m ${seconds}s`;

    const metrics = this.state.activeDrillMetrics;

    return {
      drillIndex,
      drillId: drill?.id || `drill-${drillIndex}`,
      drillName: drill?.name || `Drill ${drillIndex + 1}`,
      category: drill?.category || 'Tactics',
      targetMetrics: getDrillTargetMetrics(drill),
      durationFormatted,
      totalSeconds: totalSecs,
      steps: metrics.steps,
      meters: metrics.meters,
      jumps: metrics.jumps,
      avgHeartRate: metrics.avgHeartRate,
      maxHeartRate: metrics.peakHeartRate,
      playerLoadAU: metrics.playerLoadAU,
      hrRecoveryDrop: metrics.hrRecoveryDrop,
    };
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
      // Upgrade a placeholder live session to the real session without resetting metrics
      if (session && (!this.state.sessionId || this.state.sessionId === 'live_session')) {
        this.state.sessionId = session.id;
        this.state.sessionTitle = session.title;
        this.state.drills = session.drills || [];
        if (athleteId) this.state.athleteId = athleteId;
        if (athleteName) this.state.athleteName = athleteName;
        if (watchName) this.state.watchName = watchName;
        this.recalculateActiveDrillMetrics();
        this.persistActiveState();
        this.notify();
      }
      if (this.state.isPaused) {
        this.resumeTracking();
      }
      return;
    }

    this.beginFresh(session, athleteId, athleteName, watchName, null);
  }

  /**
   * Starts a brand-new run (the athlete started a session on the watch).
   * Anything left from an earlier run — e.g. a session stopped mid-way whose RPE
   * was never submitted — is saved without RPE and cleared first, so its clock
   * and totals can't leak into the new session.
   */
  public startNewSession(
    session: DbSession | null,
    athleteId?: number,
    athleteName?: string,
    watchName?: string,
    watchSessionId?: string
  ) {
    if (this.state.isActive) {
      if (this.state.elapsedSeconds > 0) {
        // stopTracking resets state synchronously before its async saves
        void this.stopTracking(null);
      } else {
        this.stopInterval();
        this.state = { ...DEFAULT_STATE };
      }
    }
    this.beginFresh(session, athleteId, athleteName, watchName, watchSessionId ?? null);
  }

  private beginFresh(
    session: DbSession | null,
    athleteId: number | undefined,
    athleteName: string | undefined,
    watchName: string | undefined,
    watchSessionId: string | null
  ) {
    const now = new Date().toISOString();
    const drills = session?.drills || [];

    this.drillBaselineSteps = 0;
    this.drillBaselineMeters = 0;
    this.drillBaselineJumps = 0;
    this.drillBaselineLoad = 0;
    this.drillBaselineSecs = 0;
    this.drillStartHr = 0;
    this.drillHrStats = new HrStats();

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
      isWatchOnWrist: true,
      drills,
      currentDrillIndex: 0,
      currentDrillSeconds: 0,
      activeDrillMetrics: { ...DEFAULT_DRILL_METRICS },
      completedDrills: [],
      startedAt: now,
      lastUpdatedAt: now,
      heartRate: 0,
      steps: 0,
      meters: 0,
      jumps: 0,
      isMoving: false,
      watchSessionId,
    };

    this.recalculateActiveDrillMetrics();
    this.hrStats = new HrStats();
    this.hasWatchLoad = false;
    this.localDrillChangeAt = 0;
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
      // Snapshot the finished drill
      const completed = this.snapshotDrill(this.state.currentDrillIndex);
      this.state.completedDrills = [
        ...this.state.completedDrills.filter((d) => d.drillIndex !== completed.drillIndex),
        completed,
      ];

      this.state.currentDrillIndex += 1;
      this.state.currentDrillSeconds = 0;
      this.localDrillChangeAt = Date.now();

      // Reset baseline for the newly active drill
      this.drillBaselineSteps = this.state.steps;
      this.drillBaselineMeters = this.state.meters;
      this.drillBaselineJumps = this.state.jumps;
      this.drillBaselineLoad = this.state.playerLoadAU;
      this.drillBaselineSecs = this.state.elapsedSeconds;
      this.drillStartHr = this.state.heartRate > 30 ? this.state.heartRate : 0;
      this.drillHrStats = new HrStats(this.state.heartRate);

      this.recalculateActiveDrillMetrics();
      this.persistActiveState();
      this.notify();
    }
  }

  public prevDrill() {
    if (!this.state.isActive) return;
    if (this.state.currentDrillIndex > 0) {
      this.state.currentDrillIndex -= 1;
      this.state.currentDrillSeconds = 0;
      this.localDrillChangeAt = Date.now();

      this.drillBaselineSteps = this.state.steps;
      this.drillBaselineMeters = this.state.meters;
      this.drillBaselineJumps = this.state.jumps;
      this.drillBaselineLoad = this.state.playerLoadAU;
      this.drillBaselineSecs = this.state.elapsedSeconds;
      this.drillStartHr = this.state.heartRate > 30 ? this.state.heartRate : 0;
      this.drillHrStats = new HrStats(this.state.heartRate);

      this.recalculateActiveDrillMetrics();
      this.persistActiveState();
      this.notify();
    }
  }

  /** Enable/disable the phone accelerometer as the authoritative jump source. */
  public setPhoneJumpDetection(enabled: boolean) {
    this.phoneJumpDetection = enabled;
  }

  /** Registers a single jump detected by the phone's accelerometer. */
  public addPhoneJump() {
    if (!this.state.isActive || this.state.isPaused || !this.phoneJumpDetection) return;
    this.state.jumps += 1;
    if (!this.hasWatchLoad) this.state.playerLoadAU = this.estimateLoad();
    this.recalculateActiveDrillMetrics();
    this.state.lastUpdatedAt = new Date().toISOString();
    this.schedulePersist();
    this.notify();
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
    bpm?: number;
    moving?: boolean;
    paused?: boolean;
    drill?: number;
    onBody?: boolean;
    load?: number;
    speed?: number;
    cadence?: number;
    profile?: SensorProfile;
  }) {
    if (!this.state.isActive) return;

    this.lastWatchUpdateTimestamp = Date.now();

    const incomingHr =
      typeof data.heartRate === 'number' && !isNaN(data.heartRate)
        ? data.heartRate
        : typeof data.bpm === 'number' && !isNaN(data.bpm)
        ? data.bpm
        : undefined;

    // Sync on-body wrist contact state:
    // If incoming heart rate > 30, that is incontrovertible physical proof of skin contact!
    // Active walking/running steps also confirm the watch is worn.
    if (incomingHr !== undefined && incomingHr > 30) {
      this.state.isWatchOnWrist = true;
    } else if (typeof data.steps === 'number' && data.steps > this.state.steps && data.moving) {
      this.state.isWatchOnWrist = true;
    } else if (data.onBody !== undefined) {
      this.state.isWatchOnWrist = data.onBody;
    } else if (incomingHr !== undefined) {
      this.state.isWatchOnWrist = incomingHr > 30;
    }

    // Drill sync
    const watchCaughtUp = Date.now() - this.localDrillChangeAt > 3000;
    if (watchCaughtUp && data.drill !== undefined && data.drill !== this.state.currentDrillIndex) {
      if (data.drill < this.state.drills.length) {
        const completed = this.snapshotDrill(this.state.currentDrillIndex);
        this.state.completedDrills = [
          ...this.state.completedDrills.filter((d) => d.drillIndex !== completed.drillIndex),
          completed,
        ];

        this.state.currentDrillIndex = data.drill;
        this.state.currentDrillSeconds = 0;
        this.drillBaselineSteps = this.state.steps;
        this.drillBaselineMeters = this.state.meters;
        this.drillBaselineJumps = this.state.jumps;
        this.drillBaselineLoad = this.state.playerLoadAU;
        this.drillBaselineSecs = typeof data.secs === 'number' ? data.secs : this.state.elapsedSeconds;
        this.drillStartHr = this.state.heartRate > 30 ? this.state.heartRate : 0;
        this.drillHrStats = new HrStats(this.state.heartRate);
      }
    }

    // Authoritative clock sync from watch:
    // If the watch broadcasts secs, slave elapsedSeconds & currentDrillSeconds directly to it!
    if (typeof data.secs === 'number' && !isNaN(data.secs)) {
      this.state.elapsedSeconds = data.secs;
      this.state.currentDrillSeconds = Math.max(0, data.secs - this.drillBaselineSecs);
    }

    // When watch is NOT worn on the wrist (holding strap, resting on table, or no skin contact):
    // 1. Force isMoving = false
    // 2. Clear heart rate (0 BPM)
    // 3. Reject/freeze step and meter accumulation so fake/rogue steps cannot run!
    if (!this.state.isWatchOnWrist) {
      this.state.isMoving = false;
      this.state.heartRate = 0;
    } else {
      if (typeof incomingHr === 'number' && incomingHr > 30) {
        this.state.heartRate = incomingHr;
        this.hrStats.add(incomingHr);
        this.drillHrStats.add(incomingHr);
      }
      if (typeof data.steps === 'number' && !isNaN(data.steps)) {
        this.state.steps = data.steps;
      }
      if (typeof data.meters === 'number' && !isNaN(data.meters)) {
        this.state.meters = data.meters;
      }
      if (!this.phoneJumpDetection && typeof data.jumps === 'number' && !isNaN(data.jumps)) {
        this.state.jumps = data.jumps;
      }
      if (data.moving !== undefined) {
        this.state.isMoving = data.moving;
      }
      if (typeof data.load === 'number') {
        this.hasWatchLoad = true;
        this.state.playerLoadAU = Math.round(data.load * 10) / 10;
      }
      if (typeof data.speed === 'number') this.state.speedKmh = data.speed;
      if (typeof data.cadence === 'number') this.state.cadenceSpm = data.cadence;
    }
    if (data.profile) this.state.watchSensorProfile = data.profile;

    if (!this.hasWatchLoad) this.state.playerLoadAU = this.estimateLoad();
    this.state.caloriesBurned = Math.round(this.state.steps * 0.052);

    this.recalculateActiveDrillMetrics();
    this.state.isWatchConnected = true;
    this.state.lastUpdatedAt = new Date().toISOString();
    this.schedulePersist();
    this.notify();
  }

  /**
   * Stops tracking and saves completed session summary with drill-by-drill breakdown.
   */
  public async stopTracking(rpe?: number | null): Promise<CompletedSessionMetrics> {
    this.stopInterval();

    // Snapshot the last active drill if applicable
    if (this.state.drills.length > 0) {
      const finalDrill = this.snapshotDrill(this.state.currentDrillIndex);
      this.state.completedDrills = [
        ...this.state.completedDrills.filter((d) => d.drillIndex !== finalDrill.drillIndex),
        finalDrill,
      ];
    }

    const currentHr = this.state.heartRate > 30 ? this.state.heartRate : 0;
    const avgHeartRate = this.hrStats.hasReadings ? this.hrStats.average : currentHr;
    const maxHeartRate = this.hrStats.hasReadings ? this.hrStats.peak : currentHr;

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
      playerLoadAU:
        rpe != null
          ? computeSessionLoadAU(rpe, this.state.elapsedSeconds / 60)
          : this.state.playerLoadAU,
      sessionRpe: rpe ?? null,
      sensorLoadAU: this.state.playerLoadAU,
      caloriesBurned: this.state.caloriesBurned,
      watchName: this.state.watchName,
      completedAt: new Date().toISOString(),
      drillBreakdown: [...this.state.completedDrills],
    };

    // Reset before any await so a new session can start immediately
    // without this run's saves overwriting it
    const athleteId = this.state.athleteId;
    this.state = { ...DEFAULT_STATE };
    this.hrStats = new HrStats();
    this.drillHrStats = new HrStats();
    this.hasWatchLoad = false;
    this.notify();

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

    // Save to database (including Player Load AU)
    try {
      await saveCompletedSessionMetrics(summary, athleteId);
    } catch (err) {
      console.warn('[trackingService] Failed to save session metrics to DB:', err);
    }

    // Clears the stored run, or stores the new one if a session already started
    await this.persistActiveState();

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

  private tick() {
    if (!this.state.isActive || this.state.isPaused) return;

    // If watch is actively broadcasting live telemetry, watch data.secs is the master clock.
    // Only tick locally as a fallback if watch has stopped streaming for > 2000ms.
    const isWatchStreamingClock = Date.now() - this.lastWatchUpdateTimestamp < 2000;
    if (!isWatchStreamingClock) {
      this.state.elapsedSeconds += 1;
      this.state.currentDrillSeconds += 1;
      this.recalculateActiveDrillMetrics();
      this.notify();
    }
  }
}

export const trackingService = new TrackingService();
