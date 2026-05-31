'use client';

import { useEffect, useRef, useState } from 'react';

export const DEFAULT_LOADING_DELAY_MS = 300;
export const DEFAULT_LOADING_MIN_DURATION_MS = 300;

export interface UseDelayedLoadingOptions {
  delay?: number;
  minDuration?: number;
}

export interface DelayedLoadingControllerOptions extends Required<UseDelayedLoadingOptions> {
  onVisibleChange: (visible: boolean) => void;
  setTimeoutImpl?: (callback: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  now?: () => number;
}

export interface DelayedLoadingController {
  setLoading(loading: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}

export function createDelayedLoadingController(
  options: DelayedLoadingControllerOptions,
): DelayedLoadingController {
  const delay = Math.max(0, options.delay);
  const minDuration = Math.max(0, options.minDuration);
  const setTimeoutFn = options.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn =
    options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());

  let visible = false;
  let shownAt: number | null = null;
  let showHandle: unknown = null;
  let hideHandle: unknown = null;

  const clearShow = () => {
    if (showHandle !== null) {
      clearTimeoutFn(showHandle);
      showHandle = null;
    }
  };

  const clearHide = () => {
    if (hideHandle !== null) {
      clearTimeoutFn(hideHandle);
      hideHandle = null;
    }
  };

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    options.onVisibleChange(next);
  };

  return {
    setLoading(loading: boolean) {
      if (loading) {
        clearHide();
        if (visible || showHandle !== null) return;
        showHandle = setTimeoutFn(() => {
          showHandle = null;
          shownAt = now();
          setVisible(true);
        }, delay);
        return;
      }

      clearShow();
      if (!visible || hideHandle !== null) return;
      const elapsed = shownAt === null ? minDuration : now() - shownAt;
      const remaining = minDuration - elapsed;
      if (remaining <= 0) {
        shownAt = null;
        setVisible(false);
        return;
      }
      hideHandle = setTimeoutFn(() => {
        hideHandle = null;
        shownAt = null;
        setVisible(false);
      }, remaining);
    },
    isVisible() {
      return visible;
    },
    dispose() {
      clearShow();
      clearHide();
    },
  };
}

/**
 * Returns a debounced loading flag that only turns true once `loading` has
 * persisted past `delay`, then stays true for at least `minDuration`. Fast
 * responses never flip it on, eliminating the loading-state flash.
 */
export function useDelayedLoading(loading: boolean, options: UseDelayedLoadingOptions = {}): boolean {
  const { delay = DEFAULT_LOADING_DELAY_MS, minDuration = DEFAULT_LOADING_MIN_DURATION_MS } = options;
  const [visible, setVisible] = useState(false);
  const controllerRef = useRef<DelayedLoadingController | null>(null);

  if (controllerRef.current === null) {
    controllerRef.current = createDelayedLoadingController({
      delay,
      minDuration,
      onVisibleChange: setVisible,
    });
  }

  useEffect(() => {
    controllerRef.current?.setLoading(loading);
  }, [loading]);

  useEffect(() => {
    return () => controllerRef.current?.dispose();
  }, []);

  return visible;
}
