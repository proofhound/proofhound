import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { ReleaseLineView } from '../../lib';
import {
  compareHistoryGroups,
  isHistoryRowLive,
  type HistoryGroup,
  type HistoryRow,
} from './release-line-detail-page';
import { ReleaseTrafficBar } from './release-line-ui';

function renderTrafficBar(line: ReleaseLineView) {
  return render(
    <I18nProvider defaultLanguage="en-US">
      <ReleaseTrafficBar line={line} />
    </I18nProvider>,
  );
}

function productionCanaryLine(trafficMode: 'split' | 'dual_run'): ReleaseLineView {
  return {
    status: 'running',
    trafficRatio: 0.3,
    production: { currentEvent: { status: 'running' } },
    canary: { status: 'running', trafficMode },
  } as unknown as ReleaseLineView;
}

function canaryIconMarkup(title: string) {
  const row = screen.getByTitle(title);
  return row.querySelector('svg')?.innerHTML;
}

describe('ReleaseTrafficBar', () => {
  it('shows complementary production and canary percentages for split traffic', () => {
    renderTrafficBar(productionCanaryLine('split'));

    expect(screen.getByLabelText('Production 70%')).toBeInTheDocument();
    expect(screen.getByLabelText('Canary split 30%')).toBeInTheDocument();
    expect(screen.queryByText('Production')).not.toBeInTheDocument();
    expect(screen.queryByText('Canary split')).not.toBeInTheDocument();
    expect(screen.getByTitle('Production')).toBeInTheDocument();
    expect(screen.getByTitle('Canary split')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('keeps production at 100% and shows dual-run label only from the hover icon', () => {
    renderTrafficBar(productionCanaryLine('dual_run'));
    const dualRunIcon = canaryIconMarkup('Canary dual-run');

    renderTrafficBar(productionCanaryLine('split'));
    const splitIcon = canaryIconMarkup('Canary split');

    expect(screen.getByLabelText('Production 100%')).toBeInTheDocument();
    expect(screen.getByLabelText('Canary dual-run 30%')).toBeInTheDocument();
    expect(screen.queryByText('Canary dual-run')).not.toBeInTheDocument();
    expect(screen.getByTitle('Canary dual-run')).toBeInTheDocument();
    expect(dualRunIcon).toBeTruthy();
    expect(splitIcon).toBeTruthy();
    expect(dualRunIcon).not.toEqual(splitIcon);
  });
});

function historyGroup(overrides: Partial<HistoryGroup> = {}): HistoryGroup {
  return {
    id: 'group',
    production: null,
    candidates: [],
    isLive: false,
    sortAt: '2026-05-20T00:00:00.000Z',
    productionNumber: null,
    ...overrides,
  };
}

function historyRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    isLive: false,
    status: null,
    ...overrides,
  } as unknown as HistoryRow;
}

describe('compareHistoryGroups', () => {
  it('orders numbered production groups by productionNumber descending regardless of timestamp', () => {
    // The newer-numbered group (#2) carries an OLDER timestamp than the older-numbered group (#1).
    const newerProduction = historyGroup({ id: 'p2', productionNumber: 2, sortAt: '2026-05-01T00:00:00.000Z' });
    const olderProduction = historyGroup({ id: 'p1', productionNumber: 1, sortAt: '2026-05-30T00:00:00.000Z' });

    const sorted = [olderProduction, newerProduction].sort(compareHistoryGroups);

    expect(sorted.map((group) => group.id)).toEqual(['p2', 'p1']);
  });

  it('always ranks a numbered production group above a null/legacy group even when the null group is newer', () => {
    const numbered = historyGroup({ id: 'p1', productionNumber: 1, sortAt: '2026-05-01T00:00:00.000Z' });
    const legacy = historyGroup({ id: 'legacy', productionNumber: null, sortAt: '2026-06-30T00:00:00.000Z' });

    // Order should not depend on timestamp when one group is numbered and the other is not.
    expect([legacy, numbered].sort(compareHistoryGroups).map((group) => group.id)).toEqual(['p1', 'legacy']);
    expect([numbered, legacy].sort(compareHistoryGroups).map((group) => group.id)).toEqual(['p1', 'legacy']);
  });

  it('orders null/legacy groups among themselves by timestamp descending', () => {
    const older = historyGroup({ id: 'a', productionNumber: null, sortAt: '2026-05-01T00:00:00.000Z' });
    const newer = historyGroup({ id: 'b', productionNumber: null, sortAt: '2026-06-01T00:00:00.000Z' });

    expect([older, newer].sort(compareHistoryGroups).map((group) => group.id)).toEqual(['b', 'a']);
  });

  it('produces a stable total order across a mixed set', () => {
    const groups = [
      historyGroup({ id: 'legacy-new', productionNumber: null, sortAt: '2026-06-30T00:00:00.000Z' }),
      historyGroup({ id: 'prod-1', productionNumber: 1, sortAt: '2026-05-30T00:00:00.000Z' }),
      historyGroup({ id: 'prod-3', productionNumber: 3, sortAt: '2026-05-01T00:00:00.000Z' }),
      historyGroup({ id: 'legacy-old', productionNumber: null, sortAt: '2026-04-01T00:00:00.000Z' }),
      historyGroup({ id: 'prod-2', productionNumber: 2, sortAt: '2026-05-15T00:00:00.000Z' }),
    ];

    // Numbered groups first (3,2,1 desc), then null groups by timestamp desc.
    expect(groups.sort(compareHistoryGroups).map((group) => group.id)).toEqual([
      'prod-3',
      'prod-2',
      'prod-1',
      'legacy-new',
      'legacy-old',
    ]);
  });
});

describe('isHistoryRowLive', () => {
  it('is true only when the structured row is live', () => {
    expect(isHistoryRowLive(historyRow({ isLive: true }))).toBe(true);
    expect(isHistoryRowLive(historyRow({ isLive: false }))).toBe(false);
  });

  it('ignores the display label and does not false-positive on a "running" substring', () => {
    // A non-live row whose formatted status contains the word "running" (e.g. a terminalReason)
    // must NOT be reported as live.
    expect(isHistoryRowLive(historyRow({ isLive: false, status: 'stopped · stopped_while_running' }))).toBe(false);
    // A genuinely live row stays live regardless of label content.
    expect(isHistoryRowLive(historyRow({ isLive: true, status: 'running' }))).toBe(true);
  });
});
