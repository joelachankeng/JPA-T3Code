// Catches edits made outside T3 Code; panel mutations and agent turns already push a
// refresh. Polls instead of watching: Linux adds an inotify watch per directory, and a
// repo with node_modules can exhaust max_user_watches. A warm `git status` costs tens
// of milliseconds, and the poll stops while the surface is off screen.
import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

const SCM_REFRESH_INTERVAL_MS = 5_000;
/**
 * A refresh that resolves faster than this never shows a spinner. Without the
 * gate the indicator would blink on every poll, which reads as the panel
 * flickering rather than as work happening.
 */
const INDICATOR_DELAY_MS = 150;

export function useScmAutoRefresh(input: {
  readonly enabled: boolean;
  readonly refresh: () => void;
  readonly intervalMs?: number;
}): void {
  // The callback changes every render; the interval should not restart with it.
  const refresh = useStableCallback(input.refresh);

  const interval = input.intervalMs ?? SCM_REFRESH_INTERVAL_MS;
  const enabled = input.enabled;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the poll timer and focus/visibility listeners while the surface is enabled
  useEffect(() => {
    if (!enabled) return;

    const refreshIfVisible = () => {
      // A hidden tab is not worth a git process, and browsers throttle the
      // timer there anyway.
      if (document.visibilityState !== "visible") return;
      refresh();
    };

    const timer = window.setInterval(refreshIfVisible, interval);
    // Coming back to the window is the moment the user is most likely to have
    // just changed something elsewhere, so it refreshes immediately.
    const onFocus = () => refreshIfVisible();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshIfVisible();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, interval, refresh]);
}

/**
 * Hold a flag on for a minimum time after `signal` changes.
 *
 * A refresh the user asked for usually finishes faster than the eye can catch,
 * and an indicator that never appears is the same as no indicator. This keeps
 * one up long enough to register, without holding the UI back.
 */
export function useMinimumVisible(signal: number, durationMs = 450): boolean {
  // Which signal has already run its course. Visibility is derived from the
  // comparison rather than assigned, so the effect only ever writes on a timer.
  const [expiredSignal, setExpiredSignal] = useState(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a timer that expires the indicator after its minimum duration
  useEffect(() => {
    // Zero is the initial value, not a refresh anyone asked for.
    if (signal === 0) return;
    const timer = window.setTimeout(() => setExpiredSignal(signal), durationMs);
    return () => window.clearTimeout(timer);
  }, [signal, durationMs]);

  return signal !== 0 && expiredSignal !== signal;
}

/**
 * True once `active` has held for long enough to be worth showing. Used so a
 * fast background poll stays invisible while a slow one reports itself.
 */
export function useDelayedFlag(active: boolean, delayMs = INDICATOR_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  if (!active && shown) setShown(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the timer that reveals the indicator once `active` has lasted `delayMs`
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return active && shown;
}
