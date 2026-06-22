import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, LANGUAGE_STORAGE_KEY, useI18n, type TranslationKey } from './index';

function Probe({ id, labelKey }: { id: string; labelKey: TranslationKey }) {
  return <span data-testid={id}>{useI18n().t(labelKey)}</span>;
}

describe('quality metric labels', () => {
  beforeEach(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh-CN');
  });

  it('does not append English Overall to Chinese quality summary rows', () => {
    render(
      <I18nProvider defaultLanguage="zh-CN">
        <Probe id="experiment-overall" labelKey="experiments.detail.classOverall" />
        <Probe id="canary-overall" labelKey="canaryReleases.detail.quality.overall" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('experiment-overall')).toHaveTextContent('总体');
    expect(screen.getByTestId('experiment-overall')).not.toHaveTextContent('Overall');
    expect(screen.getByTestId('canary-overall')).toHaveTextContent('总体');
    expect(screen.getByTestId('canary-overall')).not.toHaveTextContent('Overall');
  });
});
