'use client';

import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Segmented } from './segmented';
import { cn } from '../lib/utils';

export type DateRangePreset = 'h1' | 'h24' | 'd7' | 'd30' | 'custom';

export interface DateRangeValue {
  preset: DateRangePreset;
  from: string; // ISO
  to: string; // ISO
}

export interface DateRangePresetOption {
  value: DateRangePreset;
  label: string;
}

export interface DateRangeSegmentedLabels {
  ariaLabel: string;
  customRangeAriaLabel: string;
  fromLabel: string;
  toLabel: string;
  dateLabel: string;
  timeLabel: string;
  previousMonth: string;
  nextMonth: string;
  cancel: string;
  apply: string;
  invalidRange: string;
}

export interface LocalDateTimeParts {
  date: string;
  time: string;
}

export interface CalendarDay {
  date: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

const PRESETS: ReadonlyArray<DateRangePresetOption> = [
  { value: 'h1', label: '近 1 小时' },
  { value: 'h24', label: '近 24 小时' },
  { value: 'd7', label: '近 7 天' },
  { value: 'd30', label: '近 30 天' },
  { value: 'custom', label: '自定义' },
];

const DEFAULT_LABELS: DateRangeSegmentedLabels = {
  ariaLabel: '时间范围',
  customRangeAriaLabel: '自定义时间范围',
  fromLabel: '开始',
  toLabel: '结束',
  dateLabel: '日期',
  timeLabel: '时间',
  previousMonth: '上个月',
  nextMonth: '下个月',
  cancel: '取消',
  apply: '应用',
  invalidRange: '结束时间必须晚于开始时间',
};

const WEEKDAY_REFERENCE_DATES = [
  '2024-01-07T00:00:00',
  '2024-01-08T00:00:00',
  '2024-01-09T00:00:00',
  '2024-01-10T00:00:00',
  '2024-01-11T00:00:00',
  '2024-01-12T00:00:00',
  '2024-01-13T00:00:00',
];

// Compute [from, to) from a preset. to uses now to make monitoring display convenient
export function resolveDateRangePreset(
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: string; to: string } | null {
  if (preset === 'custom') return null;
  const ms = {
    h1: 60 * 60_000,
    h24: 24 * 60 * 60_000,
    d7: 7 * 24 * 60 * 60_000,
    d30: 30 * 24 * 60 * 60_000,
  }[preset];
  const to = now;
  const from = new Date(to.getTime() - ms);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function DateRangeSegmented({
  value,
  onChange,
  presetLabels = PRESETS,
  labels = DEFAULT_LABELS,
  locale = 'zh-CN',
  className,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  presetLabels?: ReadonlyArray<DateRangePresetOption>;
  labels?: DateRangeSegmentedLabels;
  locale?: string;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <Segmented
        ariaLabel={labels.ariaLabel}
        value={value.preset}
        options={presetLabels}
        onChange={(preset) => {
          if (preset === 'custom') {
            onChange({ ...value, preset });
            return;
          }
          const resolved = resolveDateRangePreset(preset);
          if (resolved) onChange({ preset, ...resolved });
        }}
      />
      {value.preset === 'custom' && (
        <CustomRangePopover
          value={value}
          labels={labels}
          locale={locale}
          onChange={(from, to) => onChange({ preset: 'custom', from, to })}
        />
      )}
    </div>
  );
}

function CustomRangePopover({
  value,
  labels,
  locale,
  onChange,
}: {
  value: DateRangeValue;
  labels: DateRangeSegmentedLabels;
  locale: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fromLabel = formatDisplay(value.from);
  const toLabel = formatDisplay(value.to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.customRangeAriaLabel}
          className="inline-flex h-8 max-w-[min(42rem,calc(100vw-2rem))] min-w-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[12.5px] font-medium text-foreground hover:bg-accent cursor-pointer"
        >
          <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono">
            {fromLabel} → {toLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[calc(100vw-2rem)] p-3 sm:w-[640px]">
        {/* A new form instance is created each time the popover reopens; local state is initialized from props;
            external value changes are synced via unmount/remount, avoiding the useEffect backfill pattern */}
        {open && (
          <CustomRangeForm
            initialFrom={value.from}
            initialTo={value.to}
            labels={labels}
            locale={locale}
            onCancel={() => setOpen(false)}
            onApply={(from, to) => {
              onChange(from, to);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function CustomRangeForm({
  initialFrom,
  initialTo,
  labels,
  locale,
  onApply,
  onCancel,
}: {
  initialFrom: string;
  initialTo: string;
  labels: DateRangeSegmentedLabels;
  locale: string;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(() => toLocalDateTimeParts(initialFrom));
  const [to, setTo] = useState(() => toLocalDateTimeParts(initialTo));
  const [fromMonth, setFromMonth] = useState(() => monthStartFromParts(toLocalDateTimeParts(initialFrom)));
  const [toMonth, setToMonth] = useState(() => monthStartFromParts(toLocalDateTimeParts(initialTo)));

  const fromIso = localDateTimePartsToIso(from);
  const toIso = localDateTimePartsToIso(to);
  const hasRangeError = Boolean(fromIso && toIso && new Date(fromIso) >= new Date(toIso));
  const canApply = Boolean(fromIso && toIso && !hasRangeError);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CalendarPanel
          scope="from"
          label={labels.fromLabel}
          labels={labels}
          locale={locale}
          parts={from}
          month={fromMonth}
          onMonthChange={setFromMonth}
          onDateChange={(date) => {
            setFrom((prev) => ({ ...prev, date }));
            setFromMonth(monthStartFromDateValue(date));
          }}
          onTimeChange={(time) => setFrom((prev) => ({ ...prev, time }))}
        />
        <CalendarPanel
          scope="to"
          label={labels.toLabel}
          labels={labels}
          locale={locale}
          parts={to}
          month={toMonth}
          onMonthChange={setToMonth}
          onDateChange={(date) => {
            setTo((prev) => ({ ...prev, date }));
            setToMonth(monthStartFromDateValue(date));
          }}
          onTimeChange={(time) => setTo((prev) => ({ ...prev, time }))}
        />
      </div>

      <div className="flex min-h-5 items-center justify-between gap-3">
        <div className="text-[12px] text-destructive" role={hasRangeError ? 'alert' : undefined}>
          {hasRangeError ? labels.invalidRange : null}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-accent cursor-pointer"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => {
              if (fromIso && toIso && !hasRangeError) onApply(fromIso, toIso);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarPanel({
  scope,
  label,
  labels,
  locale,
  parts,
  month,
  onMonthChange,
  onDateChange,
  onTimeChange,
}: {
  scope: 'from' | 'to';
  label: string;
  labels: DateRangeSegmentedLabels;
  locale: string;
  parts: LocalDateTimeParts;
  month: Date;
  onMonthChange: (next: Date) => void;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
}) {
  const days = useMemo(() => buildCalendarDays(month), [month]);
  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale), [locale]);

  return (
    <section
      className="rounded-lg border bg-background p-2.5"
      aria-label={label}
      data-testid={`date-range-panel-${scope}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[12.5px] font-semibold text-foreground">{label}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{formatDisplayDate(parts.date)}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`${label} ${labels.previousMonth}`}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <div className="min-w-24 text-center text-[12px] font-medium text-foreground">
            {formatMonth(month, locale)}
          </div>
          <button
            type="button"
            aria-label={`${label} ${labels.nextMonth}`}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1" data-testid={`date-range-calendar-${scope}`}>
        {weekdayLabels.map((weekday, index) => (
          <div
            key={WEEKDAY_REFERENCE_DATES[index]}
            className="h-6 text-center text-[11px] font-medium leading-6 text-muted-foreground"
          >
            {weekday}
          </div>
        ))}
        {days.map((day) => {
          const selected = day.date === parts.date;
          return (
            <button
              key={day.date}
              type="button"
              aria-label={`${label} ${labels.dateLabel} ${formatDisplayDate(day.date)}`}
              aria-pressed={selected}
              onClick={() => onDateChange(day.date)}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md border text-[12px] font-medium transition-colors cursor-pointer',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-transparent text-foreground hover:border-border hover:bg-accent',
                !selected && !day.inCurrentMonth && 'text-muted-foreground/50',
                !selected && day.isToday && 'border-primary text-foreground',
              )}
            >
              {day.day}
            </button>
          );
        })}
      </div>

      <label className="mt-2 flex items-center gap-2 border-t pt-2 text-[12px] text-muted-foreground">
        <Clock className="size-3.5" aria-hidden />
        <span className="shrink-0">{labels.timeLabel}</span>
        <input
          data-testid={`date-range-time-${scope}`}
          type="time"
          step={60}
          value={parts.time}
          onChange={(event) => onTimeChange(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
        />
      </label>
    </section>
  );
}

export function toLocalDateTimeParts(iso: string): LocalDateTimeParts {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function localDateTimePartsToIso(parts: LocalDateTimeParts): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts.date) || !/^\d{2}:\d{2}$/.test(parts.time)) return null;

  const dateParts = parts.date.split('-').map(Number);
  const timeParts = parts.time.split(':').map(Number);
  const year = dateParts[0]!;
  const month = dateParts[1]!;
  const day = dateParts[2]!;
  const hour = timeParts[0]!;
  const minute = timeParts[1]!;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.toISOString();
}

export function buildCalendarDays(month: Date): CalendarDay[] {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const value = formatDateValue(date);
    return {
      date: value,
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: value === formatDateValue(new Date()),
    };
  });
}

function buildWeekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  return WEEKDAY_REFERENCE_DATES.map((value) => formatter.format(new Date(value)));
}

function monthStartFromParts(parts: LocalDateTimeParts): Date {
  return monthStartFromDateValue(parts.date);
}

function monthStartFromDateValue(value: string): Date {
  const parsed = parseDateValue(value);
  if (!parsed) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(parsed.year, parsed.month - 1, 1);
}

function parseDateValue(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parts = value.split('-').map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function shiftMonth(month: Date, offset: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + offset, 1);
}

function formatMonth(month: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(month);
}

function formatDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDisplayDate(value: string): string {
  const parsed = parseDateValue(value);
  if (!parsed) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.year}/${pad(parsed.month)}/${pad(parsed.day)}`;
}

function formatDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}
