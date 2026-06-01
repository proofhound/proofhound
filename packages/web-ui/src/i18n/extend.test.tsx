import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider, useI18n } from './index';

function Probe({ k }: { k: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <span>{useI18n().t(k as any)}</span>;
}

describe('I18nProvider extend', () => {
  it('extend 追加的 key 可被 t 解析', () => {
    render(
      <I18nProvider defaultLanguage="en-US" extend={{ 'en-US': { 'saas.org.title': 'Organization' } }}>
        <Probe k="saas.org.title" />
      </I18nProvider>,
    );
    expect(screen.getByText('Organization')).toBeInTheDocument();
  });

  it('extend 不破坏 base key', () => {
    render(
      <I18nProvider defaultLanguage="en-US" extend={{ 'en-US': { x: 'y' } }}>
        <Probe k="common.cancel" />
      </I18nProvider>,
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
