'use client';

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { useUiStrings } from '../strings';
import { cn } from '../lib/utils';

export const TABLE_ACTION_ICON_BUTTON_CLASS = 'size-7 cursor-pointer disabled:cursor-not-allowed';

interface TableActionTooltipProps {
  label: React.ReactNode;
  disabled?: boolean;
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  className?: string;
  children: React.ReactNode;
}

export function TableActionTooltip({
  label,
  disabled,
  side = 'top',
  className,
  children,
}: TableActionTooltipProps) {
  return (
    <TooltipProvider delayDuration={160}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('inline-flex', disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}
            onClick={(event) => {
              if (disabled) event.stopPropagation();
            }}
            onPointerDown={(event) => {
              if (disabled) event.stopPropagation();
            }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface TableActionIconButtonProps extends ButtonProps {
  label: string;
  tooltipLabel?: React.ReactNode;
  tooltipSide?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
}

export const TableActionIconButton = React.forwardRef<HTMLButtonElement, TableActionIconButtonProps>(
  ({ label, tooltipLabel, tooltipSide, className, children, disabled, ...props }, ref) => (
    <TableActionTooltip label={tooltipLabel ?? label} disabled={disabled} side={tooltipSide}>
      <Button
        ref={ref}
        {...props}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(TABLE_ACTION_ICON_BUTTON_CLASS, className)}
        aria-label={label}
        disabled={disabled}
      >
        {children}
      </Button>
    </TableActionTooltip>
  ),
);
TableActionIconButton.displayName = 'TableActionIconButton';

export interface TableActionDescriptor {
  /** Stable key for React (also used as aria-label fallback). */
  key: string;
  /** Visible label in tooltip + dropdown item + aria-label. */
  label: string;
  /** Lucide-style icon component. */
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
  /** When true, the action is filtered out before rendering. */
  hide?: boolean;
  /** Optional override for the icon-button's aria-label (e.g. include row name). */
  ariaLabel?: string;
}

export interface TableActionRowProps {
  actions: TableActionDescriptor[];
  /** Max number of inline icon buttons before overflowing into ⋯ menu. */
  maxInline?: number;
  /** Override aria-label / tooltip for the ⋯ trigger. Defaults to `UiStrings.actionsMore`. */
  moreLabel?: string;
  className?: string;
}

/**
 * Caps inline action icons at `maxInline` (default 4); the rest go into a ⋯
 * DropdownMenu. Pair with `actions` column preset of `'normal'` (180px) which
 * fits exactly 4 size-7 (28px) buttons + gap-0.5 + cell px-3 padding.
 */
export function TableActionRow({
  actions,
  maxInline = 4,
  moreLabel,
  className,
}: TableActionRowProps) {
  const s = useUiStrings();
  const visible = actions.filter((action) => !action.hide);
  const inline = visible.slice(0, maxInline);
  const overflow = visible.slice(maxInline);
  const resolvedMoreLabel = moreLabel ?? s.actionsMore;

  return (
    <div className={cn('inline-flex items-center justify-end gap-0.5', className)}>
      {inline.map((action) => {
        const Icon = action.icon;
        return (
          <TableActionIconButton
            key={action.key}
            label={action.ariaLabel ?? action.label}
            tooltipLabel={action.label}
            disabled={action.disabled}
            className={cn(action.destructive && 'text-destructive hover:text-destructive')}
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
            }}
          >
            <Icon className={cn('size-3.5', action.loading && 'animate-spin')} />
          </TableActionIconButton>
        );
      })}
      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TableActionIconButton
              label={resolvedMoreLabel}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </TableActionIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            {overflow.map((action) => {
              const Icon = action.icon;
              return (
                <DropdownMenuItem
                  key={action.key}
                  disabled={action.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    action.onClick();
                  }}
                  className={cn(
                    'gap-2 text-xs',
                    action.destructive && 'text-destructive focus:text-destructive',
                  )}
                >
                  <Icon className={cn('size-3.5', action.loading && 'animate-spin')} />
                  <span>{action.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
