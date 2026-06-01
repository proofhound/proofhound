'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  meta?: string;
  logoText?: string;
  logoStyle?: React.CSSProperties;
}

export interface MultiSelectProps {
  label: string;
  options: ReadonlyArray<MultiSelectOption>;
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  footnote?: string;
  totalLabel?: string;
  iconAdornment?: React.ReactNode;
}

// Project / model multi-select popover (used by the design's filter bar)
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  searchPlaceholder = '搜索…',
  emptyText = '没有匹配项',
  footnote,
  totalLabel,
  iconAdornment,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.meta?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  const allChecked = options.length > 0 && value.length === options.length;
  const someChecked = value.length > 0 && !allChecked;

  function toggle(v: string) {
    if (selectedSet.has(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 h-8 text-[12.5px] font-medium text-foreground cursor-pointer transition-colors',
            'hover:bg-accent',
            open && 'border-ring shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_18%,transparent)]',
          )}
        >
          {iconAdornment}
          <span>{label}</span>
          <CountPill
            count={value.length}
            total={options.length}
            tone={value.length === 0 || allChecked ? 'muted' : 'primary'}
          />
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] p-0 overflow-hidden"
      >
        {/* search */}
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            aria-label={`${label}-搜索`}
          />
        </div>

        {/* toolbar */}
        <div className="flex items-center justify-between border-b bg-muted/40 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CheckBox
              state={allChecked ? 'checked' : someChecked ? 'indeterminate' : 'unchecked'}
              onToggle={() => onChange(allChecked ? [] : options.map((o) => o.value))}
              ariaLabel={`全选 ${label}`}
            />
            <span className="text-foreground">
              {totalLabel ?? `已选 ${value.length} / ${options.length}`}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="text-foreground hover:underline cursor-pointer"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              全选
            </button>
            <span className="opacity-40">·</span>
            <button
              type="button"
              className="text-foreground hover:underline cursor-pointer"
              onClick={() => onChange([])}
            >
              清除
            </button>
          </span>
        </div>

        {/* list */}
        <div className="max-h-[260px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">{emptyText}</div>
          ) : (
            filtered.map((opt) => {
              const checked = selectedSet.has(opt.value);
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] cursor-pointer hover:bg-accent',
                    checked && 'bg-primary/5',
                  )}
                >
                  <CheckBox
                    state={checked ? 'checked' : 'unchecked'}
                    ariaLabel={`选择 ${opt.label}`}
                  />
                  {opt.logoText && (
                    <span
                      style={opt.logoStyle}
                      className="inline-flex size-[22px] items-center justify-center rounded font-mono text-[9.5px] font-semibold shrink-0"
                    >
                      {opt.logoText}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                  {opt.meta && (
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      {opt.meta}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {footnote && (
          <div className="flex items-center justify-between border-t bg-muted/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
            <span>{footnote}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CountPill({
  count,
  total,
  tone,
}: {
  count: number;
  total: number;
  tone: 'muted' | 'primary';
}) {
  if (count === 0 || count === total) {
    return (
      <span
        className={cn(
          'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[10.5px] font-semibold',
          'bg-muted text-muted-foreground',
        )}
      >
        {count}
        {tone === 'muted' && total > 0 ? ` / ${total}` : ''}
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10.5px] font-semibold text-primary-foreground"
    >
      {count} / {total}
    </span>
  );
}

function CheckBox({
  state,
  onToggle,
  ariaLabel,
}: {
  state: 'checked' | 'unchecked' | 'indeterminate';
  onToggle?: () => void;
  ariaLabel: string;
}) {
  const className = cn(
    'inline-flex size-[14px] items-center justify-center rounded-[3px] border-[1.5px]',
    state === 'unchecked'
      ? 'border-muted-foreground/60 bg-background'
      : 'border-primary bg-primary text-primary-foreground',
  );

  if (onToggle) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-checked={state === 'checked'}
        role="checkbox"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(className, 'cursor-pointer')}
      >
        <CheckBoxInner state={state} />
      </button>
    );
  }

  return (
    <span aria-hidden className={className}>
      <CheckBoxInner state={state} />
    </span>
  );
}

function CheckBoxInner({ state }: { state: 'checked' | 'unchecked' | 'indeterminate' }) {
  if (state === 'checked')
    return (
      <Check className="size-2.5" strokeWidth={3} />
    );
  if (state === 'indeterminate')
    return <span className="h-[1.6px] w-[7px] rounded bg-primary-foreground" aria-hidden />;
  return null;
}
