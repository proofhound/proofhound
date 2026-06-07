'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoRefreshInterval = number | false;

export interface UseAutoRefreshOptions {
  intervalMs?: AutoRefreshInterval;
  enabled: boolean;
  onTick: () => void | Promise<void>;
  trackCountdown?: boolean;
}

export interface UseAutoRefreshReturn {
  countdownMs: number;
  refreshNow: () => void;
}

export interface AutoRefreshTickerOptions {
  intervalMs: number;
  onTick: () => void | Promise<void>;
  setTimeoutImpl?: (callback: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  now?: () => number;
}

export interface AutoRefreshTicker {
  start(): void;
  stop(): void;
  tickNow(): void;
  remainingMs(): number;
  isRunning(): boolean;
}

export function getBackoffDelay(baseMs: number, failureCount: number) {
  const intervalMs = Math.max(0, baseMs);
  if (failureCount <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** failureCount, 30_000);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createAutoRefreshTicker(options: AutoRefreshTickerOptions): AutoRefreshTicker {
  const intervalMs = Math.max(0, options.intervalMs);
  const setTimeoutFn = options.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn = options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());

  let handle: unknown = null;
  let nextTickAt: number | null = null;
  let running = false;
  let inFlight = false;
  let failureCount = 0;

  const schedule = (delayMs = getBackoffDelay(intervalMs, failureCount)) => {
    const nextDelayMs = Math.max(0, delayMs);
    nextTickAt = now() + nextDelayMs;
    handle = setTimeoutFn(() => {
      handle = null;
      void runTick();
    }, nextDelayMs);
  };

  const cancel = () => {
    if (handle !== null) {
      clearTimeoutFn(handle);
      handle = null;
    }
    nextTickAt = null;
  };

  const runTick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = options.onTick();
      if (isPromiseLike(result)) await result;
      failureCount = 0;
    } catch {
      failureCount += 1;
    } finally {
      inFlight = false;
      if (running) schedule();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      cancel();
    },
    tickNow() {
      cancel();
      void runTick();
    },
    remainingMs() {
      if (nextTickAt === null) return intervalMs;
      return Math.max(0, nextTickAt - now());
    },
    isRunning() {
      return running;
    },
  };
}

const COUNTDOWN_FRAME_MS = 250;
export const AUTO_REFRESH_INTERVAL_MS = 5_000;

export function useAutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  enabled,
  onTick,
  trackCountdown = false,
}: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const effectiveIntervalMs = intervalMs === false ? AUTO_REFRESH_INTERVAL_MS : intervalMs;
  const shouldRun = enabled && intervalMs !== false;
  const [countdownMs, setCountdownMs] = useState(effectiveIntervalMs);
  const onTickRef = useRef(onTick);
  const tickerRef = useRef<AutoRefreshTicker | null>(null);
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      clearTimeout(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startFrame = useCallback(() => {
    stopFrame();
    const loop = () => {
      const ticker = tickerRef.current;
      if (!ticker || !ticker.isRunning()) {
        frameRef.current = null;
        return;
      }
      setCountdownMs(ticker.remainingMs());
      frameRef.current = setTimeout(loop, COUNTDOWN_FRAME_MS);
    };
    loop();
  }, [stopFrame]);

  useEffect(() => {
    const ticker = createAutoRefreshTicker({
      intervalMs: effectiveIntervalMs,
      onTick: () => onTickRef.current(),
    });
    tickerRef.current = ticker;

    if (shouldRun) {
      ticker.start();
      ticker.tickNow();
      if (trackCountdown) {
        setCountdownMs(ticker.remainingMs());
        startFrame();
      }
    } else {
      if (trackCountdown) setCountdownMs(effectiveIntervalMs);
    }

    return () => {
      ticker.stop();
      stopFrame();
      tickerRef.current = null;
    };
  }, [effectiveIntervalMs, shouldRun, startFrame, stopFrame, trackCountdown]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handle = () => {
      const ticker = tickerRef.current;
      if (!ticker) return;
      if (document.hidden) {
        ticker.stop();
        stopFrame();
      } else if (shouldRun) {
        ticker.start();
        ticker.tickNow();
        if (trackCountdown) {
          setCountdownMs(ticker.remainingMs());
          startFrame();
        }
      }
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, [shouldRun, startFrame, stopFrame, trackCountdown]);

  const refreshNow = useCallback(() => {
    const ticker = tickerRef.current;
    if (!ticker) return;
    ticker.tickNow();
    if (trackCountdown) {
      setCountdownMs(ticker.remainingMs());
      if (ticker.isRunning()) startFrame();
    }
  }, [startFrame, trackCountdown]);

  return { countdownMs, refreshNow };
}
