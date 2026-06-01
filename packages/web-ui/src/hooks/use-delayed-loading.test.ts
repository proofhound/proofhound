import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDelayedLoadingController } from './use-delayed-loading';

describe('createDelayedLoadingController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(delay = 300, minDuration = 300) {
    const changes: boolean[] = [];
    const controller = createDelayedLoadingController({
      delay,
      minDuration,
      onVisibleChange: (visible) => changes.push(visible),
    });
    return { controller, changes };
  }

  it('never shows when loading resolves faster than the delay', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);
    vi.advanceTimersByTime(100);
    controller.setLoading(false);

    vi.advanceTimersByTime(1000);
    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('shows only after the delay elapses while loading persists', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);

    vi.advanceTimersByTime(299);
    expect(controller.isVisible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(controller.isVisible()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('keeps the indicator visible for at least minDuration', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);
    vi.advanceTimersByTime(300); // shown at t=300

    vi.advanceTimersByTime(50); // t=350
    controller.setLoading(false); // only visible for 50ms, must hold
    expect(controller.isVisible()).toBe(true);

    vi.advanceTimersByTime(249); // t=599
    expect(controller.isVisible()).toBe(true);

    vi.advanceTimersByTime(1); // t=600, a full 300ms after shown
    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('hides right away when minDuration has already passed', () => {
    const { controller } = setup();
    controller.setLoading(true);
    vi.advanceTimersByTime(300); // shown at t=300
    vi.advanceTimersByTime(500); // t=800, visible for 500ms > 300ms

    controller.setLoading(false);
    expect(controller.isVisible()).toBe(false);
  });

  it('reuses the visible state when loading restarts during the min-duration hold', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);
    vi.advanceTimersByTime(300); // visible at t=300
    vi.advanceTimersByTime(50);

    controller.setLoading(false); // would hide at t=600
    controller.setLoading(true); // cancels the hide, stays visible

    vi.advanceTimersByTime(1000);
    expect(controller.isVisible()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('ignores repeated setLoading(false) without scheduling duplicate hides', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(50);

    controller.setLoading(false);
    controller.setLoading(false);

    vi.advanceTimersByTime(250); // t=600
    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('dispose clears a pending show timer', () => {
    const { controller, changes } = setup();
    controller.setLoading(true);
    controller.dispose();

    vi.advanceTimersByTime(1000);
    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([]);
  });
});
