'use client';

import { useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { ModalityIcon } from './modality-icon';
import { useUiStrings } from '../strings';
import { cn } from '../lib/utils';

export function ImageZoomHoverOverlay({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="image-zoom-overlay"
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/35 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
        className,
      )}
    >
      <span className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm">
        <ZoomIn className="size-3.5" />
      </span>
    </span>
  );
}

export function isRenderableImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^https?:\/\//iu.test(trimmed) || /^data:image\//iu.test(trimmed);
}

export function ImagePreviewDialog({
  open,
  onOpenChange,
  fieldName,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldName: string;
  value: string;
}) {
  const s = useUiStrings();
  const trimmed = value.trim();
  const [lastTrimmed, setLastTrimmed] = useState(trimmed);
  const [failed, setFailed] = useState(false);
  if (lastTrimmed !== trimmed) {
    setLastTrimmed(trimmed);
    setFailed(false);
  }
  const renderable = isRenderableImage(trimmed) && !failed;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90vh] w-full max-w-[min(90vw,1200px)] gap-0 overflow-hidden p-0"
        data-testid="image-preview-dialog"
      >
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="truncate font-mono text-sm">{fieldName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center bg-muted/40 p-4">
          {renderable ? (
            <img
              src={trimmed}
              alt={fieldName}
              onError={() => setFailed(true)}
              className="max-h-[70vh] w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
              <ModalityIcon kind="image" size="md" />
              <span>{s.imagePreviewFailed}</span>
            </div>
          )}
        </div>
        <div className="border-t border-border bg-background px-4 py-3">
          <code className="block max-h-24 overflow-auto break-all font-mono text-[11.5px] text-muted-foreground">
            {trimmed || '-'}
          </code>
        </div>
      </DialogContent>
    </Dialog>
  );
}
