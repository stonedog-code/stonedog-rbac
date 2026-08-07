# PRD — A shared authorisation model

## Summary

Three applications built by the same people each answer "may this person do this?"
in their own way. Two of them agree with each other and **contradict** the third,
and the third is right. This package exists to give all three one answer — but
the answer must not be either of the two that already have code behind them.

The decision this document exists to settle is the model itself: **capabilities
checked against a scope**, not a global ordered ladder of roles. Everything else
follows from that, and it is very expensive to change once three applications
have adopted it.

## The three models today

| | Shape | Scoped | Enforced |
|---|---|---|---|
| **A** | roles from database rows → numeric level, `level >= required` | no — one global role per user | yes, widely |
| **B** | roles as a static constant → numeric level, `level >= required` | no — one global level per user | yes |
| **C** | named enum stored on **membership of an organisation** | **yes** | **no — nothing reads it** |

A and B are the same design reached twice independently. C is a different design
reached deliberately, and its schema says why:

> Roles are per-membership, never per-user: the same person can be an owner of
> their own account and a viewer on a client's, and a global role would leak the
> higher privilege into the lower context.

That is not a stylistic difference. Extracting A's or B's ladder as the shared
package would hand C — the one application with **no enforcement at all today** —
a model its own schema documents as unsafe. **The global ordered ladder is the
thing to avoid, not the thing to extract.**

## The ladder is already failing where it exists

It is tempting to treat A and B as the mature implementations and C as the
outlier. The evidence inside A says otherwise. One representative access check
needs four gates, and only two of them can use the ladder at all — the other two
fall back to comparing the role's **name** as a string, because those roles are
lateral: they grant a different area of the product, not a higher rung, and they
have no meaningful position on a `>=` scale.

The same application's documentation gating is a **set-membership** test —
does the reader hold one of the roles this article names — not a level test. So
is the article metadata format that feeds it.

Both existing implementations already reach past the ladder wherever the real
authorisation question is asked. The ladder survives because it is adequate for
the easy half of the checks, and it is invisible that the other half has quietly
become string comparison.

## Goals

- **One way to ask** "may this person do this, here?", usable by all three.
- **Scope is expressible**, so a permission granted in one organisation cannot be
  exercised in another.
- **Lateral roles are expressible** without string comparison.
- **Adoption is incremental.** No application rewrites every call site at once.
- **The package holds no role catalogue.** Role names are product data.

## Non-goals

- **Authentication.** Who someone is, sessions, tokens, MFA — all out.
- **A policy language.** No expression parser, no rules DSL, no data-driven
  policy documents. Capabilities and scopes are enough for what these
  applications actually check.
- **Row-level filtering.** Deciding *which* records a person may see is a query
  concern. This answers a yes/no question about an action.
- **Replacing an application's role storage.** Roles stay where they are.

## The model

```ts
can(subject, capability, scope?) : boolean
```

### Capabilities, not roles, at the call site

A call site asks for the **permission it needs**, never for the role that happens
to carry it:

```ts
can(subject, "article:read", { organisation: orgId })   // yes
hasPermission(role, 99)                                  // no
roleName === "Some Admin"                                // no
```

This is what makes a role rename, split, or addition a change in one mapping
rather than a search across the codebase — and it is what removes the string
comparisons, because a lateral role is simply a role whose capability set is
different rather than larger.

Naming convention: `subject:verb`, lowercase, colon-separated
(`article:read`, `member:invite`, `billing:manage`). Flat, not hierarchical —
hierarchy in capability names invites prefix matching, and prefix matching is how
`billing:manage` accidentally grants `billing:manage:refund` that nobody
reviewed.

### Roles map to capability sets, and the host owns the map

The package ships the evaluator and the types. Each application supplies its own
role → capability mapping from wherever its roles already live: database rows for
one, a static constant for another, an organisation membership for the third.

### Scope is a first-class, optional argument

A subject holds capabilities **within a scope**. An application with a single
global scope omits the argument and gets today's behaviour; an application with
per-organisation membership passes the organisation and gets a correct answer
rather than a leaked one.

The critical property: **a grant in one scope must never satisfy a check in
another.** This is the one thing the existing ladders cannot express, and the one
thing whose absence is invisible until it has leaked something.

### A ladder adapter, so adoption is incremental

Ordered tiers are expressible as capability sets, generated from the same tier
list an application already has. That keeps existing `hasRole`-shaped call sites
working while they are migrated one at a time. Adoption must never require a
big-bang rewrite — a security refactor that has to land all at once is a security
refactor that lands unreviewed.

### No framework coupling in the core

One existing implementation's guards redirect using a specific web framework's
navigation API; another's library does not. Redirect and HTTP-status behaviour
belong in an optional adapter or in the host, so the core stays a pure function
that can be tested and run anywhere.

## Explicitly out of scope for v1

One application's multi-factor policy — which factor types an elevated account
must use, and the threshold at which it applies — is a compliance control with
hard-coded factor names and a hard-coded numeric level. The *concept*
generalises; that implementation does not. It stays where it is until the
capability model is settled. A compliance control should not be refactored as a
side effect of a package migration; that is the wrong reason to touch it and the
wrong review to touch it in.

## Rollout

1. **This document, agreed** — the model is the expensive decision.
2. **The package**: evaluator, types, ladder adapter, optional framework adapter.
   All three test tiers.
3. **The unenforced application adopts first.** It has the model that drove the
   design, no legacy call sites, and no enforcement today — so adoption closes a
   real gap rather than merely relocating working code, and it is the honest test
   of whether the scope model holds.
   **A greenfield internal tool adopts alongside it**, for the same reason and
   more cheaply: it has no call sites at all, so if the scope resolver is awkward
   to implement there, it is awkward, and nothing else is confounding the answer.
4. **The smallest ladder next**, as the cheapest proof that incremental migration
   works.
5. **The largest last**, keeping its existing permissions module as a thin shim
   rather than deleting it in one change.

## What this must not become

**A prerequisite for anything.** A consumer that needs an authorisation answer
should be able to take a callback and get on with it; this package supplies a
ready-made implementation of such a callback as a *convenience*. The
documentation package already consuming one works exactly this way, and it must
keep working without this package ever being installed. If this becomes a soft
prerequisite, the interface has been drawn wrong.

## Decisions

These three were deliberately left open when this document was first written,
because each is expensive to change once applications have adopted the model.
All three are now settled.

### Scope is an opaque key, with an optional host-supplied resolver

Scope is a value the package **compares and nothing else**. It does not know
that an organisation contains sites, or that a site contains teams.

Hierarchy is reached through a resolver the host may supply: given a scope,
return the scopes that contain it. A check against a site can then be satisfied
by a grant at the organisation, and the package walks whatever it is handed
without ever inventing the relation.

*Why not a structured scope.* A structured value means the package owns the
containment rules, and the three applications do not agree on them — one nests
sites under organisations, one has organisations that do not nest at all, and
one has a single global scope. Encoding any of those makes the other two express
their model as a lie. It is also the hardest thing here to change later, which
is the argument for giving it the smallest possible surface.

*The trap, which the implementation must test for.* A resolver that returns a
**descendant** instead of an ancestor inverts the check and grants downward —
silently, and in the most dangerous direction. The direction is stated in the
type's name (`containingScopes`, never `relatedScopes`) and asserted directly.

### No negation in v1

No `deny` capabilities. Grant-only.

Negation is cheap to add and expensive to live with: it makes the answer depend
on the *order* grants were applied, it makes "why was this denied" unanswerable
without a trace, and every subsequent feature has to define how it interacts
with denial. None of the three applications needs it — the cases that look like
denial (a suspended account, a read-only member) are better modelled as holding
a smaller capability set, which is also easier to read at the point of grant.

It can be added later without breaking anyone. It cannot be removed later. If a
real case arrives that a smaller set genuinely cannot express, bring the case
rather than the feature.

### The ladder adapter ships already deprecated

It carries a `@deprecated` tag naming its replacement from its first release,
and its own section in the README explaining that it exists to make migration
incremental and for no other reason.

An adapter with no stated end becomes the way everyone keeps writing checks —
at which point the ladder has been *extracted* rather than retired, which is the
outcome this whole document argues against. Both existing implementations
already reach past their ladder wherever the real authorisation question is
asked; the adapter exists to carry the call sites that have not yet been
rewritten, not to bless the shape.

**No calendar date.** A deadline nobody owns slips, and then gets deleted. The
end condition is a state instead: the adapter is removed in the first major
release after the last `hasRole`-shaped call site is gone. That makes its
removal a consequence of the migration finishing rather than a separate
negotiation with whoever is busiest that quarter.
