import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NavigationProvider } from '../providers/navigation-provider';
import { useRouter } from './use-router';

// Hoisted so the vi.mock factory below can close over the same spy object.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

function Probe() {
  const r = useRouter();
  return (
    <>
      <button onClick={() => r.push('/models/new')}>push</button>
      <button onClick={() => r.replace('/prompts')}>replace</button>
      <button onClick={() => r.prefetch('/datasets')}>prefetch</button>
      <button onClick={() => r.back()}>back</button>
    </>
  );
}

function renderProbe(resolveHref?: (href: string) => string) {
  render(
    <NavigationProvider resolveHref={resolveHref}>
      <Probe />
    </NavigationProvider>,
  );
}

const scope = (href: string) => `/app/org/o/project/p${href}`;

describe('useRouter wrapper', () => {
  beforeEach(() => {
    for (const fn of Object.values(router)) fn.mockClear();
  });

  it('routes push/replace/prefetch through the injected resolver', () => {
    renderProbe(scope);
    fireEvent.click(screen.getByText('push'));
    fireEvent.click(screen.getByText('replace'));
    fireEvent.click(screen.getByText('prefetch'));
    expect(router.push).toHaveBeenCalledWith('/app/org/o/project/p/models/new', undefined);
    expect(router.replace).toHaveBeenCalledWith('/app/org/o/project/p/prompts', undefined);
    expect(router.prefetch).toHaveBeenCalledWith('/app/org/o/project/p/datasets', undefined);
  });

  it('passes hrefs through unchanged under the OSS identity default', () => {
    renderProbe();
    fireEvent.click(screen.getByText('push'));
    expect(router.push).toHaveBeenCalledWith('/models/new', undefined);
  });

  it('forwards href-less methods (back) to the underlying router', () => {
    renderProbe(scope);
    fireEvent.click(screen.getByText('back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
