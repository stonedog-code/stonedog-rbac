/**
 * stonedog-rbac — capabilities, checked against a scope.
 *
 * ```ts
 * can(subject, "article:read", { organisation: orgId });
 * ```
 *
 * Call sites ask for the permission they need, never for the role that happens
 * to carry it. Renaming, splitting or adding a role then changes one mapping
 * rather than every call site that named it.
 *
 * **This must never become a prerequisite.** Anything needing an authorisation
 * answer should be able to accept a callback and get on with it; this package
 * supplies a ready-made implementation of such a callback as a convenience. If
 * it becomes required, the interface has been drawn wrong.
 */

export { can, capabilitiesIn } from "./can";

export {
  ladderRoleMap,
  subjectFromRoles,
  UnknownRoleError,
  type RoleAssignment,
  type RoleMap,
  type SubjectFromRolesOptions,
} from "./roles";

export type {
  CanOptions,
  Capability,
  Grant,
  Scope,
  ScopeArgument,
  ScopeResolver,
  Subject,
} from "./types";
