import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemePreference } from './theme-preference';

function ThemePreferenceProbe() {
  const { theme } = useThemePreference();

  return <span data-testid="theme-preference">{theme}</span>;
}

describe('useThemePreference', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.className = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = null;

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not momentarily re-apply system light before the stored dark preference', async () => {
    window.localStorage.setItem('proofhound.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themePreference = 'dark';
    document.documentElement.classList.add('dark');

    const toggleSpy = vi.spyOn(document.documentElement.classList, 'toggle');

    await act(async () => {
      root = createRoot(container);
      root.render(<ThemePreferenceProbe />);
    });

    const darkToggleForces = toggleSpy.mock.calls
      .filter(([className]) => className === 'dark')
      .map(([, force]) => force);

    expect(darkToggleForces).not.toContain(false);
    expect(darkToggleForces[0]).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
