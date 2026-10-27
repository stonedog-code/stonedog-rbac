#!/usr/bin/env node
// Copyright (C) 2026 StoneDogCode L.L.C.
// SPDX-License-Identifier: Apache-2.0
/**
 * No internal architecture in the PUBLISHED package (PRD-0067 R-S3).
 *
 *   node scripts/check-tarball-leaks.mjs                 # packs this checkout, then scans the tarball
 *   node scripts/check-tarball-leaks.mjs --dir <path>    # scans an already-extracted package (the tests)
 *
 * This package is public and sits on the authorisation path of several
 * products. Its tarball must carry nothing a product keeps private: role
 * names, permission levels, table names, API routes, header names, internal
 * hostnames, environment-variable names, issue-tracker ids. None of that is a
 * secret on its own; published together it is a map, and this is the house
 * rule about audience, not secrecy.
 *
 * Scanned over the TARBALL, not the repository, because the tarball is what
 * ships and `files` decides what is in it. Code has its comments stripped
 * first — on purpose: the rationale for this very rule is written using the
 * banned words as examples, and a guard that banned them in comments would
 * make its own explanation unwriteable, which is how the explanation gets
 * deleted to turn a test green. Markdown is scanned whole: a README is prose
 * that a stranger reads on npmjs.com.
 *
 * The lists below are deliberately SPECIFIC spellings. A fuzzy rule ("anything
 * ending in Admin") would ban the README's own neutral examples, and the next
 * person would widen it until it matched nothing.
 *
 * Exit 1 listing every hit as file:line and the banned term. Exit 0 prints how
 * many files were examined, so a green over an empty tarball cannot pass.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";

/** Exact spellings that belong to a product, never to this package. */
const BANNED_TERMS = [
  // A product's role catalogue and its permission levels are its policy.
  "System Admin",
  "Brand Admin",
  "Facility Admin",
  "Organization Admin",
  "Organisation Admin",
  "Care Team",
  // Product-internal package and table names.
  "hopper-permissions",
  "hopper-dal",
  "hopper-auth-dal",
  "hopper-db",
  "user_login_security",
  "refresh_token",
  "time_sensitive_token",
  "trusted_device",
  "user_biometric",
  // Environment, hosts, infrastructure.
  "NEXTAUTH_SECRET",
  "KMS_AWS_",
  "DATABASE_URL",
  "amazonaws.com",
  "amazonlightsail.com",
  "pgbouncer",
];

/** Shapes rather than spellings. */
const BANNED_PATTERNS = [
  { name: "issue-tracker id", re: /\bNEH-\d+\b/ },
  { name: "API route", re: /\/api\/[a-z]/ },
  { name: "product HTTP header", re: /\bx-(session|hopper|step-up|unlock|forwarded)[a-z-]*\b/i },
  { name: "permission level beside a role", re: /\b(Admin|Nurse|Caregiver|Resident)\b[^\n]{0,20}\(\d{2,4}\)/ },
];

const SCANNED_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".json", ".md"]);

/**
 * Remove `//` and `/* *\/` comments, and NOTHING inside a string literal.
 *
 * A regex that drops everything after `//` also drops the tail of
 * `"folder//path"` or `"see https://…"`, and a banned term sitting after it in
 * the same string would be stripped and never seen — a guard bypass by string
 * formatting (Gemini, phase 2 review, adopted). So this walks the characters,
 * tracking which of ', ", ` it is inside, and only treats `//` and `/*` as
 * comment openers outside a string. Line structure is preserved so a hit still
 * reports its real line number.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null; // the string delimiter we are inside, or null
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Keep the newlines so later lines keep their numbers.
      out += source.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function scanDirectory(root) {
  const hits = [];
  let examined = 0;
  for (const file of walk(root)) {
    // `extname`, not a slice from the last dot: a dotted parent directory
    // would otherwise give an extension-less file a bogus extension and skip
    // it (Gemini, phase 2 review, adopted).
    const ext = extname(file);
    if (!SCANNED_EXTENSIONS.has(ext)) continue;
    examined += 1;
    const raw = readFileSync(file, "utf8");
    const text = ext === ".md" || ext === ".json" ? raw : stripComments(raw);
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      for (const term of BANNED_TERMS) {
        if (line.includes(term)) hits.push({ file: relative(root, file), line: index + 1, what: term });
      }
      for (const { name, re } of BANNED_PATTERNS) {
        const m = re.exec(line);
        if (m) hits.push({ file: relative(root, file), line: index + 1, what: `${name} (${m[0]})` });
      }
    });
  }
  return { hits, examined };
}

function packAndExtract() {
  const work = mkdtempSync(join(tmpdir(), "rbac-tarball-"));
  const out = execFileSync("npm", ["pack", "--pack-destination", work, "--silent"], { encoding: "utf8" });
  const tarball = join(work, out.trim().split("\n").pop());
  execFileSync("tar", ["-xzf", tarball, "-C", work]);
  return { dir: join(work, "package"), cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
let dir;
let cleanup = () => {};
if (dirArg >= 0) {
  dir = resolve(args[dirArg + 1]);
} else {
  ({ dir, cleanup } = packAndExtract());
}

try {
  const { hits, examined } = scanDirectory(dir);
  if (examined === 0) {
    console.error("check-tarball-leaks: examined 0 files — that is not a clean tarball, it is an empty one.");
    process.exit(1);
  }
  if (hits.length > 0) {
    console.error(`check-tarball-leaks: ${hits.length} internal detail(s) in the package that ships:`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.what}`);
    console.error("A product's names stay in the product. Say it with a neutral example, or say it in a code comment.");
    process.exit(1);
  }
  console.log(`check-tarball-leaks: examined ${examined} file(s) in the package; 0 internal details`);
} finally {
  cleanup();
}
