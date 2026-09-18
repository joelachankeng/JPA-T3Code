/**
 * Keeping the Source Control surface current.
 *
 * Changes arrive from three directions: this panel's own mutations, an agent
 * working in the thread, and the user editing in another editor entirely. The
 * first two already push a refresh. This covers the third.
 *
 * It polls rather than watching the repository directory. A recursive watch is
 * cheap on Windows and macOS, where the OS reports a whole tree from one
 * handle, but on Linux Node adds an inotify watch per directory, and a repo
 * with a `node_modules` can exhaust `max_user_watches` and fail the whole
 * subscription. A `git status` on a warm repository costs tens of milliseconds,
 * so a poll that stops whenever the surface is not on screen is the cheaper
 * trade for a remote-first app.
 */
import { useEffect, useRef, useState } from "react";

export const SCM_REFRESH_INTERVAL_MS = 5_000;
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
  const refreshRef = useRef(input.refresh);
  useEffect(() => {
    refreshRef.current = input.refresh;
  });

  const interval = input.intervalMs ?? SCM_REFRESH_INTERVAL_MS;
  const enabled = input.enabled;

  useEffect(() => {
    if (!enabled) return;

    const refreshIfVisible = () => {
      // A hidden tab is not worth a git process, and browsers throttle the
      // timer there anyway.
      if (document.visibilityState !== "visible") return;
      refreshRef.current();
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
  }, [enabled, interval]);
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

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}
