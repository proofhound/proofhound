import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProofHoundWebProvider } from './proofhound-web-provider';
import { localWebContracts } from '../contracts';
import { useProjectContext } from './project-context-provider';
import { useI18n } from '../i18n';

// Refine's @refinedev/nextjs-router routerProvider reads next/navigation hooks,
// which require a Next router context unavailable in jsdom. Stub the routerProvider
// with a no-op binding so RefineProvider mounts and we can assert ProofHoundWebProvider's
// own injection (projectContext + i18n) without Next routing internals.
vi.mock('@refinedev/nextjs-router', () => ({
  default: {
    go: () => () => undefined,
    back: () => () => undefined,
    parse: () => () => ({ params: {} }),
  },
}));

function Probe() {
  return (
    <>
      <span data-testid="pid">{useProjectContext().projectId}</span>
      <span data-testid="t">{useI18n().t('common.cancel')}</span>
    </>
  );
}

describe('ProofHoundWebProvider', () => {
  it('injects projectContext + i18n', () => {
    render(
      <ProofHoundWebProvider contracts={localWebContracts}>
        <Probe />
      </ProofHoundWebProvider>,
    );
    expect(screen.getByTestId('pid').textContent).toBe(localWebContracts.projectContext.projectId);
    expect(screen.getByTestId('t').textContent).toBeTruthy();
  });
});
