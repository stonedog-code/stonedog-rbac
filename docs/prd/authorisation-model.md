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

## Open questions

- Whether scope should be an opaque host-supplied key or a structured value the
  package understands well enough to express hierarchy (an organisation
  containing sites containing teams).
- Whether capability sets should support negation, or whether "grant only" with
  smaller roles is sufficient. Negation is easy to add and very hard to reason
  about once present.
- Whether the ladder adapter should be permanent or explicitly deprecated on a
  timetable, so it does not become the way everyone keeps writing checks.
