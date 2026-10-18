import { useEffect, useRef, useState } from 'react';

// Lazy, guarded load: importing 'expo-sensors' eagerly touches every native
// sensor module (e.g. ExponentPedometer) and crashes builds that lack them.
let Accelerometer: typeof import('expo-sensors').Accelerometer | null = null;
try {
  Accelerometer = require('expo-sensors/build/Accelerometer').default;
} catch (err) {
  console.warn('[phoneJumpDetector] expo-sensors native module missing — rebuild the app.', err);
}

/**
 * Phone-based jump detector using the accelerometer (values in g).
 *
 * A real jump while holding the phone produces a distinctive pattern:
 *   1. Takeoff push  -> magnitude spikes above ~1.4g
 *   2. Flight phase  -> near free-fall, magnitude drops below ~0.45g
 *   3. Landing       -> sharp impact spike above ~1.8g
 *
 * Requiring the free-fall window followed by a landing impact filters out
 * shaking, walking and arm swings that fool wrist-based detection.
 */

const SAMPLE_INTERVAL_MS = 20; // 50 Hz
const FREEFALL_THRESHOLD_G = 0.45;
const MIN_FREEFALL_MS = 80; // ~3cm+ vertical jump
const MAX_FREEFALL_MS = 900;
const LANDING_THRESHOLD_G = 1.8;
const LANDING_WINDOW_MS = 400; // landing must follow free-fall quickly
const REFRACTORY_MS = 350; // ignore bounces right after a landing

export function usePhoneJumpDetector(enabled: boolean, onJump: () => void) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [lastMagnitude, setLastMagnitude] = useState(1);
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    if (!Accelerometer) {
      setAvailable(false);
      return;
    }
    Accelerometer.isAvailableAsync()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (!enabled || !available || !Accelerometer) return;

    let freefallStart = 0;
    let freefallEnd = 0;
    let lastJumpAt = 0;
    let uiTick = 0;

    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      const mag = Math.sqrt(x * x + y * y + z * z);

      if (++uiTick % 10 === 0) setLastMagnitude(mag);
      if (now - lastJumpAt < REFRACTORY_MS) return;

      if (mag < FREEFALL_THRESHOLD_G) {
        if (!freefallStart) freefallStart = now;
        freefallEnd = now;
        return;
      }

      if (freefallStart) {
        const flight = freefallEnd - freefallStart;
        const sinceFlight = now - freefallEnd;

        if (flight > MAX_FREEFALL_MS || sinceFlight > LANDING_WINDOW_MS) {
          // Dropped phone or no landing in time -> discard
          freefallStart = 0;
          return;
        }

        if (mag > LANDING_THRESHOLD_G) {
          if (flight >= MIN_FREEFALL_MS) {
            lastJumpAt = now;
            onJumpRef.current();
          }
          freefallStart = 0;
        }
      }
    });

    return () => sub.remove();
  }, [enabled, available]);

  return { available, lastMagnitude };
}
