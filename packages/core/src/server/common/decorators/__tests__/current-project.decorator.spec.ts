import type { ExecutionContext } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import { extractCurrentProject } from '../current-project.decorator';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('@CurrentProject', () => {
  it('returns request.projectContext when the guard attached it', () => {
    const project: ProjectContext = { projectId: 'p-1', source: 'local' };
    expect(extractCurrentProject(undefined, buildContext({ projectContext: project }))).toBe(project);
  });

  it('falls back to LOCAL_PROJECT_CONTEXT when absent', () => {
    expect(extractCurrentProject(undefined, buildContext({}))).toEqual(LOCAL_PROJECT_CONTEXT);
  });
});
