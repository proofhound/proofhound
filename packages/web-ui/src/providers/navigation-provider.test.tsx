import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavigationProvider, useResolveHref } from './navigation-provider';

function Probe() {
  const resolveHref = useResolveHref();
  return <span data-testid="out">{resolveHref('/models/new')}</span>;
}

describe('NavigationProvider / useResolveHref', () => {
  it('defaults to identity when no provider wraps the tree', () => {
    render(<Probe />);
    expect(screen.getByTestId('out').textContent).toBe('/models/new');
  });

  it('defaults to identity when the provider omits resolveHref', () => {
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('/models/new');
  });

  it('exposes the injected resolver to descendants', () => {
    render(
      <NavigationProvider resolveHref={(href) => `/app/org/o/project/p${href}`}>
        <Probe />
      </NavigationProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('/app/org/o/project/p/models/new');
  });
});
