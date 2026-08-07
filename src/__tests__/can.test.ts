import { can, capabilitiesIn } from "../can";
import type { ScopeResolver, Subject } from "../types";

const subject = (...grants: Subject["grants"]): Subject => ({ grants });

/**
 * org-1 contains site-a and site-b; site-a contains team-x.
 *
 * Written as a child → parents map, because that is the direction a correct
 * resolver answers in.
 */
const parents: Record<string, string[]> = {
  "team-x": ["site-a"],
  "site-a": ["org-1"],
  "site-b": ["org-1"],
};
const containing: ScopeResolver = (scope) => parents[scope] ?? [];

describe("global grants", () => {
  it("satisfy a global check", () => {
    expect(can(subject({ capability: "article:read" }), "article:read")).toBe(true);
  });

  it("satisfy a scoped check", () => {
    // What lets a genuinely global capability exist, and what lets an
    // application with one audience ignore scopes entirely.
    expect(can(subject({ capability: "article:read" }), "article:read", "org-1")).toBe(true);
  });
});

describe("scoped grants", () => {
  it("satisfy a check in exactly that scope", () => {
    const s = subject({ capability: "article:read", scope: "org-1" });
    expect(can(s, "article:read", "org-1")).toBe(true);
  });

  it("DO NOT satisfy a check in a sibling scope", () => {
    // The single property the ordered ladders cannot express, and the one whose
    // absence is invisible until it has leaked something.
    const s = subject({ capability: "article:read", scope: "org-1" });
    expect(can(s, "article:read", "org-2")).toBe(false);
  });

  it("DO NOT satisfy a GLOBAL check", () => {
    // "May this person read articles anywhere" must not be answered yes by
    // someone who may read them in one organisation.
    const s = subject({ capability: "article:read", scope: "org-1" });
    expect(can(s, "article:read")).toBe(false);
  });
});

describe("capabilities are not ordered", () => {
  it("holding one capability says nothing about another", () => {
    // A lateral role grants a different area rather than a higher one. Under a
    // ladder it has no position on a >= scale and the code falls back to
    // comparing role names as strings.
    const artwork = subject({ capability: "artwork:manage" });
    expect(can(artwork, "artwork:manage")).toBe(true);
    expect(can(artwork, "member:invite")).toBe(false);
    expect(can(artwork, "article:read")).toBe(false);
  });
});

describe("scope hierarchy, via the resolver", () => {
  const orgAdmin = subject({ capability: "article:read", scope: "org-1" });

  it("lets a grant on a container satisfy a check on what it contains", () => {
    expect(can(orgAdmin, "article:read", "site-a", { resolveContainingScopes: containing })).toBe(
      true,
    );
    expect(can(orgAdmin, "article:read", "team-x", { resolveContainingScopes: containing })).toBe(
      true,
    );
  });

  it("does NOT let a grant on a contained scope satisfy a check on its container", () => {
    // The direction that matters. A site admin is not an org admin.
    const siteAdmin = subject({ capability: "article:read", scope: "site-a" });
    expect(can(siteAdmin, "article:read", "org-1", { resolveContainingScopes: containing })).toBe(
      false,
    );
  });

  it("does NOT reach sideways between siblings", () => {
    const siteAdmin = subject({ capability: "article:read", scope: "site-a" });
    expect(can(siteAdmin, "article:read", "site-b", { resolveContainingScopes: containing })).toBe(
      false,
    );
  });

  it("REFUSES to walk when no resolver is supplied", () => {
    // Without one, a grant satisfies a check only in exactly the scope granted.
    // Defaulting to some built-in notion of hierarchy is how a package starts
    // deciding containment on a host's behalf.
    expect(can(orgAdmin, "article:read", "site-a")).toBe(false);
  });

  it("an INVERTED resolver does not silently grant downward", () => {
    // The trap the PRD names. A resolver returning children rather than parents
    // inverts every check: a grant on one team would satisfy a check on its
    // organisation, and therefore on every other team in it.
    //
    // The package cannot detect the mistake — a resolver is opaque by design —
    // so what this asserts is that `can` walks in exactly one direction and
    // that the direction is the documented one. Feed it the wrong map and you
    // get the wrong answer, which is why the type is named `containingScopes`.
    const children: ScopeResolver = (scope) =>
      Object.entries(parents)
        .filter(([, ps]) => ps.includes(scope))
        .map(([child]) => child);

    const siteAdmin = subject({ capability: "article:read", scope: "site-a" });

    // With the correct resolver: a site grant does not reach the org. With the
    // inverted one it does — demonstrating that direction is load-bearing, and
    // pinning the behaviour so a refactor cannot quietly reverse the walk.
    expect(can(siteAdmin, "article:read", "org-1", { resolveContainingScopes: containing })).toBe(
      false,
    );
    expect(can(siteAdmin, "article:read", "org-1", { resolveContainingScopes: children })).toBe(
      true,
    );
  });

  it("denies rather than hanging on a cyclic hierarchy", () => {
    // A host bug. An authorisation check is the wrong place to turn a
    // configuration mistake into an outage, and denying is the safe direction.
    const cyclic: ScopeResolver = (scope) => (scope === "a" ? ["b"] : ["a"]);
    const s = subject({ capability: "article:read", scope: "unreachable" });

    expect(can(s, "article:read", "a", { resolveContainingScopes: cyclic })).toBe(false);
  });

  it("stops at the configured depth", () => {
    // A very deep chain: 0 → 1 → 2 → …
    const deep: ScopeResolver = (scope) => [String(Number(scope) + 1)];
    const s = subject({ capability: "article:read", scope: "50" });

    expect(can(s, "article:read", "0", { resolveContainingScopes: deep, maxScopeDepth: 5 })).toBe(
      false,
    );
    expect(can(s, "article:read", "0", { resolveContainingScopes: deep, maxScopeDepth: 60 })).toBe(
      true,
    );
  });

  it("handles a diamond without visiting a scope twice", () => {
    let calls = 0;
    const diamond: ScopeResolver = (scope) => {
      calls += 1;
      if (scope === "leaf") return ["left", "right"];
      if (scope === "left" || scope === "right") return ["root"];
      return [];
    };
    const s = subject({ capability: "x", scope: "nowhere" });

    expect(can(s, "x", "leaf", { resolveContainingScopes: diamond })).toBe(false);
    // leaf, left, right, root — root reached once, not twice.
    expect(calls).toBe(4);
  });
});

describe("edge cases that must not throw", () => {
  it("a subject with no grants is simply denied", () => {
    // The common case for an anonymous visitor.
    expect(can(subject(), "article:read")).toBe(false);
    expect(can(subject(), "article:read", "org-1")).toBe(false);
  });

  it("an unknown capability is denied, not an error", () => {
    const s = subject({ capability: "article:read" });
    expect(can(s, "article:delete")).toBe(false);
  });

  it("capability names are compared exactly, with no prefix magic", () => {
    // `article:read` must not imply `article:read-all`, and vice versa.
    const s = subject({ capability: "article:read" });
    expect(can(s, "article:read-all")).toBe(false);
    expect(can(subject({ capability: "article:read-all" }), "article:read")).toBe(false);
  });
});

describe("capabilitiesIn", () => {
  const s = subject(
    { capability: "article:read" },
    { capability: "article:write", scope: "org-1" },
    { capability: "member:invite", scope: "org-2" },
  );

  it("returns what the subject holds in the given scope", () => {
    expect([...capabilitiesIn(s, "org-1")].sort()).toEqual(["article:read", "article:write"]);
  });

  it("returns only global capabilities for a global query", () => {
    expect([...capabilitiesIn(s)]).toEqual(["article:read"]);
  });

  it("agrees with `can` for every capability the subject holds anywhere", () => {
    // The whole risk of a convenience like this is that it drifts from the
    // enforcement path and a screen starts showing a button the request refuses.
    for (const scope of ["org-1", "org-2", "org-3", undefined]) {
      const held = capabilitiesIn(s, scope);
      for (const grant of s.grants) {
        expect(held.has(grant.capability)).toBe(can(s, grant.capability, scope));
      }
    }
  });
});
