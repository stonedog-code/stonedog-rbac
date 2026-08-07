import { can } from "../can";
import { ladderRoleMap, subjectFromRoles, UnknownRoleError } from "../roles";
import type { RoleMap } from "../roles";

const roleMap: RoleMap = {
  Viewer: ["article:read"],
  Editor: ["article:read", "article:write"],
  "Organization Admin": ["article:read", "article:write", "member:invite"],
  // A LATERAL role: a different area, not a higher one. It has no position on
  // any ordered scale, which is the case a ladder cannot express.
  "Artwork Admin": ["artwork:manage"],
};

describe("subjectFromRoles", () => {
  it("expands a role into its capabilities", () => {
    const subject = subjectFromRoles([{ role: "Editor" }], roleMap);
    expect(can(subject, "article:read")).toBe(true);
    expect(can(subject, "article:write")).toBe(true);
    expect(can(subject, "member:invite")).toBe(false);
  });

  it("takes the scope from the ASSIGNMENT, not the role", () => {
    // The thing a global role model cannot express: the same role name held in
    // two organisations is two scoped grants, not one global one.
    const subject = subjectFromRoles(
      [
        { role: "Organization Admin", scope: "org-1" },
        { role: "Viewer", scope: "org-2" },
      ],
      roleMap,
    );

    expect(can(subject, "member:invite", "org-1")).toBe(true);
    expect(can(subject, "member:invite", "org-2")).toBe(false);
    expect(can(subject, "article:read", "org-2")).toBe(true);
    // And neither reaches the global scope.
    expect(can(subject, "member:invite")).toBe(false);
  });

  it("keeps a lateral role separate from the ladder-shaped ones", () => {
    const subject = subjectFromRoles(
      [{ role: "Viewer" }, { role: "Artwork Admin" }],
      roleMap,
    );
    expect(can(subject, "artwork:manage")).toBe(true);
    expect(can(subject, "article:write")).toBe(false);
  });

  it("IGNORES an unknown role by default", () => {
    // Role rows outlive the code that knew about them. A role deleted from the
    // map while a stale assignment sits in the database must not be a crash on
    // somebody's sign-in.
    const subject = subjectFromRoles(
      [{ role: "Viewer" }, { role: "RoleDeletedLastYear" }],
      roleMap,
    );
    expect(can(subject, "article:read")).toBe(true);
    expect(subject.grants).toHaveLength(1);
  });

  it("can be asked to throw on an unknown role instead", () => {
    // For a boot check or a test, where the noise is useful rather than
    // dangerous.
    expect(() =>
      subjectFromRoles([{ role: "Nope" }], roleMap, { onUnknownRole: "throw" }),
    ).toThrow(UnknownRoleError);
  });

  it("deduplicates a capability two roles share in one scope", () => {
    const subject = subjectFromRoles(
      [
        { role: "Viewer", scope: "org-1" },
        { role: "Editor", scope: "org-1" },
      ],
      roleMap,
    );
    const reads = subject.grants.filter((g) => g.capability === "article:read");
    expect(reads).toHaveLength(1);
  });

  it("does NOT deduplicate the same capability across DIFFERENT scopes", () => {
    // They are genuinely different grants, and collapsing them would be the
    // privilege leak this package exists to prevent.
    const subject = subjectFromRoles(
      [
        { role: "Viewer", scope: "org-1" },
        { role: "Viewer", scope: "org-2" },
      ],
      roleMap,
    );
    expect(subject.grants.filter((g) => g.capability === "article:read")).toHaveLength(2);
    expect(can(subject, "article:read", "org-1")).toBe(true);
    expect(can(subject, "article:read", "org-2")).toBe(true);
    expect(can(subject, "article:read", "org-3")).toBe(false);
  });

  it("does not treat a global assignment and a scoped one as the same grant", () => {
    const subject = subjectFromRoles(
      [{ role: "Viewer" }, { role: "Viewer", scope: "org-1" }],
      roleMap,
    );
    expect(subject.grants).toHaveLength(2);
  });

  it("returns an empty subject for no assignments", () => {
    expect(subjectFromRoles([], roleMap).grants).toEqual([]);
  });
});

describe("the ladder adapter", () => {
  const tiers = [
    { role: "Viewer", capabilities: ["article:read"] },
    { role: "Editor", capabilities: ["article:write"] },
    { role: "Admin", capabilities: ["member:invite"] },
  ];

  it("accumulates each tier's capabilities into the ones above it", () => {
    const map = ladderRoleMap(tiers);
    expect(map["Viewer"]).toEqual(["article:read"]);
    expect(map["Editor"]).toEqual(["article:read", "article:write"]);
    expect(map["Admin"]).toEqual(["article:read", "article:write", "member:invite"]);
  });

  it("gives each tier its OWN array, not an alias of the final one", () => {
    // Sharing the array makes every tier read as the most privileged set — which
    // looks like "the ladder works" in a test that only checks the top rung, and
    // is a total privilege escalation in practice.
    const map = ladderRoleMap(tiers);
    expect(map["Viewer"]).not.toBe(map["Admin"]);
    expect(map["Viewer"]).toHaveLength(1);
  });

  it("reproduces ladder behaviour through `can`", () => {
    const map = ladderRoleMap(tiers);
    const editor = subjectFromRoles([{ role: "Editor" }], map);

    expect(can(editor, "article:read")).toBe(true);
    expect(can(editor, "article:write")).toBe(true);
    expect(can(editor, "member:invite")).toBe(false);
  });

  it("still scopes correctly, which the ladder it replaces could not", () => {
    const map = ladderRoleMap(tiers);
    const subject = subjectFromRoles([{ role: "Admin", scope: "org-1" }], map);

    expect(can(subject, "member:invite", "org-1")).toBe(true);
    expect(can(subject, "member:invite", "org-2")).toBe(false);
  });

  it("does not duplicate a capability repeated across tiers", () => {
    const map = ladderRoleMap([
      { role: "A", capabilities: ["x"] },
      { role: "B", capabilities: ["x", "y"] },
    ]);
    expect(map["B"]).toEqual(["x", "y"]);
  });

  it("handles an empty tier list", () => {
    expect(ladderRoleMap([])).toEqual({});
  });
});
