/**
 * Operator-only capabilities: the `internal:` namespace.
 *
 * The distinction under test is AUDIENCE, not level — an internal operator
 * versus a customer who administers their own tenant. Every product in this
 * fleet has both and calls both "admin", which is why the mistake is easy and
 * why the guard has to hold even when the role map is wrong.
 *
 * Each case here is written from the failure it prevents, and the important
 * ones are the ones where the subject legitimately HOLDS the grant.
 */

import { can } from "../can";
import { subjectFromRoles } from "../roles";
import { INTERNAL_CAPABILITY_PREFIX, isInternalCapability, type Subject } from "../types";

const OPERATOR_CAP = "internal:secrets:read";
const ORDINARY_CAP = "article:read";

describe("isInternalCapability", () => {
  it("recognises the reserved prefix and nothing else", () => {
    expect(isInternalCapability(OPERATOR_CAP)).toBe(true);
    expect(isInternalCapability(INTERNAL_CAPABILITY_PREFIX)).toBe(true);
    expect(isInternalCapability(ORDINARY_CAP)).toBe(false);
  });

  it("does not match a capability that merely CONTAINS the word", () => {
    // `admin:internal:notes` is a host's ordinary capability. Substring
    // matching here would silently make it operator-only and break the host
    // with a denial nobody can explain.
    expect(isInternalCapability("admin:internal:notes")).toBe(false);
    expect(isInternalCapability("Internal:secrets")).toBe(false);
  });
});

describe("an internal capability is refused to a customer", () => {
  it("REFUSES it even when the subject holds the grant globally", () => {
    // The failure this exists for: a role map grants an operator capability to
    // a customer-facing role. The grant is real and the answer is still no.
    const subject: Subject = { grants: [{ capability: OPERATOR_CAP }] };
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("REFUSES it when the subject is explicitly a customer", () => {
    const subject: Subject = { grants: [{ capability: OPERATOR_CAP }], principal: "customer" };
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("REFUSES it in a scope the subject genuinely holds it in", () => {
    const subject: Subject = { grants: [{ capability: OPERATOR_CAP, scope: "org-7" }] };
    expect(can(subject, OPERATOR_CAP, "org-7")).toBe(false);
  });

  it("REFUSES it through a containing-scope walk", () => {
    // No indirection reaches it: the check happens before any scope resolution.
    const subject: Subject = { grants: [{ capability: OPERATOR_CAP, scope: "org-7" }] };
    expect(
      can(subject, OPERATOR_CAP, "team-1", { resolveContainingScopes: () => ["site-3", "org-7"] }),
    ).toBe(false);
  });
});

describe("an internal capability is allowed to an operator who holds it", () => {
  it("ALLOWS it — the guard must not make the page unreachable", () => {
    // A gate that refuses everyone is broken, not secure.
    const subject: Subject = { grants: [{ capability: OPERATOR_CAP }], principal: "internal" };
    expect(can(subject, OPERATOR_CAP)).toBe(true);
  });

  it("still REFUSES an operator who was never granted it", () => {
    // Being staff is one of two facts, not both. Otherwise `principal` becomes
    // a super-admin flag and the capability model stops meaning anything.
    const subject: Subject = { grants: [{ capability: ORDINARY_CAP }], principal: "internal" };
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("respects scope for operators exactly as for anyone else", () => {
    const subject: Subject = {
      grants: [{ capability: OPERATOR_CAP, scope: "org-7" }],
      principal: "internal",
    };
    expect(can(subject, OPERATOR_CAP, "org-7")).toBe(true);
    expect(can(subject, OPERATOR_CAP, "org-9")).toBe(false);
    // Rule 4 is unchanged: a scoped grant never answers a global check.
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });
});

describe("ordinary capabilities are untouched", () => {
  it("behaves identically for a customer and an operator", () => {
    const grants = [{ capability: ORDINARY_CAP }];
    expect(can({ grants }, ORDINARY_CAP)).toBe(true);
    expect(can({ grants, principal: "customer" }, ORDINARY_CAP)).toBe(true);
    expect(can({ grants, principal: "internal" }, ORDINARY_CAP)).toBe(true);
  });

  it("does not make an operator able to do things they were not granted", () => {
    expect(can({ grants: [], principal: "internal" }, ORDINARY_CAP)).toBe(false);
  });
});

describe("subjectFromRoles — declaring which roles are internal", () => {
  const roleMap = {
    "System Admin": [OPERATOR_CAP, ORDINARY_CAP],
    "Brand Admin": [ORDINARY_CAP],
    Member: [ORDINARY_CAP],
  };

  it("defaults every subject to customer — being staff is asserted, never inferred", () => {
    const subject = subjectFromRoles([{ role: "System Admin" }], roleMap);
    expect(subject.principal).toBeUndefined();
    // And the default is load-bearing, not cosmetic:
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("marks the subject internal when a declared internal role is held", () => {
    const subject = subjectFromRoles([{ role: "System Admin" }], roleMap, {
      internalRoles: ["System Admin"],
    });
    expect(subject.principal).toBe("internal");
    expect(can(subject, OPERATOR_CAP)).toBe(true);
  });

  it("does NOT mark a customer admin internal — the near-miss this exists for", () => {
    // hopperguard's Brand Admin is 89, one rung below System Admin at 99, and
    // has "Admin" in its name. Nothing about it may confer operator status.
    const subject = subjectFromRoles([{ role: "Brand Admin" }], roleMap, {
      internalRoles: ["System Admin"],
    });
    expect(subject.principal).toBeUndefined();
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("matches role names exactly — no prefix or case-insensitive matching", () => {
    // "Facility Admin" must not become internal because "Admin" is listed.
    const map = { Admin: [OPERATOR_CAP], "Facility Admin": [OPERATOR_CAP] };
    const subject = subjectFromRoles([{ role: "Facility Admin" }], map, {
      internalRoles: ["Admin"],
    });
    expect(subject.principal).toBeUndefined();
    expect(can(subject, OPERATOR_CAP)).toBe(false);
  });

  it("an UNKNOWN role confers no operator status, even if it is listed as internal", () => {
    // A role deleted from the map while a stale assignment survives in the
    // database contributes no capabilities — so it must not keep minting staff
    // either. Otherwise the safest cleanup (removing a role) has the most
    // dangerous side effect.
    const subject = subjectFromRoles([{ role: "Retired Admin" }], roleMap, {
      internalRoles: ["Retired Admin"],
    });
    expect(subject.principal).toBeUndefined();
  });

  it("one internal role among several assignments is enough", () => {
    const subject = subjectFromRoles(
      [{ role: "Member" }, { role: "System Admin", scope: "org-7" }],
      roleMap,
      { internalRoles: ["System Admin"] },
    );
    expect(subject.principal).toBe("internal");
  });

  it("omitting internalRoles leaves every subject a customer", () => {
    for (const role of Object.keys(roleMap)) {
      expect(subjectFromRoles([{ role }], roleMap).principal).toBeUndefined();
    }
  });
});
