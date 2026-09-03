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
 * The reserved prefix that marks a capability as **operator-only**.
 *
 * Everything else about capability naming is a convention this package does
 * not enforce. This one prefix is a rule, and the asymmetry is deliberate —
 * see {@link isInternalCapability}.
 */
export const INTERNAL_CAPABILITY_PREFIX = "internal:";

/**
 * Is this capability reserved for internal operators?
 *
 * ## Why a reserved prefix rather than a configured list
 *
 * The distinction being drawn here is **audience**, not level: an internal
 * operator versus a customer who happens to administer their own tenant. Every
 * product in this fleet has both, and both are called "admin" — hopperguard's
 * `System Admin` (99) is staff while `Brand Admin` (89) is a customer;
 * rozcards' `ADMIN` (1000) is staff. That is precisely why the mistake is easy.
 *
 * The failure to defend against is a **role map that grants an operator
 * capability to a customer role**. So the evaluator has to learn "this is
 * operator-only" from somewhere the mistaken role map cannot reach:
 *
 * - a per-call option is forgettable, and forgetting it **grants** — it fails
 *   open, in the one place a package like this must not;
 * - a registry configured at boot is better, but still a thing that can be
 *   left unconfigured, and an unconfigured registry also fails open;
 * - a reserved prefix cannot be forgotten, because it travels in the
 *   capability name itself.
 *
 * A namespace is a smaller commitment than it looks: this package still does
 * not care whether you write `resource:verb`. It reserves one prefix, and only
 * ever to DENY.
 */
export function isInternalCapability(capability: Capability): boolean {
  return capability.startsWith(INTERNAL_CAPABILITY_PREFIX);
}

/**
 * Which side of the product the principal is on.
 *
 * NOT a rank. An internal operator is not "a customer plus one" — the two are
 * different audiences, which is exactly what an ordered ladder cannot say and
 * why adding a number here would reintroduce what this package exists to
 * avoid. A customer admin can hold capabilities no operator has, and that is
 * not a contradiction.
 */
export type Principal = "internal" | "customer";

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
  /**
   * Whether this is an internal operator or a customer.
   *
   * **Absent means `"customer"`**, and that default is the whole point: a host
   * that has not thought about the distinction gets the safe answer, and a
   * subject assembled by hand in a test or a script cannot accidentally be
   * treated as staff. Being internal has to be asserted, never inferred.
   *
   * Independent of grants on purpose. Two facts must hold for an
   * `internal:`-prefixed capability — the subject is an operator AND the
   * capability was granted — so neither a mistaken role map nor a mislabelled
   * principal is sufficient on its own.
   */
  principal?: Principal;
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
