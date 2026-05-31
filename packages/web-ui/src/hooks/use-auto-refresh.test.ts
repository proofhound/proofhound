import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoRefreshTicker } from './use-auto-refresh';

describe('createAutoRefreshTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call onTick before start', () => {
    const onTick = vi.fn();
    createAutoRefreshTicker({ intervalMs: 5000, onTick });
    vi.advanceTimersByTime(10_000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('calls onTick repeatedly every intervalMs after start', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('stop() halts further ticks and isRunning becomes false', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(ticker.isRunning()).toBe(true);

    ticker.stop();
    expect(ticker.isRunning()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('tickNow() triggers onTick immediately and resets the countdown', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();

    vi.advanceTimersByTime(2000);
    expect(ticker.remainingMs()).toBe(3000);
    expect(onTick).not.toHaveBeenCalled();

    ticker.tickNow();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(ticker.remainingMs()).toBe(5000);

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('tickNow() works while stopped without scheduling a new timer', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });

    ticker.tickNow();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(ticker.isRunning()).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('remainingMs() decreases as time advances and clamps to 0', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();

    expect(ticker.remainingMs()).toBe(5000);
    vi.advanceTimersByTime(1000);
    expect(ticker.remainingMs()).toBe(4000);
    vi.advanceTimersByTime(3500);
    expect(ticker.remainingMs()).toBe(500);
    vi.advanceTimersByTime(1000);
    // After interval fires, schedule restarts; remaining returns close to full interval.
    expect(ticker.remainingMs()).toBeGreaterThanOrEqual(4000);
  });

  it('start() is idempotent — calling twice does not double the timer', () => {
    const onTick = vi.fn();
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();
    ticker.start();

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
