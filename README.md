# stonedog-rbac

A shared authorisation model: **capabilities, checked against a scope**.

> **Status: design only.** This repository currently holds the product
> requirements and no implementation. The model is the expensive decision — it is
> very hard to change once applications have adopted it — so it is being agreed
> before any code is written. See
> [`docs/prd/authorisation-model.md`](./docs/prd/authorisation-model.md).

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

## What it will not hold

**No role catalogue.** Role names are product data and stay in the application
that owns them. This package ships the evaluator and the types; each host
supplies its own role → capability mapping from wherever its roles already live.

**No authentication, no policy language, no row-level filtering.** See the
non-goals in the PRD.

## What it must never become

A prerequisite. Anything needing an authorisation answer should be able to accept
a callback and get on with it — this package supplies a ready-made implementation
of such a callback as a *convenience*. If it becomes required, the interface has
been drawn wrong.

## Licence

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
