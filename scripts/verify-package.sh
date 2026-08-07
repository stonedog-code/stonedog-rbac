#!/usr/bin/env bash
#
# Prove the PACKAGE works, not just the checkout.
#
# Everything the test suite does runs against source files sitting in this
# repository, where `files`, the `exports` map and the tarball contents are
# invisible. Those are exactly what breaks at publish time — after review, when
# the version is already burned and cannot be reused.
#
# So: pack it, install the tarball into a throwaway project, and use it the way
# a consumer would — typecheck against the published `exports`, then execute.
#
# The consumer below exercises the SCOPE rules rather than just importing the
# symbols, because the assertions worth making about this package are all about
# what a grant does and does not reach.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
TARBALL="$WORK/$(basename "$(npm pack --pack-destination "$WORK" | tail -1)")"
echo "packed: $(basename "$TARBALL")"

# No test file may reach a consumer: they import jest globals that are not
# dependencies, and consumers compile our source under their own config.
if tar -tzf "$TARBALL" | grep -q "__tests__"; then
  echo "FAIL: the tarball contains test files" >&2
  tar -tzf "$TARBALL" | grep "__tests__" >&2
  exit 1
fi

mkdir -p "$WORK/consumer/src"
cd "$WORK/consumer"

cat > package.json <<'JSON'
{ "name": "consumer-check", "private": true, "type": "module", "version": "1.0.0" }
JSON

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true, "skipLibCheck": true,
    "lib": ["esnext"], "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
JSON

# `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are ON, and that
# is the point rather than thoroughness: this package ships SOURCE, so a
# consumer compiles our code under THEIR config. A strictness flag we do not
# hold ourselves becomes a build error in a repo that does not own the line.
#
# Imports go through the package NAME, never a relative path, so they resolve
# via the published `exports` map rather than the file layout.
cat > src/check.ts <<'TS'
import {
  can,
  capabilitiesIn,
  ladderRoleMap,
  subjectFromRoles,
  UnknownRoleError,
  type RoleMap,
  type ScopeResolver,
  type Subject,
} from "@stonedogcode/rbac";

const roleMap: RoleMap = {
  Viewer: ["article:read"],
  Admin: ["article:read", "member:invite"],
};

const subject: Subject = subjectFromRoles(
  [{ role: "Admin", scope: "org-1" }, { role: "Viewer", scope: "org-2" }],
  roleMap,
);

// The four rules, as a consumer would rely on them.
if (!can(subject, "member:invite", "org-1")) throw new Error("scoped grant did not apply");
if (can(subject, "member:invite", "org-2")) throw new Error("a grant leaked between scopes");
if (can(subject, "member:invite")) throw new Error("a scoped grant satisfied a GLOBAL check");
if (!can(subject, "article:read", "org-2")) throw new Error("second scope not granted");

// Hierarchy, and its direction.
const containing: ScopeResolver = (scope) => (scope === "site-a" ? ["org-1"] : []);
if (!can(subject, "member:invite", "site-a", { resolveContainingScopes: containing })) {
  throw new Error("a grant on a container did not reach what it contains");
}
const siteOnly = subjectFromRoles([{ role: "Admin", scope: "site-a" }], roleMap);
if (can(siteOnly, "member:invite", "org-1", { resolveContainingScopes: containing })) {
  throw new Error("a grant on a contained scope reached its container — the walk is INVERTED");
}

// A global grant satisfies everything.
const global = subjectFromRoles([{ role: "Admin" }], roleMap);
if (!can(global, "member:invite")) throw new Error("global grant did not satisfy a global check");
if (!can(global, "member:invite", "anything")) throw new Error("global grant did not scope down");

// The ladder adapter, deprecated but shipped.
const ladder = ladderRoleMap([
  { role: "A", capabilities: ["x"] },
  { role: "B", capabilities: ["y"] },
]);
if (ladder["B"]?.length !== 2) throw new Error("ladder did not accumulate");
if (ladder["A"]?.length !== 1) throw new Error("ladder tiers alias one array");

// Unknown roles: ignored by default, throwable on request.
if (subjectFromRoles([{ role: "Nope" }], roleMap).grants.length !== 0) {
  throw new Error("unknown role produced grants");
}
try {
  subjectFromRoles([{ role: "Nope" }], roleMap, { onUnknownRole: "throw" });
  throw new Error("onUnknownRole:throw did not throw");
} catch (error) {
  if (!(error instanceof UnknownRoleError)) throw error;
}

if (capabilitiesIn(subject, "org-1").size !== 2) throw new Error("capabilitiesIn disagrees with can");

console.log("package verified: exports resolve, types check, scope rules hold");
TS

npm install --silent --no-audit --no-fund \
  "$TARBALL" typescript@^5.9.3 @types/node@^22 tsx@^4 >/dev/null

echo "typechecking as a consumer…"
npx tsc --noEmit

echo "running as a consumer…"
npx tsx src/check.ts
