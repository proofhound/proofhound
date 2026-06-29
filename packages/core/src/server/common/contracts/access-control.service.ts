// AccessControlService — adapter extension point
// See docs/specs/08-adapter-extension-points.md §3.6
//
// Decides whether `actor + project + action` is allowed. The OSS default `LocalAccessControlService`
// applies coarse actorKind rules and ignores `project`; a replacement implementation (`RbacAccessControl`, in a separate
// repo) reads actor org membership / role + project and may perform async lookups — hence the async signature.

import type { ActorContext, ProjectContext } from '../actor-context';
import type { AccessAction } from '../access-control';

export abstract class AccessControlService {
  abstract assertCan(actor: ActorContext, project: ProjectContext, action: AccessAction): Promise<void>;
}
