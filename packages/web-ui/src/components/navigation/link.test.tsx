import { render } from '@testing-library/react';
import { forwardRef } from 'react';
import { describe, expect, it } from 'vitest';
import { NavigationProvider } from '../../providers/navigation-provider';
import { Link } from './link';

// Stub next/link with a plain anchor so the wrapper can be unit-tested without a
// mounted Next app router. We only assert which href the wrapper hands down.
vi.mock('next/link', () => ({
  default: forwardRef<HTMLAnchorElement, { href: unknown; children?: unknown }>(function NextLink(
    { href, children, ...rest },
    ref,
  ) {
    return (
      <a ref={ref} href={typeof href === 'string' ? href : JSON.stringify(href)} {...rest}>
        {children as never}
      </a>
    );
  }),
}));

describe('Link wrapper', () => {
  it('renders the raw href when no resolver is injected (OSS default)', () => {
    const { container } = render(<Link href="/models/new">new</Link>);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/models/new');
  });

  it('rewrites a string href through the injected resolver (so the DOM href is the real route)', () => {
    const { container } = render(
      <NavigationProvider resolveHref={(href) => `/app/org/o/project/p${href}`}>
        <Link href="/models/new" data-testid="link" className="x">
          new
        </Link>
      </NavigationProvider>,
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/app/org/o/project/p/models/new');
    // Non-href props pass through untouched.
    expect(anchor?.getAttribute('class')).toBe('x');
    expect(anchor?.textContent).toBe('new');
  });
});
