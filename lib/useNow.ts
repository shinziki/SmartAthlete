import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` while `active` (for countdowns). */
export function useNow(intervalMs: number = 1000, active: boolean = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
