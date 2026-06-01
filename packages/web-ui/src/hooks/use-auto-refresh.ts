'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAutoRefreshOptions {
  intervalMs?: number;
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

export function createAutoRefreshTicker(options: AutoRefreshTickerOptions): AutoRefreshTicker {
  const intervalMs = Math.max(0, options.intervalMs);
  const setTimeoutFn = options.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn = options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());

  let handle: unknown = null;
  let nextTickAt: number | null = null;
  let running = false;

  const schedule = () => {
    nextTickAt = now() + intervalMs;
    handle = setTimeoutFn(() => {
      handle = null;
      void options.onTick();
      if (running) schedule();
    }, intervalMs);
  };

  const cancel = () => {
    if (handle !== null) {
      clearTimeoutFn(handle);
      handle = null;
    }
    nextTickAt = null;
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
      void options.onTick();
      if (running) schedule();
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
  const [countdownMs, setCountdownMs] = useState(intervalMs);
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
      intervalMs,
      onTick: () => onTickRef.current(),
    });
    tickerRef.current = ticker;

    if (enabled) {
      void onTickRef.current();
      ticker.start();
      if (trackCountdown) {
        setCountdownMs(ticker.remainingMs());
        startFrame();
      }
    } else {
      if (trackCountdown) setCountdownMs(intervalMs);
    }

    return () => {
      ticker.stop();
      stopFrame();
      tickerRef.current = null;
    };
  }, [enabled, intervalMs, startFrame, stopFrame, trackCountdown]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handle = () => {
      const ticker = tickerRef.current;
      if (!ticker) return;
      if (document.hidden) {
        ticker.stop();
        stopFrame();
      } else if (enabled) {
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
  }, [enabled, startFrame, stopFrame, trackCountdown]);

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
