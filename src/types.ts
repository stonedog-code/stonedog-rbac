/**
 * The authorisation model: capabilities, checked against a scope.
 *
 * Two things are deliberately absent and their absence is the design.
 *
 * **No role catalogue.** Role names are product data and stay in the
 * application that owns them. This package ships the evaluator and the types;
 * each host supplies its own role → capability mapping from wherever its roles
 * already live — database rows, a static constant, an organisation membership.
 *
 * **No ordering.** A capability set is a set. Nothing here can be compared with
 * `>=`, because the moment it can, a lateral role — one that grants a
 * *different* area rather than a *higher* one — has to be given a position on a
 * scale where it does not belong, and the call sites start comparing role names
 * as strings instead.
 */

/**
 * A permission, named for what it lets you do.
 *
 * Call sites ask for the capability they need, never for the role that happens
 * to carry it. That is what survives a role being renamed, split, or added —
 * one mapping changes rather than every call site that named it.
 *
 * A plain string rather than a union, because the catalogue belongs to the
 * host. The convention is `resource:verb` (`article:read`, `member:invite`),
 * and it is a convention rather than a rule this package enforces.
 */
export type Capability = string;

/**
 * Where a capability applies.
 *
 * **Opaque.** This package compares scopes and does nothing else with them. It
 * does not know that an organisation contains sites, or that a site contains
 * teams — see {@link ScopeResolver} for how hierarchy is reached.
 *
 * A structured scope was considered and rejected: it would make this package
 * own containment rules that the applications adopting it do not agree on, and
 * it is the single hardest thing here to change once anyone depends on it.
 */
export type Scope = string;

/**
 * `undefined` scope means the global scope — an application with one audience
 * omits the argument entirely and never thinks about scopes again.
 *
 * It is a distinct value rather than a magic string, so a host cannot
 * accidentally name a real scope `"global"` and collide with it.
 */
export type ScopeArgument = Scope | undefined;

/** One grant: this capability, in this scope. */
export interface Grant {
  capability: Capability;
  /** Omitted for a global grant. */
  scope?: Scope;
}

/**
 * Whoever is being checked, as far as this package is concerned.
 *
 * Deliberately thin: an opaque id and a list of grants. No name, no email, no
 * role. A subject that carried a role would invite a call site to read it.
 */
export interface Subject {
  /** Opaque to this package. Diagnostics only; never part of a decision. */
  id?: string;
  grants: readonly Grant[];
}

/**
 * Given a scope, return the scopes that **contain** it — nearest first, and
 * never including the scope itself.
 *
 * So a check against a team can be satisfied by a grant on its site or its
 * organisation, without this package knowing what any of those words mean.
 *
 * ## The direction matters, and getting it backwards is silent
 *
 * A resolver that returns a scope's *children* inverts every check: a grant on
 * one team would satisfy a check on its organisation, and therefore on every
 * other team in it. Nothing throws, nothing looks wrong, and the failure is
 * a privilege escalation in the most permissive direction.
 *
 * The name says `containing` for that reason, and `can` is tested against a
 * deliberately inverted resolver so the difference is asserted rather than
 * assumed.
 *
 * Must be pure and terminating. A cyclic hierarchy is a host bug; this package
 * bounds the walk rather than hanging on it.
 */
export type ScopeResolver = (scope: Scope) => readonly Scope[];

export interface CanOptions {
  /**
   * Supplied by hosts whose scopes nest. Omit it and a grant satisfies a check
   * only in exactly the scope it was granted in.
   */
  resolveContainingScopes?: ScopeResolver;
  /**
   * How far to walk up before giving up, as a guard against a cyclic resolver.
   * Reaching it denies rather than throws: an authorisation check is the wrong
   * place to turn a configuration mistake into an outage, and denying is the
   * safe direction.
   */
  maxScopeDepth?: number;
}
