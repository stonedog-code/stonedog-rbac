#!/usr/bin/env node
// Copyright (C) 2026 StoneDogCode L.L.C.
// SPDX-License-Identifier: Apache-2.0
/**
 * The manifest invariants, as a GATE rather than a habit (PRD-0067 R-S0).
 *
 *   node scripts/check-manifest.mjs            # this package's package.json
 *   node scripts/check-manifest.mjs <path>     # a fixture, for the tests
 *
 * The publish script has refused these for a while; this moves the same checks
 * into `npm run gate` so a dependency cannot land on a branch and be found at
 * publish time, after review, on a version number that can never be reused.
 *
 *  1. ZERO runtime dependencies. This is set membership and a bounded graph
 *     walk; anything it imports is inherited by every consumer on an
 *     authorisation path. Adding one must be a reviewed decision, and the
 *     README's claim must change in the same commit.
 *  2. Apache-2.0, and the NOTICE that travels with it is checked by the
 *     tarball guard.
 *  3. The scoped name, asserted POSITIVELY. A guard that only forbids the old
 *     mistake (an unscoped name) cannot catch the next one.
 *  4. `publishConfig.access: "public"`. A scoped package defaults to
 *     restricted, and a private publish looks like a success until a consumer
 *     gets a 404.
 *
 * Exit 1 on the first refusal, naming it. Exit 0 prints what was examined, so
 * a green here is never a green over nothing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? "package.json");
const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));

function refuse(message, ...detail) {
  console.error(`REFUSING: ${message}`);
  for (const line of detail) console.error(`  ${line}`);
  process.exit(1);
}

const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length > 0) {
  refuse(
    `this package claims ZERO runtime dependencies and now has ${deps.length}: ${deps.join(", ")}.`,
    "It is set membership and a bounded graph walk. Anything it imports is inherited by",
    "every consumer on an authorisation path. If this is deliberate, change the README",
    "claim in the same commit that adds it, and say why in the PR.",
  );
}
for (const field of ["peerDependencies", "optionalDependencies"]) {
  const names = Object.keys(pkg[field] ?? {});
  if (names.length > 0) {
    refuse(`${field} is not empty (${names.join(", ")}); this package has no runtime surface that would need one.`);
  }
}
if (pkg.license !== "Apache-2.0") refuse(`license is "${pkg.license}", expected Apache-2.0.`);
if (pkg.name !== "@stonedogcode/rbac") {
  refuse(
    `name is "${pkg.name}", expected "@stonedogcode/rbac".`,
    "All five shared packages scope under @stonedogcode. The unscoped stonedog-rbac@0.1.0",
    "stays on the registry, deprecated, pointing here — a name is never reclaimed.",
  );
}
if (pkg.publishConfig?.access !== "public") {
  refuse(
    `publishConfig.access is "${pkg.publishConfig?.access}", expected "public".`,
    "A SCOPED package defaults to restricted, and a private publish looks like a",
    "success until a consumer gets a 404.",
  );
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? "")) {
  refuse(`version "${pkg.version}" is not a plain semver release (x.y.z).`);
}

console.log(
  `check-manifest: ${pkg.name}@${pkg.version} — 0 runtime dependencies, ${pkg.license}, access ${pkg.publishConfig.access}; examined ${manifestPath}`,
);
