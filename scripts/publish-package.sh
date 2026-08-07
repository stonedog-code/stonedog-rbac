#!/usr/bin/env bash
# Copyright (C) 2026 StoneDogCode L.L.C.
# SPDX-License-Identifier: Apache-2.0
#
# Publish stonedog-rbac to npm, end to end.
#
#   npm run publish:stonedog-rbac
#
# Run it from a terminal, interactively. npm prompts for the 2FA one-time
# password itself (account `stonedogcode`) and the browser login flow needs a
# human — neither works unattended, which is why this is a script you run
# rather than a step in CI.
#
# Modelled on stonedog-style's and @stonedogcode/howto's scripts of the same
# name, and it keeps their central lesson: a publish that prints no error can
# still have published nothing, or the wrong thing. So this reads the tarball
# before publishing and installs from the registry afterwards, because "the
# registry lists it" and "a user can install it" are different claims, and the
# second is the last to start answering yes.
#
# ## The traps specific to THIS package
#
# 1. **The name is UNSCOPED.** `stonedog-rbac`, not `@stonedogcode/rbac`,
#    matching stonedog-style and stonedog-theme. An unscoped name is
#    first-come-first-served across the whole registry, so the first publish is
#    also the claim — and if someone else has taken it, npm says 404 rather than
#    "taken", which reads as a missing package while auth is perfectly fine.
#    Checked explicitly below.
#
# 2. **Zero runtime dependencies is a claim the README makes.** This is set
#    membership and a bounded graph walk; anything it imported would be
#    inherited by every consumer on an authorisation path. The check is a gate
#    rather than a comment.
#
# 3. **`ladderRoleMap` is exported and deprecated**, on purpose. Removing it is
#    a MAJOR version, not a tidy-up — a consumer mid-migration is depending on
#    it. The check below is a reminder that its absence is a breaking change,
#    not a cleanup.
#
# 4. Tests must not ship: they import jest globals that are not dependencies,
#    and consumers compile our source under their own config.
set -euo pipefail

PACKAGE_NAME="stonedog-rbac"
# Sanity floor. Comfortably under the real count (8) so ordinary growth does not
# trip it, above what a `files`-misconfigured package would produce (3:
# package.json, README, LICENSE). The margin is thinner than sibling packages'
# because this one is genuinely small — which is the point of it.
MIN_FILES=6
# Every path `exports` names.
REQUIRED_PATHS=("src/index.ts")
# Exports a consumer may already be depending on. Losing one is a MAJOR change.
REQUIRED_EXPORTS=("can" "capabilitiesIn" "subjectFromRoles" "ladderRoleMap")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mREFUSING: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Publish from a clean, current `main`.
# ---------------------------------------------------------------------------
say "Checking the working tree"
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || fail "this checkout is in detached HEAD. Run: git checkout main && git pull"
[ "$BRANCH" = "main" ] || fail "on branch '$BRANCH'. Publish from main, never a feature branch."
[ -z "$(git status --porcelain | grep -v '^??')" ] || fail "the working tree has uncommitted changes."

git fetch --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  BEHIND="$(git rev-list --count HEAD..origin/main)"
  fail "HEAD is not origin/main ($BEHIND commit(s) behind). A checkout one commit behind publishes a tarball missing the very thing you are publishing for, and it looks like a success. Run: git pull"
fi
echo "  clean, on main, at $(git rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
# 2. Authenticate.
#
# A 404 from `npm publish` means AUTH far more often than a missing package —
# npm answers 404 rather than 403 so it cannot leak whether a name exists. `npm
# whoami` turns that confusing failure into a clear one, and is the only thing
# that reveals an `_authToken` that is present but expired.
# ---------------------------------------------------------------------------
say "Checking npm authentication"
if ! NPM_USER="$(npm whoami 2>/dev/null)"; then
  echo "  not logged in — starting the browser login flow"
  npm login
  NPM_USER="$(npm whoami)"
fi
echo "  authenticated as $NPM_USER"

if npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  npm owner ls "$PACKAGE_NAME" 2>/dev/null | grep -q "^$NPM_USER " \
    || fail "'$NPM_USER' is not an owner of $PACKAGE_NAME. This is an UNSCOPED name, so it may belong to a stranger — check https://www.npmjs.com/package/$PACKAGE_NAME before assuming this is an auth problem. Publishing would fail with a misleading 404 either way."
  echo "  $NPM_USER is an owner of $PACKAGE_NAME"
else
  echo "  $PACKAGE_NAME does not exist on the registry — this first publish CLAIMS the name"
  echo "  (unscoped names are first-come-first-served; there is no reservation)"
fi

# ---------------------------------------------------------------------------
# 3. A version may be published at most once, ever.
# ---------------------------------------------------------------------------
VERSION="$(node -p "require('./package.json').version")"
say "Preparing $PACKAGE_NAME@$VERSION"

if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then
  fail "$PACKAGE_NAME@$VERSION is already published. A version can never be reused — bump it, land that, then re-run."
fi

# ---------------------------------------------------------------------------
# 4. The manifest invariants, before anything slow runs.
# ---------------------------------------------------------------------------
say "Checking the manifest invariants"
node -e '
  const pkg = require("./package.json");

  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length > 0) {
    console.error(`REFUSING: this package claims ZERO runtime dependencies and now has ${deps.length}: ${deps.join(", ")}.`);
    console.error("  It is set membership and a bounded graph walk. Anything it imports is inherited by");
    console.error("  every consumer on an authorisation path. If this is deliberate, change the README");
    console.error("  claim in the same commit that adds it.");
    process.exit(1);
  }

  if (pkg.license !== "Apache-2.0") {
    console.error(`REFUSING: license is "${pkg.license}", expected Apache-2.0.`);
    process.exit(1);
  }
  if (pkg.name.startsWith("@")) {
    console.error(`REFUSING: name is "${pkg.name}". This package is deliberately UNSCOPED, matching`);
    console.error("  stonedog-style and stonedog-theme. Changing it after a publish means DEPRECATING");
    console.error("  the old name, not renaming it — a published name can never be reclaimed.");
    process.exit(1);
  }
'
echo "  zero dependencies; Apache-2.0; unscoped name unchanged"

# ---------------------------------------------------------------------------
# 5. The gate, then the package check.
#
# Both, in this order. The gate proves the SOURCE is good; verify:package
# proves what a CONSUMER receives is good. Publishing is irreversible on a
# version number, so neither is assumed from a green PR — this checkout may
# carry commits that merged after the last CI run.
# ---------------------------------------------------------------------------
say "Running the gate"
npm run gate

say "Verifying the package as a consumer receives it"
npm run verify:package

# ---------------------------------------------------------------------------
# 6. Read the tarball before trusting it.
# ---------------------------------------------------------------------------
say "Verifying the tarball"
PACK_OUTPUT="$(npm pack --dry-run 2>&1)"
FILE_COUNT="$(printf '%s' "$PACK_OUTPUT" | sed -n 's/.*total files:[[:space:]]*\([0-9]*\).*/\1/p' | tail -1)"

[ -n "$FILE_COUNT" ] || fail "could not read a file count from npm pack."
[ "$FILE_COUNT" -ge "$MIN_FILES" ] \
  || fail "the tarball has only $FILE_COUNT files (expected >= $MIN_FILES). Publishing this would ship a near-empty package on a version number that can never be reused."

printf '%s' "$PACK_OUTPUT" | grep -q '__tests__' \
  && fail "the tarball contains test files. They import jest globals that are not dependencies, and consumers compile our source under their own config."

for path in "${REQUIRED_PATHS[@]}"; do
  printf '%s' "$PACK_OUTPUT" | grep -q "$path" \
    || fail "'$path' is not in the tarball, but package.json's \"exports\" names it. Every consumer import would fail."
done

printf '%s' "$PACK_OUTPUT" | grep -q 'README.md' \
  || fail "no README.md in the tarball — npmjs.com would show 'This package does not have a README'."
printf '%s' "$PACK_OUTPUT" | grep -q 'LICENSE' \
  || fail "no LICENSE in the tarball. This package is Apache-2.0 and the licence text ships with it."
printf '%s' "$PACK_OUTPUT" | grep -q 'NOTICE' \
  || fail "no NOTICE in the tarball. Apache-2.0 section 4(d) requires it to travel with the work."

# An export a consumer may already depend on cannot vanish in a minor. This is
# a reminder rather than a full API diff: losing `ladderRoleMap` in particular
# would look like a tidy-up and would break every consumer mid-migration.
for name in "${REQUIRED_EXPORTS[@]}"; do
  grep -q "\b$name\b" src/index.ts \
    || fail "'$name' is no longer exported from src/index.ts. Removing a public export is a MAJOR version, not a cleanup — a consumer mid-migration is depending on it."
done

echo "  $FILE_COUNT files; entry point, README, LICENSE and NOTICE present; no tests; public exports intact"

say "Tarball contents — read this before confirming"
printf '%s\n' "$PACK_OUTPUT" | sed -n 's/^npm notice[[:space:]]*[0-9.]*[kMG]*B*[[:space:]]*\(src\/.*\)/  \1/p' | sort
echo "  ($FILE_COUNT files total)"

# ---------------------------------------------------------------------------
# 7. Publish. npm prompts for the OTP here.
# ---------------------------------------------------------------------------
say "Publishing $PACKAGE_NAME@$VERSION — npm will ask for your 2FA code"
npm publish --access public

# ---------------------------------------------------------------------------
# 8. PROVE IT. The registry is eventually consistent for a few seconds, so this
#    polls rather than asserting once, and ends with a real install.
# ---------------------------------------------------------------------------
say "Verifying it is actually installable"
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT

for attempt in $(seq 1 20); do
  if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then break; fi
  [ "$attempt" -lt 20 ] || fail "$PACKAGE_NAME@$VERSION is still not on the registry after publishing. The publish did NOT succeed, whatever it printed."
  sleep 3
done

printf '{"name":"probe","version":"1.0.0"}' > "$PROBE_DIR/package.json"
(cd "$PROBE_DIR" && npm install --silent "$PACKAGE_NAME@$VERSION" >/dev/null 2>&1) \
  || fail "$PACKAGE_NAME@$VERSION resolves but cannot be installed."

INSTALLED="$(node -p "require('$PROBE_DIR/node_modules/$PACKAGE_NAME/package.json').version")"
[ "$INSTALLED" = "$VERSION" ] || fail "installed $INSTALLED but published $VERSION."

for path in "${REQUIRED_PATHS[@]}"; do
  [ -f "$PROBE_DIR/node_modules/$PACKAGE_NAME/$path" ] \
    || fail "$path is missing from the INSTALLED package, though it was in the tarball."
done

# It must install with nothing alongside it. A dependency that crept in would
# show up here as a populated node_modules rather than a single directory.
INSTALLED_DIRS="$(find "$PROBE_DIR/node_modules" -maxdepth 1 -mindepth 1 -type d ! -name '.*' | wc -l)"
[ "$INSTALLED_DIRS" -eq 1 ] \
  || fail "installing $PACKAGE_NAME pulled in $INSTALLED_DIRS packages. It must have zero runtime dependencies."

printf '\n\033[32m✓ %s@%s is published and installable.\033[0m\n' "$PACKAGE_NAME" "$VERSION"
echo "  https://www.npmjs.com/package/$PACKAGE_NAME"
printf '\n\033[1mNext:\033[0m the portal (stonedog-code/howto) can drop its `file:` dependency on this and\n'
printf '  take a version range instead — which is what unblocks its CI and its container build.\n'
