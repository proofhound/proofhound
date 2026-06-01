import { render, screen } from '@testing-library/react';
import { UiStringsProvider, useUiStrings, DEFAULT_UI_STRINGS } from './ui-strings-context';

function Probe() {
  return <span>{useUiStrings().tableEmpty}</span>;
}

it('默认值无 Provider 时可用', () => {
  render(<Probe />);
  expect(screen.getByText(DEFAULT_UI_STRINGS.tableEmpty)).toBeInTheDocument();
});

it('Provider 覆盖默认值', () => {
  render(
    <UiStringsProvider value={{ tableEmpty: '空空如也' }}>
      <Probe />
    </UiStringsProvider>,
  );
  expect(screen.getByText('空空如也')).toBeInTheDocument();
});
