'use client';

import { Search } from 'lucide-react';
import { Input } from './input';
import { cn } from '../lib/utils';

/**
 * Standardized search field for the list toolbar: leading magnifier icon,
 * `type="search"`, and a single responsive width shared across every list page.
 *
 * Extra props (e.g. `data-testid`, `aria-label`) are forwarded to the input.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className,
  widthClassName = 'w-full sm:w-[320px]',
  ...inputProps
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Override the default responsive width (e.g. for a wider hero search). */
  widthClassName?: string;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'placeholder'>) {
  return (
    <div className={cn('relative', widthClassName, className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8 text-sm"
        {...inputProps}
      />
    </div>
  );
}
