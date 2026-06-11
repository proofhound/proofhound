'use client';

import { ProofHoundMarkTile } from '../brand/proofhound-logo';
import { useUiStrings } from '../strings';
import { cn } from '../lib/utils';

type PlatformLoaderSize = 'sm' | 'md' | 'lg';

interface PlatformLoaderProps {
  className?: string;
  size?: PlatformLoaderSize;
}

const loaderLogoSize: Record<PlatformLoaderSize, 'md' | 'lg' | 'xl'> = {
  sm: 'md',
  md: 'lg',
  lg: 'xl',
};

const labelSizeClass: Record<PlatformLoaderSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
};

export function PlatformLoader({ className, size = 'lg' }: PlatformLoaderProps) {
  const s = useUiStrings();
  const label = s.loaderLabel;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="platform-loader"
      className={cn('flex flex-col items-center justify-center gap-4 text-center', className)}
    >
      <ProofHoundMarkTile size={loaderLogoSize[size]} className="ph-loader-wobble shadow-sm" />
      <span className={cn('font-medium text-muted-foreground', labelSizeClass[size])}>{label}</span>
    </div>
  );
}

interface PlatformLoadingScreenProps {
  /** Delay the loader's appearance by 300ms so a fast route transition doesn't flash a full-screen loader. */
  delayReveal?: boolean;
}

export function PlatformLoadingScreen({ delayReveal = false }: PlatformLoadingScreenProps = {}) {
  return (
    <main
      className={cn(
        'flex min-h-screen items-center justify-center bg-background px-4',
        delayReveal && 'ph-loader-delayed-reveal',
      )}
    >
      <PlatformLoader />
    </main>
  );
}

type PlatformLoaderOverlayPlacement = 'container' | 'viewport';

interface PlatformLoaderOverlayProps {
  className?: string;
  placement?: PlatformLoaderOverlayPlacement;
  size?: PlatformLoaderSize;
}

export function PlatformLoaderOverlay({ className, placement = 'viewport', size = 'md' }: PlatformLoaderOverlayProps) {
  return (
    <div
      className={cn(
        placement === 'viewport'
          ? 'pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-5'
          : 'absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-background/55 backdrop-blur-[1px]',
        className,
      )}
    >
      <PlatformLoader size={size} />
    </div>
  );
}
