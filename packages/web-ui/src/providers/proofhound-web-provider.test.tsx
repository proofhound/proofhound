import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProofHoundWebProvider } from './proofhound-web-provider';
import { localWebContracts } from '../contracts';
import { useProjectContext } from './project-context-provider';
import { useDatasetUploadMaxBytes } from './dataset-upload-provider';
import { useI18n } from '../i18n';
import { configureApiClient } from '@proofhound/api-client';

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

// Spy on configureApiClient (keep the rest of @proofhound/api-client real so
// localWebContracts' LocalAuthSource still works) to assert call ordering.
vi.mock('@proofhound/api-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, configureApiClient: vi.fn() };
});

function Probe() {
  return (
    <>
      <span data-testid="pid">{useProjectContext().projectId}</span>
      <span data-testid="t">{useI18n().t('common.cancel')}</span>
      <span data-testid="upload-max">{useDatasetUploadMaxBytes()}</span>
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

  it('injects a host-provided dataset upload limit', () => {
    render(
      <ProofHoundWebProvider contracts={{ ...localWebContracts, datasetUploadMaxBytes: 42_000_000 }}>
        <Probe />
      </ProofHoundWebProvider>,
    );

    expect(screen.getByTestId('upload-max').textContent).toBe('42000000');
  });

  it('configures the api client before children render (first request carries auth/project/baseUrl)', () => {
    // A child screen can fire its first TanStack Query during mount; if the api
    // client is wired in a post-mount effect, that request escapes before the
    // interceptor + baseUrl exist. The contract is: configureApiClient runs
    // before any child renders.
    const events: string[] = [];
    vi.mocked(configureApiClient).mockImplementation(() => {
      events.push('configure');
    });
    function OrderProbe() {
      events.push('child-render');
      return null;
    }

    render(
      <ProofHoundWebProvider contracts={localWebContracts}>
        <OrderProbe />
      </ProofHoundWebProvider>,
    );

    expect(events).toContain('configure');
    expect(events.indexOf('configure')).toBeLessThan(events.indexOf('child-render'));
  });
});
