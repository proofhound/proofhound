import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/utils';

type ProofHoundLogoSize = 'xs' | 'sm' | 'nav' | 'md' | 'lg' | 'xl';
type ProofHoundLogoTone = 'default' | 'sidebar';

type ProofHoundMarkTileProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  markClassName?: string;
  size?: ProofHoundLogoSize;
  tileClassName?: string;
  tone?: ProofHoundLogoTone;
};

type ProofHoundLogoProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  markClassName?: string;
  showWordmark?: boolean;
  size?: ProofHoundLogoSize;
  tileClassName?: string;
  tone?: ProofHoundLogoTone;
  wordmarkClassName?: string;
};

const TILE_SIZE_CLASSES: Record<ProofHoundLogoSize, { mark: string; tile: string; wordmark: string }> = {
  xs: {
    tile: 'size-5 rounded-[4px]',
    mark: 'h-[9px] w-3.5',
    wordmark: 'text-[8.5px]',
  },
  sm: {
    tile: 'size-6 rounded-[5px]',
    mark: 'h-3 w-[18px]',
    wordmark: 'text-[11px]',
  },
  nav: {
    tile: 'size-7 rounded-md',
    mark: 'h-[13px] w-5',
    wordmark: 'text-[13px]',
  },
  md: {
    tile: 'size-8 rounded-[7px]',
    mark: 'h-3.5 w-[22px]',
    wordmark: 'text-[15px]',
  },
  lg: {
    tile: 'size-14 rounded-xl',
    mark: 'h-7 w-[42px]',
    wordmark: 'text-[22px]',
  },
  xl: {
    tile: 'size-24 rounded-[19px]',
    mark: 'h-[50px] w-[76px]',
    wordmark: 'text-4xl',
  },
};

const TONE_CLASSES: Record<ProofHoundLogoTone, { tile: string; wordmark: string }> = {
  default: {
    tile: 'bg-primary text-primary-foreground',
    wordmark: 'text-foreground',
  },
  sidebar: {
    tile: 'bg-sidebar-primary text-sidebar-primary-foreground',
    wordmark: 'text-sidebar-foreground',
  },
};

function ProofHoundMarkSvg({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 68 44" fill="none" className={className}>
      <path d="M16 4 L4 22 L16 40" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M52 4 L64 22 L52 40"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="translate(34 25) scale(0.75)" fill="currentColor">
        <ellipse cx={0} cy={9} rx={14} ry={10.5} />
        <circle cx={-15} cy={-6} r={5.6} />
        <circle cx={-5} cy={-13} r={5.8} />
        <circle cx={6} cy={-13} r={5.8} />
        <circle cx={16} cy={-6} r={5.6} />
      </g>
    </svg>
  );
}

export function ProofHoundMarkTile({
  className,
  markClassName,
  size = 'nav',
  tileClassName,
  tone = 'default',
  ...props
}: ProofHoundMarkTileProps) {
  const sizing = TILE_SIZE_CLASSES[size];
  const tones = TONE_CLASSES[tone];

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center shadow-sm',
        sizing.tile,
        tones.tile,
        tileClassName,
        className,
      )}
      {...props}
    >
      <ProofHoundMarkSvg className={cn('shrink-0', sizing.mark, markClassName)} />
    </span>
  );
}

export function ProofHoundLogo({
  className,
  markClassName,
  showWordmark = true,
  size = 'nav',
  tileClassName,
  tone = 'default',
  wordmarkClassName,
  ...props
}: ProofHoundLogoProps) {
  const sizing = TILE_SIZE_CLASSES[size];
  const tones = TONE_CLASSES[tone];

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} {...props}>
      <ProofHoundMarkTile markClassName={markClassName} size={size} tileClassName={tileClassName} tone={tone} />
      {showWordmark ? (
        <span
          className={cn(
            'min-w-0 shrink truncate font-extrabold leading-none tracking-normal',
            sizing.wordmark,
            tones.wordmark,
            wordmarkClassName,
          )}
          style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}
        >
          ProofHound
        </span>
      ) : null}
    </span>
  );
}
