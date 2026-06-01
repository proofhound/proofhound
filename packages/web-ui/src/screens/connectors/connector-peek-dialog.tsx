'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@proofhound/ui';
import { usePeekConnector } from '../../hooks';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib';
import type { PeekConnectorResponseDto } from '@proofhound/shared';
import type { ConnectorListItem } from './connector-types';

export function ConnectorPeekDialog({
  projectId,
  connector,
  open,
  onOpenChange,
}: {
  projectId: string;
  connector: ConnectorListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(5);
  const [result, setResult] = useState<PeekConnectorResponseDto | null>(null);
  const peekMutation = usePeekConnector(projectId);

  async function run() {
    const data = await peekMutation.mutateAsync({ connectorId: connector.id, body: { limit } });
    setResult(data);
  }

  const unsupportedKey =
    connector.direction === 'output'
      ? ('connectors.peek.unsupported.output' as const)
      : connector.type === 'webhook'
        ? ('connectors.peek.unsupported.webhook' as const)
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="project-connector-peek-dialog">
        <DialogHeader>
          <DialogTitle>{t('connectors.peek.title')}</DialogTitle>
          <DialogDescription>{t('connectors.peek.subtitle')}</DialogDescription>
        </DialogHeader>

        {unsupportedKey ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {t(unsupportedKey)}
          </p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <div>
                <Label className="text-xs">{t('connectors.peek.limit')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={limit}
                  onChange={(event) => setLimit(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
                  className="w-24"
                  data-testid="project-connector-peek-limit"
                />
              </div>
              <Button
                onClick={() => void run()}
                disabled={peekMutation.isPending}
                data-testid="project-connector-peek-run"
              >
                {peekMutation.isPending ? t('connectors.peek.running') : t('connectors.peek.run')}
              </Button>
            </div>

            {result && result.error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {result.error}
              </p>
            )}

            {result && result.messages.length > 0 && (
              <div
                className="mt-2 overflow-hidden rounded-md border"
                data-testid="project-connector-peek-result"
              >
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">{t('connectors.peek.column.id')}</th>
                      <th className="px-2 py-1 text-left">{t('connectors.peek.column.receivedAt')}</th>
                      <th className="px-2 py-1 text-left">{t('connectors.peek.column.payload')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.messages.map((msg) => (
                      <tr key={msg.id} className="border-t">
                        <td className="px-2 py-1 font-mono text-xs">{msg.id}</td>
                        <td className="px-2 py-1 text-muted-foreground">{formatDateTime(msg.receivedAt)}</td>
                        <td className="px-2 py-1">
                          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted/30 p-1 font-mono">
                            {JSON.stringify(msg.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result?.payloadSchema ? (
              <div className="rounded-md border bg-muted/25" data-testid="project-connector-peek-schema">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  {t('connectors.peek.latestSchema')}
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs">
                  {JSON.stringify(result.payloadSchema, null, 2)}
                </pre>
              </div>
            ) : null}

            {result && result.messages.length === 0 && !result.error && (
              <p className="text-sm text-muted-foreground">{t('connectors.peek.empty')}</p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
