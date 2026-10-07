import { useEffect, useRef, useState } from 'react';
import { api, type BoardState } from './api';
import { storyNow } from './storyTime';

/** Poll the live care board; only updates when the state actually changes. */
export function useBoard(intervalMs = 4000) {
  const [state, setState] = useState<BoardState | null>(null);
  const [online, setOnline] = useState(true);
  const fingerprint = useRef('');
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.state(storyNow());
        if (!alive) return;
        const fp = JSON.stringify([s.gaps, s.obligations, s.offers, s.notifications, s.schedule, s.members, s.household]);
        setOnline(true);
        if (fp !== fingerprint.current) { fingerprint.current = fp; setState(s); }
      } catch {
        if (alive) setOnline(false);
      }
    };
    refreshRef.current = () => void tick();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  /** Read again now, after this surface changed the record itself. */
  const refresh = () => refreshRef.current();
  return { state, online, refresh };
}
