'use client';

import { useMemo, useState } from 'react';
import { Check, Clock, Search } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import { useI18n } from '../i18n';
import {
  AUTO_TIME_ZONE_PREFERENCE,
  formatTimeZoneOffset,
  getSupportedTimeZones,
  getTimeZoneCityLabel,
  timeZoneMatchesSearch,
  type TimeZonePreference,
} from '../lib/time-zone';
import { useDisplayPreferences } from '../providers';

interface TimeZonePickerListProps {
  value: TimeZonePreference;
  resolvedTimeZone: string;
  onChange: (value: TimeZonePreference) => void;
}

function getTimeZoneSummary(timeZone: string) {
  return `${timeZone} (${formatTimeZoneOffset(timeZone)})`;
}

export function TimeZonePickerList({ value, resolvedTimeZone, onChange }: TimeZonePickerListProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const zones = useMemo(() => getSupportedTimeZones(), []);
  const filteredZones = useMemo(
    () => zones.filter((zone) => timeZoneMatchesSearch(zone, search)).slice(0, 80),
    [search, zones],
  );
  const showAuto = search.trim().length === 0 || t('preferences.timeZone.auto').toLowerCase().includes(search.toLowerCase());

  const renderOption = (zone: string) => {
    const selected = value === zone;
    const selectZone = () => onChange(zone);
    return (
      <DropdownMenuItem
        key={zone}
        onClick={selectZone}
        onSelect={selectZone}
        className="flex items-center gap-2"
        data-testid={`timezone-option-${zone}`}
      >
        <Check className={cn('size-3.5', selected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{getTimeZoneCityLabel(zone)}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {zone} · {formatTimeZoneOffset(zone)}
          </span>
        </span>
      </DropdownMenuItem>
    );
  };

  return (
    <div className="space-y-2" data-testid="timezone-picker">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={t('preferences.timeZone.search')}
          className="h-8 pl-8 text-[12.5px]"
          data-testid="timezone-search"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto pr-1">
        {showAuto ? (
          <DropdownMenuItem
            onClick={() => onChange(AUTO_TIME_ZONE_PREFERENCE)}
            onSelect={() => onChange(AUTO_TIME_ZONE_PREFERENCE)}
            className="flex items-center gap-2"
            data-testid="timezone-option-auto"
          >
            <Check
              className={cn('size-3.5', value === AUTO_TIME_ZONE_PREFERENCE ? 'opacity-100' : 'opacity-0')}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t('preferences.timeZone.auto')}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {getTimeZoneSummary(resolvedTimeZone)}
              </span>
            </span>
          </DropdownMenuItem>
        ) : null}
        {filteredZones.map(renderOption)}
        {!showAuto && filteredZones.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
            {t('preferences.timeZone.noResults')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TimeZonePreferenceMenu() {
  const { t } = useI18n();
  const { timeZonePreference, resolvedTimeZone, setTimeZonePreference } = useDisplayPreferences();
  const summary =
    timeZonePreference === AUTO_TIME_ZONE_PREFERENCE
      ? t('preferences.timeZone.autoSummary').replace('{timeZone}', resolvedTimeZone)
      : getTimeZoneSummary(resolvedTimeZone);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('preferences.changeTimeZone')}>
              <Clock aria-hidden="true" />
              <span className="sr-only">{t('preferences.changeTimeZone')}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('preferences.changeTimeZone')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('preferences.display')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2" data-testid="timezone-menu-trigger">
            <Clock className="size-4" aria-hidden="true" />
            <span>{t('preferences.timeZone')}</span>
            <span className="ml-auto max-w-36 truncate font-mono text-[11px] text-muted-foreground">{summary}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80 p-2">
            <TimeZonePickerList
              value={timeZonePreference}
              resolvedTimeZone={resolvedTimeZone}
              onChange={setTimeZonePreference}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
