// AccessControlService — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.6
//
// Decides whether `actor + project + action` is allowed. The OSS default `LocalAccessControlService`
// applies coarse actorKind rules and ignores `project`; the SaaS form (`RbacAccessControl`, in a separate
// repo) reads actor org membership / role + project and may perform async lookups — hence the async signature.

import type { ActorContext, ProjectContext } from '../actor-context';
import type { AccessAction } from '../access-control';

export abstract class AccessControlService {
  abstract assertCan(actor: ActorContext, project: ProjectContext, action: AccessAction): Promise<void>;
}
