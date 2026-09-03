/**
 * The evaluator. One question, one answer.
 */

import { isInternalCapability } from "./types";
import type {
  CanOptions,
  Capability,
  Grant,
  Scope,
  ScopeArgument,
  Subject,
} from "./types";

const DEFAULT_MAX_SCOPE_DEPTH = 32;

/**
 * May this subject do this thing, here?
 *
 * ```ts
 * can(subject, "article:read");                       // global
 * can(subject, "article:read", { organisation });     // scoped
 * ```
 *
 * ## The rules, in the order they are applied
 *
 * 1. A **global grant** (one with no scope) satisfies any check, scoped or not.
 *    That is what lets an application with a single audience ignore scopes
 *    entirely, and what lets a genuinely global capability exist.
 * 2. A **scoped grant** satisfies a check in exactly that scope.
 * 3. With a resolver, a scoped grant also satisfies a check in any scope it
 *    **contains** — never the other way round.
 * 4. A **scoped grant never satisfies a global check.** This is the rule the
 *    whole package exists for: "may this person read articles *anywhere*" must
 *    not be answered yes by someone who may read them in one organisation.
 *
 * Grant-only. There is no deny, deliberately: negation makes the answer depend
 * on the order grants were applied and makes "why was this denied"
 * unanswerable. See the PRD.
 *
 * ## The one exception, and why it is not negation
 *
 * Rule 0 below refuses an `internal:`-prefixed capability to a subject that is
 * not an internal operator, whatever its grants say. That looks like the deny
 * this package rejects, and it is not:
 *
 * - it is a property of the **capability**, not of a grant, so no ordering of
 *   grants can change the answer;
 * - "why was this denied" stays answerable in one sentence — *this capability
 *   is operator-only and the subject is a customer*;
 * - it can only ever deny. A grant-only model stays grant-only when the sole
 *   addition removes permissions.
 *
 * What it defends against is a role map granting an operator capability to a
 * customer-facing role. That is a configuration mistake nobody notices, on the
 * one surface where noticing matters — and no arrangement of grants can be
 * made to expose it.
 */
export function can(
  subject: Subject,
  capability: Capability,
  scope?: ScopeArgument,
  options: CanOptions = {},
): boolean {
  // Rule 0. Checked before anything else, including the empty-grants
  // shortcut, so the answer cannot depend on what a subject happens to hold.
  // Absent `principal` means customer — being internal is asserted, never
  // inferred.
  if (isInternalCapability(capability) && subject.principal !== "internal") return false;

  // A subject with no grants is the common case for an anonymous visitor, and
  // must be cheap rather than an error.
  if (subject.grants.length === 0) return false;

  const relevant = subject.grants.filter((grant) => grant.capability === capability);
  if (relevant.length === 0) return false;

  // Rule 1. Checked first because it is the cheapest and the most common.
  if (relevant.some(isGlobal)) return true;

  // Rule 4. Every remaining grant is scoped, and this check is global, so no.
  if (scope === undefined) return false;

  // Rule 2.
  if (relevant.some((grant) => grant.scope === scope)) return true;

  // Rule 3.
  const resolve = options.resolveContainingScopes;
  if (!resolve) return false;

  const maxDepth = options.maxScopeDepth ?? DEFAULT_MAX_SCOPE_DEPTH;
  const granted = new Set(relevant.map((grant) => grant.scope));

  // Breadth-first, with a seen-set and a depth bound. A host's hierarchy is
  // supposed to be acyclic; if it is not, this denies rather than hangs —
  // an authorisation check is the wrong place to turn a configuration mistake
  // into an outage, and denying is the safe direction to fail in.
  const seen = new Set<Scope>([scope]);
  let frontier: readonly Scope[] = [scope];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: Scope[] = [];
    for (const current of frontier) {
      for (const parent of resolve(current)) {
        if (seen.has(parent)) continue;
        if (granted.has(parent)) return true;
        seen.add(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }

  return false;
}

function isGlobal(grant: Grant): boolean {
  return grant.scope === undefined;
}

/**
 * Every capability this subject holds in a scope, for building a UI.
 *
 * Offered because the alternative is a screen calling `can` twenty times and
 * one of the twenty being subtly wrong. It is **not** an authorisation
 * mechanism: enforce with `can` at the point of action, and use this only to
 * decide what to draw. A UI that hides a button is a courtesy; the check that
 * matters is the one on the request the button sends.
 */
export function capabilitiesIn(
  subject: Subject,
  scope?: ScopeArgument,
  options: CanOptions = {},
): Set<Capability> {
  const held = new Set<Capability>();
  for (const grant of subject.grants) {
    if (held.has(grant.capability)) continue;
    if (can(subject, grant.capability, scope, options)) held.add(grant.capability);
  }
  return held;
}
