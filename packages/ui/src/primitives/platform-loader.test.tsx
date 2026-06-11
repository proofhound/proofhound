import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlatformLoaderOverlay } from './platform-loader';

describe('PlatformLoaderOverlay', () => {
  it('uses a transparent viewport layer by default', () => {
    render(<PlatformLoaderOverlay />);

    const overlay = screen.getByTestId('platform-loader').parentElement;
    expect(overlay).toHaveClass('fixed');
    expect(overlay).toHaveClass('inset-0');
    expect(overlay).toHaveClass('z-40');
    expect(overlay).toHaveClass('pointer-events-none');
    expect(overlay).not.toHaveClass('bg-background/55');
    expect(overlay).not.toHaveClass('backdrop-blur-[1px]');
  });

  it('keeps the old container overlay available for local panel loading', () => {
    render(<PlatformLoaderOverlay placement="container" />);

    const overlay = screen.getByTestId('platform-loader').parentElement;
    expect(overlay).toHaveClass('absolute');
    expect(overlay).toHaveClass('z-10');
    expect(overlay).toHaveClass('bg-background/55');
    expect(overlay).toHaveClass('backdrop-blur-[1px]');
    expect(overlay).not.toHaveClass('fixed');
  });
});
