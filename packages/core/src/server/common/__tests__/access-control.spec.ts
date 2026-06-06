import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ActorContext, ProjectContext } from '../actor-context';
import { LocalAccessControlService } from '../contracts/local-access-control.service';

const project: ProjectContext = { projectId: '11111111-1111-4111-8111-111111111111', source: 'local' };

describe('LocalAccessControlService', () => {
  const svc = new LocalAccessControlService();

  it('local_user (UI session) 允许全部 action，包括 platform_manage', async () => {
    const actor: ActorContext = {
      actorId: '00000000-0000-4000-8000-000000000001',
      actorKind: 'local_user',
    };

    await expect(svc.assertCan(actor, project, 'platform_manage')).resolves.toBeUndefined();
    await expect(svc.assertCan(actor, project, 'project_write')).resolves.toBeUndefined();
    await expect(svc.assertCan(actor, project, 'user_token_manage')).resolves.toBeUndefined();
  });

  it('script (API token) 允许 project + token action，但禁 platform_manage', async () => {
    const actor: ActorContext = {
      actorId: '22222222-2222-4222-8222-222222222222',
      actorKind: 'script',
    };

    await expect(svc.assertCan(actor, project, 'mcp_tool')).resolves.toBeUndefined();
    await expect(svc.assertCan(actor, project, 'project_write')).resolves.toBeUndefined();
    await expect(svc.assertCan(actor, project, 'user_token_manage')).resolves.toBeUndefined();
    await expect(svc.assertCan(actor, project, 'platform_manage')).rejects.toThrow(ForbiddenException);
  });

  it('system actors 在 OSS 下全部 action 通过', async () => {
    const mcp: ActorContext = { actorId: 'mcp-1', actorKind: 'system_mcp' };
    const webhook: ActorContext = { actorId: 'conn-1', actorKind: 'system_webhook' };
    const releaseRunner: ActorContext = { actorId: 'line-1', actorKind: 'system_release_runner' };
    const workflowRecovery: ActorContext = { actorId: 'workflow-row-1', actorKind: 'system_workflow_recovery' };

    await expect(svc.assertCan(mcp, project, 'platform_manage')).resolves.toBeUndefined();
    await expect(svc.assertCan(webhook, project, 'project_write')).resolves.toBeUndefined();
    await expect(svc.assertCan(releaseRunner, project, 'project_read')).resolves.toBeUndefined();
    await expect(svc.assertCan(workflowRecovery, project, 'project_read')).resolves.toBeUndefined();
  });

  it('未知 actorKind 一律 forbidden', async () => {
    const unknown = { actorId: 'x', actorKind: 'mystery' } as unknown as ActorContext;

    await expect(svc.assertCan(unknown, project, 'project_read')).rejects.toThrow(ForbiddenException);
  });
});
