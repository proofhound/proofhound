'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  cn,
} from '@proofhound/ui';
const FEATURED_SCOPE = '__featured';
const ALL_SCOPE = '__all';

export interface QuickFillPickerGroup<TGroup extends string = string> {
  key: TGroup;
  label: string;
}

export interface QuickFillPickerOption<TGroup extends string = string> {
  key: string;
  group: TGroup;
  title: string;
  subtitle?: string;
  description?: string;
  badges?: ReactNode[];
  meta?: ReactNode[];
  searchText?: string;
  featured?: boolean;
}

export interface QuickFillPickerLabels {
  title: string;
  description?: string;
  searchPlaceholder: string;
  featured: string;
  all: string;
  empty: string;
  apply: string;
  selected: string;
  ariaLabel: string;
}

export function QuickFillPicker<TGroup extends string>({
  groups,
  options,
  labels,
  selectedKey,
  disabled,
  collapsible = false,
  defaultOpen = true,
  collapseOnApply = false,
  showHeader = true,
  onApply,
  className,
  testId,
}: {
  groups: ReadonlyArray<QuickFillPickerGroup<TGroup>>;
  options: ReadonlyArray<QuickFillPickerOption<TGroup>>;
  labels: QuickFillPickerLabels;
  selectedKey?: string | null;
  disabled?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  collapseOnApply?: boolean;
  showHeader?: boolean;
  onApply: (option: QuickFillPickerOption<TGroup>) => void;
  className?: string;
  testId?: string;
}) {
  const [scope, setScope] = useState<string>(FEATURED_SCOPE);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(defaultOpen);
  const hasFeatured = options.some((option) => option.featured);
  const normalizedQuery = query.trim().toLowerCase();
  const selectedOption = selectedKey ? options.find((option) => option.key === selectedKey) : null;
  const scopes = useMemo(
    () => [
      ...(hasFeatured ? [{ key: FEATURED_SCOPE, label: labels.featured }] : []),
      { key: ALL_SCOPE, label: labels.all },
      ...groups,
    ],
    [groups, hasFeatured, labels.all, labels.featured],
  );

  const visibleOptions = options.filter((option) => {
    const scopeMatched = scope === ALL_SCOPE || (scope === FEATURED_SCOPE ? option.featured : option.group === scope);
    if (!scopeMatched) return false;
    if (!normalizedQuery) return true;
    const haystack = `${option.title} ${option.subtitle ?? ''} ${option.description ?? ''} ${option.searchText ?? ''}`;
    return haystack.toLowerCase().includes(normalizedQuery);
  });

  const applyOption = (option: QuickFillPickerOption<TGroup>) => {
    onApply(option);
    if (collapsible && collapseOnApply) setOpen(false);
  };

  return (
    <Collapsible open={collapsible ? open : true} onOpenChange={setOpen} asChild>
      <section className={cn('space-y-3 rounded-lg border bg-card p-4', className)} data-testid={testId}>
        {showHeader ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-primary">
                  <Sparkles className="size-3.5" />
                </span>
                <h2 className="text-sm font-semibold">{labels.title}</h2>
                {selectedOption && (
                  <span className="min-w-0 truncate rounded border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                    {labels.selected} · {selectedOption.title}
                  </span>
                )}
              </div>
              {labels.description && (
                <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{labels.description}</div>
              )}
            </div>
            <div className="flex items-center gap-2 lg:justify-end">
              <CollapsibleContent forceMount className={cn(!open && 'hidden')}>
                <div className="relative w-full lg:w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={labels.searchPlaceholder}
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </CollapsibleContent>
              {collapsible && (
                <CollapsibleTrigger
                  type="button"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={labels.ariaLabel}
                >
                  <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
                </CollapsibleTrigger>
              )}
            </div>
          </div>
        ) : (
          <CollapsibleContent forceMount className={cn(!open && 'hidden')}>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={labels.searchPlaceholder}
                className="h-9 pl-8 text-sm"
              />
            </div>
          </CollapsibleContent>
        )}

        <CollapsibleContent className="space-y-3">
          <div role="tablist" aria-label={labels.ariaLabel} className="flex flex-wrap gap-1.5">
            {scopes.map((item) => {
              const active = item.key === scope;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    'h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setScope(item.key)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {visibleOptions.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {visibleOptions.map((option) => {
                const selected = option.key === selectedKey;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={cn(
                      'group flex min-h-[148px] flex-col rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      selected && 'border-primary bg-accent/45',
                    )}
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => applyOption(option)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{option.title}</div>
                        {option.subtitle && (
                          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {option.subtitle}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-card text-muted-foreground group-hover:text-foreground',
                        )}
                      >
                        {selected ? <Check className="size-3" /> : null}
                        {selected ? labels.selected : labels.apply}
                      </span>
                    </div>
                    {option.description && (
                      <div className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </div>
                    )}
                    {option.badges && option.badges.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {option.badges.map((badge, index) => (
                          <span key={index} className="rounded border bg-card px-1.5 py-0.5 text-[10.5px]">
                            {badge}
                          </span>
                        ))}
                      </div>
                    )}
                    {option.meta && option.meta.length > 0 && (
                      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 font-mono text-[10.5px] text-muted-foreground">
                        {option.meta.map((item, index) => (
                          <span key={index}>{item}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">
              {labels.empty}
            </div>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
