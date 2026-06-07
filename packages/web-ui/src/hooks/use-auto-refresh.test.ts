import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoRefreshTicker, getBackoffDelay, useAutoRefresh } from './use-auto-refresh';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function AutoRefreshProbe({ onTick }: { onTick: () => void | Promise<void> }) {
  useAutoRefresh({ intervalMs: 5000, enabled: true, onTick });
  return null;
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

describe('createAutoRefreshTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
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

  it('does not overlap ticks while an async onTick is still running', async () => {
    let resolveTick: () => void = () => {
      throw new Error('expected the first tick to be pending');
    };
    const onTick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTick = resolve;
        }),
    );
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(1);

    resolveTick();
    await flushPromises();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('backs off after failures and resets to the base interval after success', async () => {
    const onTick = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const ticker = createAutoRefreshTicker({ intervalMs: 5000, onTick });
    ticker.start();

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
    await flushPromises();

    vi.advanceTimersByTime(9999);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(2);
    await flushPromises();

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });
});

describe('getBackoffDelay', () => {
  it('caps exponential backoff at 30 seconds', () => {
    expect(getBackoffDelay(5000, 0)).toBe(5000);
    expect(getBackoffDelay(5000, 1)).toBe(10_000);
    expect(getBackoffDelay(5000, 2)).toBe(20_000);
    expect(getBackoffDelay(5000, 3)).toBe(30_000);
  });
});

describe('useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    setDocumentHidden(false);
  });

  it('pauses while hidden and ticks immediately when visible again', () => {
    const onTick = vi.fn();
    render(createElement(AutoRefreshProbe, { onTick }));
    expect(onTick).toHaveBeenCalledTimes(1);

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(60_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);

    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});
