import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu, DropdownMenuContent } from '@proofhound/ui';

import { I18nProvider } from '../i18n';
import { DisplayPreferencesProvider, useDisplayPreferences } from '../providers';
import { TimeZonePickerList } from './time-zone-preference-menu';

function renderPicker(onChange = vi.fn()) {
  render(
    <I18nProvider defaultLanguage="en-US">
      <DropdownMenu open>
        <DropdownMenuContent forceMount>
          <TimeZonePickerList value="auto" resolvedTimeZone="UTC" onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
    </I18nProvider>,
  );
  return onChange;
}

function DisplayPreferencesProbe() {
  const { timeZonePreference, resolvedTimeZone, setTimeZonePreference } = useDisplayPreferences();
  return (
    <button type="button" onClick={() => setTimeZonePreference('Asia/Shanghai')}>
      {timeZonePreference}|{resolvedTimeZone}
    </button>
  );
}

describe('TimeZonePickerList', () => {
  it('searches by city, IANA name, and UTC offset', () => {
    renderPicker();
    const search = screen.getByTestId('timezone-search');

    fireEvent.change(search, { target: { value: 'Shanghai' } });
    expect(screen.getByTestId('timezone-option-Asia/Shanghai')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Asia/Shanghai' } });
    expect(screen.getByTestId('timezone-option-Asia/Shanghai')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'UTC+08' } });
    expect(screen.getByTestId('timezone-option-Asia/Shanghai')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Los Angeles' } });
    expect(screen.getByTestId('timezone-option-America/Los_Angeles')).toBeInTheDocument();
  });

  it('emits the selected time zone', () => {
    const onChange = renderPicker();
    fireEvent.change(screen.getByTestId('timezone-search'), { target: { value: 'Shanghai' } });
    fireEvent.click(screen.getByTestId('timezone-option-Asia/Shanghai'));
    expect(onChange).toHaveBeenCalledWith('Asia/Shanghai');
  });
});

describe('DisplayPreferencesProvider', () => {
  it('uses injected display preferences and delegates updates to the contract', () => {
    const setTimeZonePreference = vi.fn();
    render(
      <DisplayPreferencesProvider
        value={{
          timeZonePreference: 'auto',
          resolvedTimeZone: 'America/Los_Angeles',
          setTimeZonePreference,
        }}
      >
        <DisplayPreferencesProbe />
      </DisplayPreferencesProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('auto|America/Los_Angeles');
    fireEvent.click(screen.getByRole('button'));
    expect(setTimeZonePreference).toHaveBeenCalledWith('Asia/Shanghai');
  });
});
