# @stonedogcode/rbac

A shared authorisation model: **capabilities, checked against a scope**.

The model was agreed before any code was written, because it is very hard to
change once applications have adopted it. See
[`docs/prd/authorisation-model.md`](./docs/prd/authorisation-model.md) for the
reasoning and for the three decisions that shaped it.

## The shape

```ts
can(subject, capability, scope?) : boolean
```

Call sites ask for the **permission they need**, never for the role that happens
to carry it:

```ts
can(subject, "article:read", { organisation: orgId });   // yes
hasPermission(role, 99);                                  // no
roleName === "Some Admin";                                // no
```

Three properties the design is built around, each of which an ordered numeric
role ladder cannot provide:

- **Scope.** A subject holds capabilities *within* a scope, and a grant in one
  scope never satisfies a check in another. An application with a single global
  scope omits the argument.
- **Lateral roles.** A role that grants a *different* area rather than a *higher*
  one has no position on a `>=` scale. Under a ladder these end up as string
  comparisons against role names; here they are simply a different capability
  set.
- **Rename resistance.** Renaming, splitting, or adding a role changes one
  mapping rather than every call site that named it.

## Operator-only capabilities

Every product here has a **top-level admin role that is internal staff** —
hopperguard's `System Admin`, rozcards' `ADMIN` — and **lesser admin roles that
customers legitimately hold**: a brand admin, a facility admin, an organisation
admin. Both are called "admin". That is why the mistake is easy, and why the
distinction has to be declared rather than guessed from a name or a rank.

The distinction is **audience, not level**. An internal operator is not "a
customer plus one" — a customer admin can hold capabilities no operator has.
Expressing it as a rank is exactly what this package exists to avoid.

```ts
const subject = subjectFromRoles(assignments, roleMap, {
  internalRoles: ["System Admin"],          // declared, never inferred
});

can(subject, "internal:secrets:read");      // operator only
can(subject, "article:read");               // unchanged for everyone
```

**Two facts must hold** for an `internal:`-prefixed capability: the subject is
an operator **and** the capability was granted. Neither is sufficient alone, so
`principal` is not a super-admin flag and a mistaken role map cannot expose an
operator surface.

**The prefix is reserved rather than configured, and that is the point.** The
failure to defend against is a role map granting an operator capability to a
customer-facing role — so the evaluator must learn "operator-only" from
somewhere that mistaken map cannot reach. A per-call option is forgettable and
forgetting it *grants*; a boot-time registry can be left unconfigured, which
also fails open. A prefix travels in the capability name and cannot be
forgotten.

This is still grant-only. Rule 0 is a property of the **capability**, not of a
grant, so no ordering changes the answer; "why was this denied" stays
answerable in one sentence; and it can only ever deny.

**Absent `principal` means `"customer"`.** A host that has not thought about the
distinction gets the safe answer, and a subject assembled by hand in a test
cannot accidentally be staff.

## What it will not hold

**No role catalogue.** Role names are product data and stay in the application
that owns them. This package ships the evaluator and the types; each host
supplies its own role → capability mapping from wherever its roles already live.

**No authentication, no policy language, no row-level filtering.** See the
non-goals in the PRD. Authentication is
[`@stonedogcode/auth`](https://github.com/stonedog-code/stonedog-auth), and it
is a separate package for the same reason this one has no role catalogue.

**No negation.** Grant-only, deliberately. Negation makes the answer depend on
the order grants were applied and makes "why was this denied" unanswerable
without a trace. The cases that look like denial — a suspended account, a
read-only member — are better modelled as a smaller capability set. It can be
added later; it cannot be removed later.

## Usage

```ts
import { can, subjectFromRoles } from "@stonedogcode/rbac";

const roleMap = {
  Viewer: ["article:read"],
  Editor: ["article:read", "article:write"],
  "Artwork Admin": ["artwork:manage"],   // lateral, not higher
};

const subject = subjectFromRoles(
  [{ role: "Editor", scope: orgId }, { role: "Artwork Admin" }],
  roleMap,
);

can(subject, "article:write", orgId);      // true
can(subject, "article:write", otherOrgId); // false — a grant does not travel
can(subject, "article:write");             // false — nor does it become global
```

### Scope hierarchy

Scope is **opaque**: the package compares scopes and does nothing else with
them. If yours nest, supply a resolver that answers *what contains this*:

```ts
can(subject, "article:read", teamId, {
  resolveContainingScopes: (scope) => parentsOf(scope),
});
```

**The direction is load-bearing.** A resolver that returns a scope's *children*
inverts every check — a grant on one team would satisfy a check on its
organisation, and so on every other team in it. Nothing throws and nothing looks
wrong. The type is named `containingScopes` for that reason, and the walk's
direction is pinned by a test against a deliberately inverted resolver.

A cyclic hierarchy is a host bug; the walk is depth-bounded and **denies** rather
than hanging. An authorisation check is the wrong place to turn a configuration
mistake into an outage.

### The ladder adapter

`ladderRoleMap` turns an ordered tier list into a role map, so an application
with a numeric ladder can adopt this without rewriting every call site at once.

**It ships deprecated.** It exists to make migration incremental and for no
other reason, and it is removed in the first major release after the last
ladder-shaped call site is gone. Treat every call site it supports as work
remaining rather than work done — a ladder cannot express a lateral role or a
scoped one, which is what sends those call sites back to comparing role names
as strings.

## What it must never become

A prerequisite. Anything needing an authorisation answer should be able to accept
a callback and get on with it — this package supplies a ready-made implementation
of such a callback as a *convenience*. If it becomes required, the interface has
been drawn wrong.

## Licence

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
